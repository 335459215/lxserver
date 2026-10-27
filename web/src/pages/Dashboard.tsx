import { useMemo, useState } from 'react'
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
  Sparkles,
  Trophy,
} from 'lucide-react'
import { Button, useToast } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import {
  useAggregatedLeaderboardBoards,
  useAggregatedLeaderboardSongs,
} from '@/lib/discover'
import { searchMusicAggregate } from '@/lib/music'
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
            className="group flex items-center gap-1 text-xs font-semibold text-accent transition-colors hover:text-accent/80"
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
  /** 点这张卡片时真正拿去搜的关键词。
   *
   *  【为什么每张卡必须有自己的关键词】
   *  此前 `handlePlayMix` **完全忽略传入的 mix**，六张卡一律
   *  `player.playQueue(topSongs, 0)` —— 也就是不管点哪张，播的都是「今日热播」
   *  那一批歌。用户的原话是「几个歌单的歌都一样的，这有什么用」，完全属实。
   *  现在每张卡各自去搜自己的关键词，卡片之间才是真的不同。
   *
   *  关键词取的是「在歌名里高频出现、且贴合场景」的词，与下面 MOOD_VIBES
   *  用的是同一套思路（那七个心情标签本来就用关键词跳搜索页）。
   *
   *  【关键词是实测选出来的，不是拍脑袋】
   *  搜「经典」「怀旧」「经典老歌」在五大平台返回的**第一首都是《吻别》**——
   *  也就是说这三个词做出来的歌单看起来还是一样。现在的六个词
   *  （经典 / 流行 / 时光 / 纯音乐 / 晚安 / 摇滚）实测首曲互不相同、结果集基本不重叠。
   *  改词前请先跑 `.playwright/_probe-mixwords.py` 看一眼首曲会不会撞。 */
  query: string
}

const CURATED_MIXES: CuratedMix[] = [
  {
    id: 'radar',
    title: '每日私享雷达',
    tag: '私享甄选',
    desc: '基于全网五大平台热度与声学品味智能聚合',
    gradient: 'from-indigo-600 via-indigo-700 to-purple-800',
    badgeColor: 'bg-white/95 text-indigo-900',
    query: '经典',
  },
  {
    id: 'pop',
    title: '流行风向标',
    tag: '潮流爆款',
    desc: '全网华语主流热播与全球流行音乐风向速递',
    gradient: 'from-rose-500 via-pink-600 to-rose-700',
    badgeColor: 'bg-white/95 text-rose-900',
    query: '流行',
  },
  {
    id: 'nostalgia',
    title: '复古千禧留声',
    tag: '经典金曲',
    desc: '回响岁月的港台经典与千禧黄金时代流行记忆',
    gradient: 'from-amber-500 via-amber-600 to-orange-700',
    badgeColor: 'bg-white/95 text-amber-900',
    query: '时光',
  },
  {
    id: 'focus',
    title: '深度心流空间',
    tag: '专注工作',
    desc: '低保真器乐、环境音与纯音，助你深度对焦',
    gradient: 'from-emerald-600 via-teal-700 to-cyan-800',
    badgeColor: 'bg-white/95 text-emerald-900',
    query: '纯音乐',
  },
  {
    id: 'night',
    title: '深夜治愈慢调',
    tag: '夜幕漫游',
    desc: '慵懒 R&B、City Pop 与温柔民谣，治愈疲惫心绪',
    gradient: 'from-violet-700 via-purple-800 to-slate-900',
    badgeColor: 'bg-white/95 text-purple-900',
    query: '晚安',
  },
  {
    id: 'drive',
    title: '公路驰骋节奏',
    tag: '动感电音',
    desc: '强劲节拍与电子浪潮，释放驾驶与运动活力',
    gradient: 'from-cyan-600 via-blue-600 to-indigo-800',
    badgeColor: 'bg-white/95 text-cyan-900',
    query: '摇滚',
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

  /** 播放精选歌单：**用这张卡片自己的关键词**去全网搜一批歌再播。
   *
   *  之前的实现是 `if (topSongs.length > 0) player.playQueue(topSongs, 0)`，
   *  压根没用上 mix 参数 —— 六张卡点下去听的是同一批「今日热播」，
   *  卡片上的标题/描述纯属装饰。现在每张卡搜自己的词，内容才真正不同。
   *
   *  搜不到时不静默失败：给一条提示并把人送到搜索页，让他能自己换词。 */
  const handlePlayMix = async (mix: CuratedMix) => {
    if (mixingId) return
    setMixingId(mix.id)
    try {
      const songs = await searchMusicAggregate({ name: mix.query })
      if (songs.length === 0) {
        toast({
          title: `「${mix.title}」没搜到歌`,
          description: `关键词「${mix.query}」在五大平台都没有结果，去搜索页换个词试试`,
        })
        navigate(`/search?q=${encodeURIComponent(mix.query)}`)
        return
      }
      player.playQueue(songs, 0)
      toast({
        title: `开始播放「${mix.title}」`,
        description: `共 ${songs.length} 首 · 关键词「${mix.query}」`,
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
          subtitle="根据当下时刻与全网潮流为你量身精选的氛围歌单"
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
                  {/* 装饰黑胶唱纹与微光 */}
                  <Disc3 className="size-12 opacity-40 transition-transform duration-700 group-hover:scale-110 group-hover:rotate-45" />
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
                    {loading ? `正在全网搜索「${mix.query}」…` : mix.desc}
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
            topSongs.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handlePlayHits}
                className="rounded-full border-line font-medium hover:border-accent/40 hover:bg-accent-soft hover:text-accent shadow-xs"
              >
                <Play className="size-3.5 fill-current mr-1 text-accent" />
                <span>播放全部 ({topSongs.length})</span>
              </Button>
            )
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
                    {song.img ? (
                      <img
                        src={song.img}
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
