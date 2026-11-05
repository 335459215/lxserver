import { useEffect, useCallback, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowRight,
  Car,
  Coffee,
  Disc3,
  Dumbbell,
  Feather,
  FileMusic,
  Flame,
  Guitar,
  Headphones,
  Heart,
  History,
  Laptop,
  Layers,
  ListMusic,
  Loader2,
  Moon,
  Music2,
  Play,
  Radio,
  RotateCw,
  Sparkles,
  Trophy,
} from 'lucide-react'
import { Button, useToast } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { coverUrl, type Song } from '@/lib/music'
import {
  useAggregatedLeaderboardBoards,
  useAggregatedLeaderboardSongs,
} from '@/lib/discover'
import { searchMusic, searchMusicAggregate } from '@/lib/music'
import {
  fetchCuratedCovers,
  forgetAllCuratedCovers,
  forgetCuratedCover,
  getBrowserStorage,
  readCuratedCovers,
  readCuratedRefreshDay,
  shouldRefreshDailyCovers,
  writeCuratedRefreshDay,
} from '@/lib/curatedCovers'
import { fetchDailyRecommendation, type DailyRecommendation } from '@/lib/recommend'
import {
  isStale,
  readTimestamp,
  writeTimestamp,
  LEADERBOARD_FETCHED_AT_KEY,
} from '@/lib/freshness'
import { useLists } from '@/lib/useLists'
import { usePlayer } from '@/lib/player'
import { downloadSong } from '@/lib/download'
import IosInstallGuide from '@/components/pwa/IosInstallGuide'
import { cn } from '@/lib/utils'

/** 根据当前时刻生成亲切问候语 */
function getGreeting(): { title: string; subtitle: string } {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) {
    return { title: '早上好', subtitle: '晨光初现，让纯净原声开启元气清晨' }
  } else if (hour >= 12 && hour < 14) {
    return { title: '中午好', subtitle: '午后休憩，点一首舒缓惬意的旋律' }
  } else if (hour >= 14 && hour < 19) {
    return { title: '下午好', subtitle: '醇香午后，伴随动听节拍专注心流' }
  } else {
    return { title: '晚上好', subtitle: '夜阑人静，戴上耳机享受高保真慢调' }
  }
}

/** 模块标题组件 */
function SectionHeader({
  title,
  subtitle,
  to,
  icon: Icon,
  extra,
}: {
  title: string
  subtitle?: string
  to?: string
  icon?: LucideIcon
  extra?: React.ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-ink">
          {Icon && (
            <span className="flex size-7 items-center justify-center rounded-xl bg-accent/10 text-accent">
              <Icon className="size-4" />
            </span>
          )}
          <span>{title}</span>
        </h2>
        {subtitle && <p className="mt-0.5 text-xs text-dim">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">
        {extra}
        {to && (
          <Link
            to={to}
            /* 【触摸目标】纯文字链接原先只有 66×16，低于 WCAG 2.2 AA（SC 2.5.8）
               的 24×24。用 py-1.5 -my-1.5 把热区上下各撑 6px、再用负 margin 抵消，
               **视觉位置与行高完全不变**，可点高度 16 → 28。 */
            className="group -my-1.5 flex items-center gap-1 py-1.5 text-xs font-semibold text-accent transition-colors hover:text-accent/80"
          >
            <span>查看全部</span>
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        )}
      </div>
    </div>
  )
}

/** 预设 6 个大厂质感甄选歌单模板 */
interface CuratedMix {
  id: string
  title: string
  tag: string
  desc: string
  gradient: string
  badgeColor: string
  /** 这张卡的主题特征词（服务端用它做偏好加权，见 src/modules/recommend/service.ts 的 MIX_SPECS）。
   *
   *  【为什么不再是「关键词」】
   *  v2.47 曾用「同主题词池按天轮换」冒充推荐 —— 那只是编辑挑词，拿词去搜前 20 首，
   *  跟你的口味毫无关系。现在候选池是**平台官方推荐流**（QQ 新专辑），
   *  这里的词只用于给六张卡**打分侧重**，六张卡从同一份推荐流里各取所需。
   *
   *  ⚠️ 必须与服务端 `MIX_SPECS` 的 id 与 keywords 保持一致。 */
  keywords: string[]
}

const CURATED_MIXES: CuratedMix[] = [
  {
    id: 'radar',
    title: '每日私享雷达',
    tag: '私享甄选',
    desc: '综合你的听歌画像，从平台新专辑里挑出今天该听的那一批',
    gradient: 'from-indigo-600 via-indigo-700 to-purple-800',
    badgeColor: 'bg-white/95 text-indigo-900',
    keywords: [],
  },
  {
    id: 'pop',
    title: '流行风向标',
    tag: '潮流爆款',
    desc: '全网华语主流热播与全球流行音乐风向速递',
    gradient: 'from-rose-500 via-pink-600 to-rose-700',
    badgeColor: 'bg-white/95 text-rose-900',
    keywords: ['流行', 'pop', '热歌', '热门', 'hit'],
  },
  {
    id: 'nostalgia',
    title: '复古千禧留声',
    tag: '经典金曲',
    desc: '回响岁月的港台经典与千禧黄金时代流行记忆',
    gradient: 'from-amber-500 via-amber-600 to-orange-700',
    badgeColor: 'bg-white/95 text-amber-900',
    keywords: ['经典', '老歌', '怀旧', '千禧', '粤语', '港台'],
  },
  {
    id: 'focus',
    title: '深度心流空间',
    tag: '专注工作',
    desc: '低保真器乐、环境音与纯音，助你深度对焦',
    gradient: 'from-emerald-600 via-teal-700 to-cyan-800',
    badgeColor: 'bg-white/95 text-emerald-900',
    keywords: ['钢琴', '纯音乐', '器乐', '轻音乐', 'piano', 'instrumental', 'lofi'],
  },
  {
    id: 'night',
    title: '深夜治愈慢调',
    tag: '夜幕漫游',
    desc: '慵懒 R&B、City Pop 与温柔民谣，治愈疲惫心绪',
    gradient: 'from-violet-700 via-purple-800 to-slate-900',
    badgeColor: 'bg-white/95 text-purple-900',
    keywords: ['晚安', '治愈', '温柔', '民谣', '慢', '夜'],
  },
  {
    id: 'drive',
    title: '公路驰骋节奏',
    tag: '动感电音',
    desc: '强劲节拍与电子浪潮，释放驾驶与运动活力',
    gradient: 'from-cyan-600 via-blue-600 to-indigo-800',
    badgeColor: 'bg-white/95 text-cyan-900',
    keywords: ['摇滚', '电音', '节奏', '舞曲', 'rock', 'edm', 'remix'],
  },
]

/** 探索心情与场景标签 */
const MOOD_VIBES = [
  { label: '轻松下午茶', icon: Coffee, query: '轻松' },
  { label: '活力运动', icon: Dumbbell, query: '运动' },
  { label: '治愈晚安', icon: Moon, query: '晚安' },
  { label: '专注心流', icon: Laptop, query: '专注' },
  { label: '随风驰骋', icon: Car, query: '公路' },
  { label: '摇滚先锋', icon: Guitar, query: '摇滚' },
  { label: '东方国风', icon: Feather, query: '国风' },
]

/** 快捷听歌磁贴。
 *  窄屏用「图标在上、文字在下」的居中卡片（2 列），宽屏切换为「图标在左」的横排卡片（4 列），
 *  避免 390px 视口下横排布局把歌单数/副标题挤到省略号。 */
function QuickTile({
  to,
  icon: Icon,
  iconClass,
  label,
  hint,
  filled,
  onPlay,
}: {
  to: string
  icon: LucideIcon
  iconClass: string
  label: string
  hint: string
  filled?: boolean
  onPlay?: (e: React.MouseEvent) => void
}) {
  return (
    <Link
      to={to}
      className="group relative flex flex-col items-center gap-2 overflow-hidden rounded-2xl border border-line/80 bg-panel p-3.5 text-center shadow-card transition-all hover:-translate-y-0.5 hover:border-line-strong hover:shadow-pop lg:flex-row lg:gap-3 lg:text-left"
    >
      <span
        className={cn(
          'relative flex size-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm',
          iconClass,
        )}
      >
        <Icon className={cn('size-5', filled && 'fill-current')} />
        {onPlay && (
          <button
            type="button"
            onClick={onPlay}
            aria-label={`播放${label}`}
            className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/25 opacity-0 transition-opacity hover:opacity-100 lg:hidden"
          >
            <Play className="size-4 fill-current text-white translate-x-px" />
          </button>
        )}
      </span>

      <div className="min-w-0 w-full lg:flex-1">
        <span className="block truncate text-xs font-bold text-ink lg:text-sm">{label}</span>
        <span className="mt-0.5 block truncate text-[10px] text-faint lg:text-xs">{hint}</span>
      </div>

      {onPlay ? (
        <button
          type="button"
          onClick={onPlay}
          aria-label={`播放${label}`}
          className="hidden size-8 shrink-0 items-center justify-center rounded-full bg-accent text-white shadow-md transition-all hover:scale-105 active:scale-95 lg:flex lg:opacity-0 lg:group-hover:opacity-100"
        >
          <Play className="size-3.5 fill-current translate-x-px" />
        </button>
      ) : (
        <ArrowRight className="mr-0.5 hidden size-4 shrink-0 text-faint transition-all lg:block lg:-translate-x-1 lg:opacity-0 lg:group-hover:translate-x-0 lg:group-hover:opacity-100" />
      )}
    </Link>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { auth } = useAuth()
  const player = usePlayer()
  const { toast } = useToast()
  const { snapshot } = useLists()

  /** 正在解析的甄选卡片 id（用于卡上转圈）。同一时刻只允许点一张，避免并发搜五路。 */
  const [mixingId, setMixingId] = useState<string | null>(null)

  /** 今日推荐流（v2.48.0）：服务端抓平台官方新专辑池 + 按本用户画像重排。
   *
   *  【为什么不再是「拿关键词去搜」】
   *  v2.47 的做法是拿固定/轮换关键词去打搜索接口取前 20 首 —— 那是检索，不是推荐：
   *  结果与该用户听过什么无关，同一天所有人看到的一样。现在候选池来自平台官方推荐流，
   *  再由服务端用播放历史（playCount + 时间衰减）与收藏库算出的歌手亲和度重排。
   *
   *  失败时**不阻塞首屏**：卡片回落到渐变 + 黑胶图标，点卡时会走搜索页兜底。 */
  const [rec, setRec] = useState<DailyRecommendation | null>(null)
  const [recError, setRecError] = useState<string | null>(null)
  const [recLoading, setRecLoading] = useState(true)

  const loadRecommend = useCallback(async (force = false) => {
    setRecLoading(true)
    try {
      const data = await fetchDailyRecommendation({ limit: 20, force })
      setRec(data)
      setRecError(null)
    } catch (e: unknown) {
      // 未登录时服务端返回 401：这是正常情况（游客），不弹错、不刷屏
      setRecError(e instanceof Error ? e.message : '获取推荐失败')
    } finally {
      setRecLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRecommend()
  }, [loadRecommend])

  /** 某张卡今天推荐的歌（服务端算好的，前端只取用） */
  const mixSongs = useCallback(
    (mix: CuratedMix): Song[] => rec?.mixes.find((m) => m.id === mix.id)?.songs ?? [],
    [rec],
  )

  /** 今日甄选卡的封面：**直接用推荐结果自带的封面**（v2.48.3）。
   *
   *  【为什么不再「再搜一次歌名取封面」】旧实现每个缺封面的卡都要多打一次搜索接口，
   *  又慢又容易失败（实测线上有两张卡因此显示成占位符）。推荐接口返回的歌曲对象
   *  本身带 `img` 字段（各平台搜索结果都带专辑图），直接用即可：
   *    - 零额外请求；
   *    - 封面与「点开会播的那首歌」严格一致（不是同名 другой 歌的图）。
   *
   *  只有推荐里首曲没有图时，才退回一次搜索兜底。 */
  const recCover = useCallback(
    (mix: CuratedMix): string | undefined => {
      const songs = mixSongs(mix)
      for (const s of songs) {
        const url = coverUrl(s)
        if (url) return url
        break // 只看首曲：翻后面的歌会得到与卡片标题不符的图
      }
      return undefined
    },
    [mixSongs],
  )

  /** 今天这批卡的封面目标（**只对没有自带封面的卡**做兜底搜索） */
  const coverTargets = useMemo(
    () => CURATED_MIXES.map((mix) => {
      const first = rec?.mixes.find((m) => m.id === mix.id)?.songs?.[0]
      return { id: mix.id, query: first?.name ?? mix.title }
    }),
    [rec],
  )

  /** ② 今日甄选卡的真封面：id → 封面地址。
   *
   *  初值直接读 localStorage，首帧就能把上次取到的封面画出来；
   *  缺的卡在挂载后各搜一首补齐（只查网易云 wy，省流量），
   *  搜不到的卡保持 undefined → 回落原来的渐变 + 黑胶图标，绝不裂图。
   *
   *  【按天刷新为什么放在初始化器里】effect 里同步 setMixCovers({}) 会触发
   *  级联渲染（react-hooks/set-state-in-effect）；初始化器每个挂载只跑一次，
   *  「读缓存 + 跨天作废 + 记下今天已刷新」三步都幂等，放这里最干净。 */
  const [mixCovers, setMixCovers] = useState<Record<string, string>>(() => {
    const store = getBrowserStorage()
    // 按天刷新（v2.45）：跨过刷新点（默认凌晨 6:00，见 CURATED_REFRESH_HOUR）后
    // 首次进首页，整批作废封面缓存重新搜图。v2.48 起歌单本身由服务端推荐流决定，
    // 封面也要跟着换成今天这批推荐的首曲封面。
    if (shouldRefreshDailyCovers(readCuratedRefreshDay(store), Date.now())) {
      writeCuratedRefreshDay(store, Date.now())
      forgetAllCuratedCovers(store, coverTargets)
      return {}
    }
    return readCuratedCovers(store, coverTargets)
  })
  useEffect(() => {
    const store = getBrowserStorage()
    // v2.48.3：推荐结果自带封面的卡不必再搜 —— 只有「推荐里首曲没图」的卡才兜底搜索。
    // 这既省掉整轮搜索请求，也避免旧实现「两张卡封面加载失败显示占位」的问题。
    const needFallback = coverTargets.filter(
      (t) => !mixCovers[t.id] && !recCover(CURATED_MIXES.find((m) => m.id === t.id)!),
    )
    if (needFallback.length === 0) return
    const ac = new AbortController()
    void fetchCuratedCovers(needFallback, {
      store,
      signal: ac.signal,
      // 6 张卡不抢首屏带宽：2 路并发、每路错峰 120ms
      concurrency: 2,
      staggerMs: 120,
      search: (query, signal) => searchMusic({ name: query, source: 'wy', page: 1, pages: 1, signal }),
      onCover: (id, url) =>
        setMixCovers((prev) => (prev[id] === url ? prev : { ...prev, [id]: url })),
    })
    return () => ac.abort()
    // 只在挂载时补齐一次：mixCovers 是初值，之后由 onCover 增量更新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const greeting = useMemo(() => getGreeting(), [])
  const username = auth.user.username || '听众'

  // 拉取全网聚合排行榜
  const boardsRes = useAggregatedLeaderboardBoards()
  const boards = useMemo(() => boardsRes.data ?? [], [boardsRes.data])

  // 第一榜单（通常是飙升榜）
  const topBoard = boards[0] ?? null
  const topBoardName = topBoard?.name ?? '热歌榜'
  const topSongsRes = useAggregatedLeaderboardSongs(topBoard?.targets)
  const topSongs = useMemo(() => topSongsRes.data?.list ?? [], [topSongsRes.data])

  // 今日热播精选曲目（取前 6 首）
  const hotHits = useMemo(() => topSongs.slice(0, 6), [topSongs])

  // ===== 排行榜 / 今日热播的陈旧度刷新（v2.45 新增）=====
  // 半实时数据，机制是「不轮询、按需刷」：
  //   1. 任何一次加载完成（首屏 / 陈旧度刷新 / 手动强刷）都记下时间戳；
  //   2. 页面重新可见（切标签页回来、PWA 从后台回前台）时，数据超过 5 分钟
  //      （与服务端缓存 TTL 对齐：短于它的请求就算发了也只会拿回旧数据）
  //      才静默强刷一次；
  //   3. 区块标题栏的「刷新」按钮随时强刷。
  // 强刷一律走 force：普通请求在 SW 的 30 分钟 stale-while-revalidate 窗口内
  // 只会拿回旧数据，用户点了刷新却看不到变化（大厂用户吐槽「刷新没用」的同一个坑）。
  // 刷新期间保留旧内容静默替换，不闪骨架、不清空正在看的列表。
  const boardsLoading = boardsRes.status === 'loading'
  const songsLoading = topSongsRes.status === 'loading'
  // reload 由 useAsyncResource 内部用 useCallback([]) 创建，引用恒稳 ——
  // 依赖整个 res 对象反而每次渲染都是新引用，会把下面的 visibility 监听器
  // 反复解绑重绑。这里只依赖 reload 本身是有意为之。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const refreshBoards = useCallback(() => boardsRes.reload(true), [boardsRes.reload])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const refreshSongs = useCallback(() => topSongsRes.reload(true), [topSongsRes.reload])

  // 数据就绪 → 记下「最近一次新鲜」的时刻（首屏加载与两种刷新都会走到这）
  useEffect(() => {
    if (boardsRes.status !== 'ready') return
    writeTimestamp(getBrowserStorage(), LEADERBOARD_FETCHED_AT_KEY, Date.now())
  }, [boardsRes.status])

  useEffect(() => {
    if (topSongsRes.status !== 'ready') return
    writeTimestamp(getBrowserStorage(), LEADERBOARD_FETCHED_AT_KEY, Date.now())
  }, [topSongsRes.status])

  // 回前台时按陈旧度决定是否静默强刷。挂载时不查：挂载本身就会拉一次，
  // 再查一遍等于每次进首页都发双倍请求。
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      const last = readTimestamp(getBrowserStorage(), LEADERBOARD_FETCHED_AT_KEY)
      if (!isStale(last, Date.now())) return
      refreshBoards()
      refreshSongs()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [refreshBoards, refreshSongs])

  // 我的资料库计数
  const loveCount = snapshot?.loveList.length ?? 0
  const playlistCount = snapshot?.userList.length ?? 0

  // 播放整组曲目
  const handlePlayHits = () => {
    if (topSongs.length > 0) {
      player.playQueue(topSongs, 0)
    }
  }

  // 播放我喜欢的全部歌曲
  const handlePlayFavorites = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (snapshot?.loveList && snapshot.loveList.length > 0) {
      player.playQueue(snapshot.loveList, 0)
    } else {
      navigate('/favorites')
    }
  }

  /** 播放精选歌单：**直接播服务端算好的推荐队列**（v2.48.0）。
   *
   *  演进史（三代，每代都是上一代的缺陷）：
   *   1. `player.playQueue(topSongs, 0)` —— 六张卡点下去播的是同一批「今日热播」，纯装饰；
   *   2. 每卡一个固定词去搜 —— 卡片之间终于不同了，但内容是「该词的前 20 首」，
   *      与用户口味无关，且同一个词每天返回同一批（用户反馈「一直没变」）；
   *   3. 现在：服务端推荐流（平台官方新专辑）+ 本人播放画像重排，六张卡靠主题词打分分区。
   *
   *  推荐还没到时点卡：立刻按卡主题词走一次搜索兜底，别让用户点了没反应。 */
  const handlePlayMix = async (mix: CuratedMix) => {
    if (mixingId) return
    setMixingId(mix.id)
    try {
      const songs = mixSongs(mix)
      if (songs.length > 0) {
        player.playQueue(songs, 0)
        const meta = rec?.mixes.find((m) => m.id === mix.id)
        toast({
          title: `开始播放「${mix.title}」`,
          description: `共 ${songs.length} 首 · ${meta?.basis ?? '今日推荐'}`,
          variant: 'success',
        })
        return
      }

      // 推荐还没好 / 这一卡没货：用主题词兜底搜一次
      const keyword = mix.keywords[0] ?? mix.title
      const found = await searchMusicAggregate({ name: keyword })
      if (found.length === 0) {
        toast({
          title: `「${mix.title}」暂无内容`,
          description: `推荐流还在准备中，去搜索页挑几首吧`,
        })
        navigate(`/search?q=${encodeURIComponent(keyword)}`)
        return
      }
      player.playQueue(found, 0)
      toast({
        title: `开始播放「${mix.title}」`,
        description: `共 ${found.length} 首 · 关键词「${keyword}」`,
        variant: 'success',
      })
    } catch (e: unknown) {
      toast({
        title: '搜索失败',
        description: e instanceof Error ? e.message : '未知错误',
        variant: 'destructive',
      })
    } finally {
      setMixingId(null)
    }
  }

  return (
    <div className="rise flex w-full flex-col gap-8 pb-10">
      {/* 1. 顶部个性化问候与快捷听歌栏 (Greeting & Quick Picks) */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-ink">
                {greeting.title}，{username}
              </h1>
              <span className="flex size-6 items-center justify-center rounded-full bg-accent/10 text-accent">
                <Sparkles className="size-3.5" />
              </span>
            </div>
            <p className="mt-1 text-xs md:text-sm text-dim">{greeting.subtitle}</p>
          </div>
          <div className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-line/80 bg-panel px-3 py-1 text-xs font-semibold text-faint shadow-xs">
            <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>全网五大平台音源在线聚合</span>
          </div>
        </div>

        {/* iOS 安装引导：iOS Safari 不触发 beforeinstallprompt（那是 Chromium 机制），
            顶栏的「安装应用」按钮在 iPhone 上从不出现 —— iOS 用户唯一的安装路径
            （分享 → 添加到主屏幕）必须由界面教给用户。非 iOS / 已安装 / 关闭过 30 天内
            时组件自己返回 null。 */}
        <IosInstallGuide />

        {/* 快捷听歌 4 磁贴：我喜欢的音乐、播放历史、自建歌单、本地曲库 */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <QuickTile
            to="/favorites"
            icon={Heart}
            iconClass="bg-gradient-to-tr from-rose-500 to-pink-500 shadow-rose-500/20"
            label="我喜欢的"
            hint={`${loveCount} 首歌曲`}
            filled
            onPlay={loveCount > 0 ? handlePlayFavorites : undefined}
          />
          <QuickTile
            to="/history"
            icon={History}
            iconClass="bg-gradient-to-tr from-emerald-500 to-teal-500 shadow-emerald-500/20"
            label="播放历史"
            hint="继续上次收听"
          />
          <QuickTile
            to="/playlist"
            icon={ListMusic}
            iconClass="bg-gradient-to-tr from-indigo-500 to-purple-600 shadow-indigo-500/20"
            label="我的歌单"
            hint={`${playlistCount} 个自建歌单`}
          />
          <QuickTile
            to="/local"
            icon={FileMusic}
            iconClass="bg-gradient-to-tr from-amber-500 to-orange-500 shadow-amber-500/20"
            label="本地音乐"
            hint="无损离线曲库"
          />
        </div>
      </section>

      {/* 2. 今日精选甄选歌单 (Curated Featured Mixes) */}
      <section>
        <SectionHeader
          title="今日甄选歌单"
          subtitle={
            recError
              ? `推荐暂不可用：${recError}`
              : rec
                ? `平台新专辑 ${rec.poolStats?.discover ?? 0} 首${
                    (rec.seedSingers?.length ?? 0) > 0
                      ? ` + 按你的口味（${rec.seedSingers!.slice(0, 3).join('、')}）${rec.poolStats?.taste ?? 0} 首`
                      : ''
                  } · ${rec.day}`
                : '根据你的听歌画像，从平台新专辑里为你精选'
          }
          icon={Headphones}
        />
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-6">
          {CURATED_MIXES.map((mix) => {
            const loading = mixingId === mix.id
            return (
              <div
                key={mix.id}
                onClick={() => void handlePlayMix(mix)}
                aria-busy={loading}
                className={cn(
                  'group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-line/80 bg-panel p-3 shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-line-strong hover:shadow-pop',
                  loading && 'pointer-events-none opacity-90',
                  mixingId && !loading && 'opacity-60',
                )}
              >
                {/* 大封面艺术图 */}
                <div
                  className={cn(
                    'relative flex aspect-square w-full items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-xs overflow-hidden',
                    mix.gradient,
                  )}
                >
                  {/* ② 真封面：优先用推荐结果首曲自带的图（零额外请求、与播放一致）；
                      没有才用搜索兜底的结果；再没有回落渐变+黑胶装饰 */}
                  {(recCover(mix) ?? mixCovers[mix.id]) ? (
                    <>
                      <img
                        src={recCover(mix) ?? mixCovers[mix.id]}
                        alt=""
                        loading="lazy"
                        onError={() => {
                          // 图床挂了 / 地址失效：丢掉缓存并回落渐变，下次进首页重取
                          forgetCuratedCover(getBrowserStorage(), mix.id)
                          setMixCovers((prev) => {
                            if (!prev[mix.id]) return prev
                            const next = { ...prev }
                            delete next[mix.id]
                            return next
                          })
                        }}
                        className="absolute inset-0 size-full object-cover transition-transform duration-700 group-hover:scale-105"
                      />
                      {/* 压暗一层：浅色封面上徽标与播放钮也要看得清 */}
                      <span
                        aria-hidden
                        className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-black/20"
                      />
                    </>
                  ) : (
                    <Disc3 className="size-12 opacity-40 transition-transform duration-700 group-hover:scale-110 group-hover:rotate-45" />
                  )}
                  <span
                    className={cn(
                      'absolute left-2.5 top-2.5 rounded-full px-2 py-0.5 text-[10px] font-bold backdrop-blur-md',
                      mix.badgeColor,
                    )}
                  >
                    {mix.tag}
                  </span>

                  {/* 解析中：盖一层转圈，让「正在搜这批歌」可见（跨五个平台搜索要几秒） */}
                  {loading && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/35 backdrop-blur-[1px]">
                      <Loader2 className="size-6 animate-spin text-white" />
                    </span>
                  )}

                  {/* 悬停一键播放圆钮 */}
                  <button
                    type="button"
                    aria-label={`播放 ${mix.title}`}
                    className="absolute bottom-2.5 right-2.5 flex size-9 translate-y-2 items-center justify-center rounded-full bg-white text-ink opacity-0 shadow-lg transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100 hover:scale-105 active:scale-95"
                  >
                    <Play className="size-4 fill-current translate-x-0.5 text-accent" />
                  </button>
                </div>

                {/* 标题与描述 */}
                <div className="mt-2.5 flex-1">
                  <span className="block truncate text-sm font-bold text-ink group-hover:text-accent transition-colors">
                    {mix.title}
                  </span>
                  <span className="mt-0.5 block line-clamp-2 text-[11px] text-faint leading-snug">
                    {loading ? '正在准备今日推荐…' : mix.desc}
                  </span>
                  {/* 今日这卡有多少首 / 命中哪位偏好歌手 —— 让推荐「可解释」，
                      比 v2.47 那个「今日『关键词』」更能说明凭什么推这些 */}
                  <span className="mt-1 block truncate text-[10px] font-medium text-accent/80">
                    {mixSongs(mix).length > 0
                      ? `${mixSongs(mix).length} 首${
                          (rec?.mixes.find((m) => m.id === mix.id)?.topSingers?.length ?? 0) > 0
                            ? ` · 常听 ${rec?.mixes.find((m) => m.id === mix.id)?.topSingers.slice(0, 2).join('/')}`
                            : ''
                        }`
                      : recLoading ? '推荐生成中…' : '暂无推荐'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* 3. 今日热播 · 新歌首发速递 (Today's Hits & New Releases) */}
      <section className="rounded-3xl border border-line/80 bg-panel p-5 md:p-6 shadow-card">
        <SectionHeader
          title={`今日热播速递 · ${topBoardName}`}
          subtitle="全网多平台热度极速飙升的热门单曲，点击即播"
          icon={Flame}
          extra={
            <div className="flex items-center gap-2">
              {topSongs.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePlayHits}
                  className="rounded-full border-line font-medium hover:border-accent/40 hover:bg-accent-soft hover:text-accent shadow-xs"
                >
                  <Play className="size-3.5 fill-current mr-1 text-accent" />
                  <span>播放全部 ({topSongs.length})</span>
                </Button>
              )}
              {/* 手动强刷：绕过 SW 30 分钟 stale-while-revalidate + 服务端 5 分钟缓存，
                  点了就一定是上游最新数据。转圈期间保留旧列表，不闪骨架。 */}
              <Button
                variant="outline"
                size="icon"
                onClick={refreshSongs}
                disabled={songsLoading}
                aria-label="刷新今日热播"
                title="刷新"
                className="rounded-full border-line hover:border-accent/40 hover:bg-accent-soft hover:text-accent shadow-xs"
              >
                <RotateCw className={cn('size-3.5 text-accent', songsLoading && 'animate-spin')} />
              </Button>
            </div>
          }
        />

        {topSongsRes.status === 'loading' && (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-2xl bg-panel2 p-2.5 animate-pulse">
                <span className="size-12 rounded-xl bg-panel" />
                <div className="flex-1 space-y-1.5">
                  <span className="block h-3.5 w-3/4 rounded bg-panel" />
                  <span className="block h-2.5 w-1/2 rounded bg-panel" />
                </div>
              </div>
            ))}
          </div>
        )}

        {hotHits.length > 0 && (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {hotHits.map((song, idx) => (
              <div
                key={song.id || `${song.name}_${idx}`}
                onClick={() => player.playQueue(topSongs, idx)}
                className="group relative flex cursor-pointer items-center justify-between rounded-2xl border border-transparent p-2.5 transition-all hover:border-line/70 hover:bg-panel2/70 active:scale-[0.99]"
              >
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  {/* 封面 + 播放悬浮态 */}
                  <div className="relative size-12 shrink-0 overflow-hidden rounded-xl bg-panel2 shadow-xs">
                    {coverUrl(song) ? (
                      <img
                        src={coverUrl(song)}
                        alt={song.name}
                        loading="lazy"
                        className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center bg-accent-soft text-accent">
                        <Music2 className="size-5" />
                      </div>
                    )}
                    <span className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity group-hover:opacity-100">
                      <Play className="size-4 fill-current text-white translate-x-0.5" />
                    </span>
                  </div>

                  {/* 歌曲信息 */}
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink group-hover:text-accent transition-colors">
                      {song.name}
                    </span>
                    <span className="block truncate text-xs text-dim mt-0.5">
                      {song.singer}
                      {song.albumName ? ` · ${song.albumName}` : ''}
                    </span>
                  </div>
                </div>

                {/* 右侧：时长与一键离线下载 */}
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] font-mono text-faint">
                    {song.interval || '--:--'}
                  </span>
                  <button
                    type="button"
                    title="下载歌曲并写入高保真标签"
                    onClick={(e) => {
                      e.stopPropagation()
                      downloadSong(song)
                    }}
                    className="flex size-7 items-center justify-center rounded-lg text-faint hover:bg-panel hover:text-ink transition-colors"
                  >
                    <ArrowRight className="size-3.5 -rotate-45" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 4. 探索场景与音乐心情 (Scene & Mood Vibes) */}
      <section>
        <SectionHeader
          title="场景与心情电台"
          subtitle="选一种生活状态，让符合氛围的旋律自然流淌"
          icon={Radio}
        />
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
          {MOOD_VIBES.map((vibe) => (
            <button
              key={vibe.label}
              type="button"
              onClick={() => navigate(`/search?q=${encodeURIComponent(vibe.query)}`)}
              className="group flex shrink-0 items-center gap-2 rounded-2xl border border-line/80 bg-panel px-4 py-2.5 text-xs font-semibold text-dim shadow-xs transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:bg-accent-soft hover:text-accent"
            >
              <vibe.icon className="size-4 text-faint group-hover:text-accent transition-colors" />
              <span>{vibe.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* 5. 全网权威聚合榜单速览 (Trending Charts Spotlight Cards) */}
      <section>
        <SectionHeader
          title="权威聚合排行榜"
          subtitle="汇聚全网多平台权威热度，不分平台直接畅听"
          to="/leaderboard"
          icon={Trophy}
          extra={
            <Button
              variant="outline"
              size="icon"
              onClick={refreshBoards}
              disabled={boardsLoading}
              aria-label="刷新排行榜"
              title="刷新"
              className="rounded-full border-line hover:border-accent/40 hover:bg-accent-soft hover:text-accent shadow-xs"
            >
              <RotateCw className={cn('size-3.5 text-accent', boardsLoading && 'animate-spin')} />
            </Button>
          }
        />
        {boardsRes.status === 'loading' && (
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <span key={i} className="h-44 rounded-2xl bg-panel2 animate-pulse" />
            ))}
          </div>
        )}

        {boards.length > 0 && (
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            {boards.slice(0, 4).map((b, i) => {
              const bgGradients = [
                'from-indigo-600 to-purple-700',
                'from-rose-500 to-pink-600',
                'from-amber-500 to-orange-600',
                'from-emerald-600 to-teal-700',
              ]
              return (
                <Link
                  key={b.id || b.name}
                  to={`/leaderboard?name=${encodeURIComponent(b.name)}`}
                  className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-line/80 bg-panel p-4 shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-line-strong hover:shadow-pop"
                >
                  {/* 卡片顶部：榜单名与渐变装饰 */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={cn(
                          'flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr text-white shadow-xs',
                          bgGradients[i % bgGradients.length],
                        )}
                      >
                        <Disc3 className="size-5" />
                      </span>
                      <div>
                        <span className="block truncate text-sm font-bold text-ink group-hover:text-accent transition-colors">
                          {b.name}
                        </span>
                        <span className="text-[10px] text-faint">全网多源聚合榜</span>
                      </div>
                    </div>
                    <span className="flex size-7 items-center justify-center rounded-full bg-panel2 text-faint transition-colors group-hover:bg-accent group-hover:text-white">
                      <ArrowRight className="size-3.5" />
                    </span>
                  </div>

                  {/* 中部简介 */}
                  <div className="my-3 rounded-xl bg-panel2/60 p-2.5 text-xs text-dim">
                    <p className="line-clamp-2 text-[11px] text-faint leading-relaxed">
                      汇集全网各主流平台「{b.name}」热播曲目，实时并发去重交叉合并。
                    </p>
                  </div>

                  {/* 底部：一键即听 */}
                  <div className="flex items-center justify-between pt-1 border-t border-line/50 text-xs">
                    <span className="text-[11px] font-semibold text-accent flex items-center gap-1">
                      <Layers className="size-3" />
                      点击进入完整榜单
                    </span>
                    <span className="text-[11px] text-faint">100+ 首</span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}


