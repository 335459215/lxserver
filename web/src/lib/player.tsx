import * as React from 'react'
import {
  coverUrl,
  MusicApiError,
  resolveMusicUrl,
  sameSong,
  songKey,
  type ResolveAttempt,
  type Song,
} from '@/lib/music'
import { DEFAULT_QUALITY, qualityFallback, saveAutoBest, saveQuality, savedAutoBest, savedQuality } from '@/lib/quality'
import { pickStartTier, songTiers } from '@/lib/qualityOptions'
import { reportHistory } from '@/lib/history'
import { userAuthHeaders } from '@/lib/auth'
import { applySleepAction, SLEEP_OFF, type SleepMode, type SleepTimerState } from '@/lib/sleepTimer'
import { AudioCache, cacheKey, createBrowserAudioCache } from '@/lib/audioCache'

/** 播放器状态机：idle → loading（解析中）→ playing/paused，失败落 error */
export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error'

/** 循环三态（对齐 Spotify / Apple Music / YouTube Music 的模型）：
 *  - off 不循环：播完最后一首停止
 *  - all 列表循环：播完回到第一首
 *  - one 单曲循环：自动播完重复本首（手动切歌仍换曲）
 *  「随机」是独立开关，不参与这里的轮换 —— 这是大厂通行做法，
 *  也是与旧版播放器「顺序/循环/单曲/随机 四选一」最大的区别。 */
export type RepeatMode = 'off' | 'all' | 'one'

export const REPEAT_ORDER: readonly RepeatMode[] = ['off', 'all', 'one'] as const

export const REPEAT_LABEL: Record<RepeatMode, string> = {
  off: '不循环',
  all: '列表循环',
  one: '单曲循环',
}

export interface PlayerState {
  current: Song | null
  queue: Song[]
  index: number
  status: PlaybackStatus
  /** 当前播放位置（秒） */
  position: number
  /** 总时长（秒）；优先取 <audio>.duration，拿不到时回落到 interval */
  duration: number
  volume: number
  muted: boolean
  /** 随机播放开关（持久化） */
  shuffle: boolean
  /** 循环模式（持久化） */
  repeat: RepeatMode
  /** 播放倍速（持久化，默认 1）。⚠️ 换 src 会把 <audio> 的速率重置为 1，
   *  loadAndPlay 里每次设完 src 都必须重挂（见 applyPlaybackRate）。 */
  rate: number
  /** 播放缓存开关（持久化，默认开）。关掉后不走缓存也不写缓存 */
  audioCacheOn: boolean
  /** 睡眠定时（会话级，不持久化 —— 重启后不该有一个幽灵定时在跑） */
  sleep: SleepTimerState
  /** 是否已可播（首个 canplay 之后） */
  ready: boolean
  error: string | null
  /** 解析失败时试过的源，UI 用来解释"为什么没播成" */
  attempts: ResolveAttempt[]
  /** 实际解析出的音质（可能与请求不同，服务端会降级）。
   *  ⚠️ 只信这个字段展示「实得档位」；请求档位另见 preferredQuality。 */
  resolvedQuality: string | null
  /** 用户偏好的音质档位（持久化）。解析时作为首选，失败逐级向下回退。 */
  preferredQuality: string
  /** 是否按曲目申报的「最高可用档位」自动解析（持久化，默认关）。见 lib/quality.ts 的说明。 */
  autoBestQuality: boolean
  /** 实际命中的自定义源名 */
  sourceName: string | null
}

export interface PlayerApi extends PlayerState {
  /** 播放一首歌：传 queue 则整队替换；已在队列中则跳过去，不打断队列 */
  playSong: (song: Song, queue?: Song[]) => void
  playQueue: (songs: Song[], startIndex?: number) => void
  playAt: (index: number) => void
  toggle: () => void
  next: () => void
  prev: () => void
  seek: (seconds: number) => void
  setVolume: (v: number) => void
  toggleMute: () => void
  /** 切换随机播放 */
  toggleShuffle: () => void
  /** 循环模式轮换：不循环 → 列表循环 → 单曲循环 */
  cycleRepeat: () => void
  /** 设置睡眠定时：'off' 取消；'endOfSong' 播完当前这首；'after' minutes 分钟后 */
  setSleep: (mode: SleepMode, minutes?: number) => void
  /** 设置播放倍速（0.25~3，越界夹回）；立即生效并持久化 */
  setRate: (rate: number) => void
  /** 播放缓存开关；持久化 */
  setAudioCacheOn: (on: boolean) => void
  /** 切换音质档位；若正在播放，会立刻用新档位重新解析当前曲目 */
  setQuality: (tier: string) => void
  /** 开关「按曲目自动选最高可用档位」；开启时对正在播放的曲目立即重新解析 */
  setAutoBestQuality: (on: boolean) => void
  clear: () => void
  /** 失败后换源重试（把这次失败的源加入排除清单） */
  retry: () => void
  removeAt: (index: number) => void
}

const PlayerContext = React.createContext<PlayerApi | null>(null)

const STORAGE_VOLUME = 'lx.player.volume'
const STORAGE_SHUFFLE = 'lx.player.shuffle'
const STORAGE_REPEAT = 'lx.player.repeat'
const STORAGE_RATE = 'lx.player.rate'
const STORAGE_AUDIO_CACHE = 'lx.player.audioCache'

const initialState: PlayerState = {
  current: null,
  queue: [],
  index: -1,
  status: 'idle',
  position: 0,
  duration: 0,
  volume: 1,
  muted: false,
  shuffle: false,
  repeat: 'all',
  rate: restoreRate(),
  audioCacheOn: restoreAudioCacheOn(),
  sleep: SLEEP_OFF,
  ready: false,
  error: null,
  attempts: [],
  resolvedQuality: null,
  preferredQuality: DEFAULT_QUALITY,
  autoBestQuality: false,
  sourceName: null,
}

/** 读回上次音量（0–1），异常一律回落 1 */
function restoreVolume(): number {
  if (typeof localStorage === 'undefined') return 1
  const raw = Number.parseFloat(localStorage.getItem(STORAGE_VOLUME) ?? '')
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 1
}

function restoreShuffle(): boolean {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(STORAGE_SHUFFLE) === '1'
}

/** 读回上次循环模式，异常一律回落「列表循环」 */
function restoreRepeat(): RepeatMode {
  if (typeof localStorage === 'undefined') return 'all'
  const raw = localStorage.getItem(STORAGE_REPEAT)
  return REPEAT_ORDER.includes(raw as RepeatMode) ? (raw as RepeatMode) : 'all'
}

/** 读回播放倍速（0.25~3 之外一律回落 1） */
function restoreRate(): number {
  if (typeof localStorage === 'undefined') return 1
  const raw = Number.parseFloat(localStorage.getItem(STORAGE_RATE) ?? '')
  return Number.isFinite(raw) && raw >= 0.25 && raw <= 3 ? raw : 1
}

/** 播放缓存开关（默认开 —— 用户明确要的「缓存播放」） */
function restoreAudioCacheOn(): boolean {
  if (typeof localStorage === 'undefined') return true
  return localStorage.getItem(STORAGE_AUDIO_CACHE) !== '0'
}

/** 缓存单例：caches 不可用（非安全上下文）时是 null，一切缓存路径静默跳过 */
let audioCacheSingleton: AudioCache | null | undefined
function getAudioCache(): AudioCache | null {
  if (audioCacheSingleton === undefined) audioCacheSingleton = createBrowserAudioCache()
  return audioCacheSingleton
}

/** MediaSession：锁屏/通知栏元数据 + 播放态（约束三：必须保留） */
function applyMediaSession(song: Song | null, playing: boolean) {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
  const ms = navigator.mediaSession
  try {
    if (!song) {
      ms.metadata = null
      ms.playbackState = 'none'
      return
    }
    const artwork = coverUrl(song)
    ms.metadata = new MediaMetadata({
      title: song.name,
      artist: song.singer,
      album: song.albumName ?? '',
      artwork: artwork
        ? [96, 128, 192, 256, 384, 512].map((size) => ({ src: artwork, sizes: `${size}x${size}` }))
        : [],
    })
    ms.playbackState = playing ? 'playing' : 'paused'
  } catch {
    // MediaMetadata 构造失败不该影响播放
  }
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  // 约束一：<audio> 只经 ref 持有，绝不渲染进条件树——一旦随条件挂载/卸载，
  // 切歌或切路由就会重建元素、打断正在播的音频。整棵树上有且只有这一个 audio。
  const audioRef = React.useRef<HTMLAudioElement | null>(null)

  const [state, setState] = React.useState<PlayerState>(() => ({
    ...initialState,
    volume: restoreVolume(),
    shuffle: restoreShuffle(),
    repeat: restoreRepeat(),
    preferredQuality: savedQuality(),
    autoBestQuality: savedAutoBest(),
  }))

  /** state 的镜像：事件回调与动作里读它，避免闭包捕获陈旧值 */
  const stateRef = React.useRef(state)
  React.useEffect(() => {
    stateRef.current = state
  }, [state])

  /** 已排除的解析源（按曲目记忆），换源重试时带上，配合服务端熔断 */
  const excludedRef = React.useRef<Map<string, string[]>>(new Map())
  /** 当前解析请求序号：切歌后旧请求的结果必须丢弃 */
  const reqSeqRef = React.useRef(0)
  const abortRef = React.useRef<AbortController | null>(null)

  /** 音频层失败（链接失效/格式不支持）的自动换源计数，按曲目隔离 */
  const audioFailRef = React.useRef<{ key: string; count: number }>({ key: '', count: 0 })
  /** 由下面的 recoverFromAudioFailure 填充；挂载期的事件监听通过它回调 */
  const recoverRef = React.useRef<() => void>(() => {})

  /** 「卡死看门狗」定时器。
   *
   *  【为什么需要它，光有 error 事件不够】
   *  `error` 只在链接**明确失败**时触发（404/格式不支持/连接被拒）。
   *  但更常见的一类坏源是**连得上、就是慢**：连接正常建立、服务端也不报错，
   *  只是迟迟不吐数据。此时 `<audio>` 会一直停在 `waiting` 状态 ——
   *  既不触发 error，也不触发 canplay，界面永远转圈。
   *  因为连接是活的，服务端那套「链接探测 + 熔断」也抓不到它
   *  （探测只看能不能拿到响应码，不看传得快不快）。
   *  结果就是用户看到「一直缓冲」，而系统认为一切正常、永远不会换源。
   *
   *  这里做客户端唯一能做的事：等待超时后主动判它不可用，
   *  走既有的换源恢复流程（排除这个源、重新解析）。
   *  时长取 20s —— 比任何合理网络的首次缓冲都宽，又短到用户还愿意等。 */
  const stallTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const STALL_TIMEOUT_MS = 20_000

  /** 本次「正在播」已经上报过历史的曲目 key。
   *
   *  做这层守卫是因为 `play` 事件会重复触发（暂停后恢复、缓冲后重播、
   *  拖动进度条后继续）—— 每次触发都上报会让 playCount 虚高。
   *  只有**换了曲目**才允许再报一次：这等价于「一首歌听一次算一次」，
   *  而不是「按了几次播放键」。 */
  const reportedRef = React.useRef<string>('')

  /** 上报播放历史（服务端按 source|songmid 去重，这里是第一道闸）。 */
  const reportPlayback = React.useCallback((song: Song | null) => {
    if (!song) return
    // 本地音乐不进历史：它不走解析器、也不该混进在线历史里
    if (song.url || song.source === 'local') return
    const key = songKey(song)
    if (!key || reportedRef.current === key) return
    reportedRef.current = key
    void reportHistory(song)
  }, [])

  const patch = React.useCallback((p: Partial<PlayerState>) => {
    setState((s) => ({ ...s, ...p }))
  }, [])

  /** 起/重置「卡死看门狗」。见 stallTimerRef 的说明。
   *
   *  判定条件刻意保守 —— 只有同时满足下面全部条件才判死，避免误杀：
   *    - 仍在**等待数据**的状态（loading = 正在起播、playing = 播着播着卡住了）
   *    - 还没拿到可播数据（ready === false）
   *    - audio.readyState < 3（HAVE_FUTURE_DATA；>=3 说明数据够了，只是播得慢）
   *
   *  【覆盖的两种场景】
   *    1. 起播慢：loadAndPlay 置 status='loading'，慢源走不到 onPlay，
   *       一直停在 loading —— 状态集合里的 'loading' 就是救它的。
   *    2. 播放中卡死：正在播的源突然断流（CDN 挂/上游掐断），
   *       waiting 触发、ready 翻回 false、status 仍是 'playing' ——
   *       集合里的 'playing' 救它。第二版只认 'playing' 结果起播场景漏了，
   *       第三版只处理起播（`!ready` 才 arm）结果把播放中卡死又漏了 ——
   *       这两类必须都覆盖，缺一个就是「永远转圈」。
   *
   *  【为什么不认 paused/idle/error】
   *  paused 有两种来源：用户主动暂停、以及自动播放被浏览器拦截
   *  （play() reject → patch({status:'paused'})）。这两种都不该被自动换源打扰。
   *  error 态已经走过换源流程，再触发会重复。 */
  const STALL_WATCHABLE: PlaybackStatus[] = ['loading', 'playing']
  const armStallWatchdog = React.useCallback(() => {
    if (stallTimerRef.current) clearTimeout(stallTimerRef.current)
    stallTimerRef.current = setTimeout(() => {
      stallTimerRef.current = null
      const s = stateRef.current
      if (s.ready || !STALL_WATCHABLE.includes(s.status)) return
      const el = audioRef.current
      if (!el || el.readyState >= 3) return
      setState((prev) => ({
        ...prev,
        error: prev.error ?? '音源响应太慢，正在换源重试…',
        ready: false,
      }))
      recoverRef.current()
    }, STALL_TIMEOUT_MS)
  }, [])

  const clearStallWatchdog = React.useCallback(() => {
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current)
      stallTimerRef.current = null
    }
  }, [])

  // ===== 音频元素事件绑定（只绑一次）=====
  React.useEffect(() => {
    const el = audioRef.current
    if (!el) return

    const onTime = () =>
      setState((s) => (s.position === el.currentTime ? s : { ...s, position: el.currentTime }))
    const onDur = () =>
      setState((s) => {
        const d = Number.isFinite(el.duration) ? el.duration : 0
        return s.duration === d ? s : { ...s, duration: d }
      })
    const onPlay = () => {
      // 真的播起来了：清掉本曲的自动换源计数，后续再失败仍有重试额度
      audioFailRef.current = { key: songKey(stateRef.current.current), count: 0 }
      // 也清掉卡死看门狗：能播起来就说明这个源是好的（慢一点但能出数据）
      clearStallWatchdog()
      setState((s) => (s.status === 'playing' ? s : { ...s, status: 'playing', error: null }))
      reportPlayback(stateRef.current.current)
    }
    const onPause = () =>
      setState((s) => (s.status === 'idle' || s.status === 'error' ? s : { ...s, status: 'paused' }))
    const onWaiting = () => {
      // 播放中途也会卡死：正在播的源突然不吐数据（CDN 断流/上游挂了），
      // waiting 触发、ready 翻回 false —— 这和「起播时慢」是同一类问题，
      // 都必须起表。第二版只处理了起播（`!ready` 才 arm），播放中途卡住
      // 会永远转圈不换源，这正是看门狗要救的另一半场景。
      clearStallWatchdog()
      armStallWatchdog()
      setState((s) => (s.status === 'playing' ? { ...s, ready: false } : s))
    }
    const onCanPlay = () => {
      clearStallWatchdog()
      setState((s) => (s.ready ? s : { ...s, ready: true }))
    }
    const onErr = () => {
      // 媒体元素自身错误 = 这条链接不可播（失效/格式不支持/源站返回非音频）
      // 不直接落 error 态：交给自动换源重试，把刚失败的源排除掉再解析一次
      // （对齐旧版播放器的「播放失败自动恢复」）
      clearStallWatchdog()
      setState((s) => ({
        ...s,
        error: s.error ?? '音频加载失败，正在换源重试…',
        ready: false,
      }))
      recoverRef.current()
    }

    el.addEventListener('timeupdate', onTime)
    el.addEventListener('durationchange', onDur)
    el.addEventListener('loadedmetadata', onDur)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('waiting', onWaiting)
    el.addEventListener('canplay', onCanPlay)
    el.addEventListener('error', onErr)
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('durationchange', onDur)
      el.removeEventListener('loadedmetadata', onDur)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('waiting', onWaiting)
      el.removeEventListener('canplay', onCanPlay)
      el.removeEventListener('error', onErr)
      // 看门狗必须一并清掉：否则它会在组件卸载后触发，
      // 那时 recoverRef 里的 setState 已经落到一个不存在的组件上
      clearStallWatchdog()
    }
  }, [armStallWatchdog, clearStallWatchdog])

  // 音量/静音同步到元素
  React.useEffect(() => {
    const el = audioRef.current
    if (!el) return
    el.volume = state.volume
    el.muted = state.muted
  }, [state.volume, state.muted])

  // MediaSession 随曲目/播放态更新（约束三）。
  // 依赖取解构后的值而非 state.xxx，避免 timeupdate 高频更新触发无谓的元数据重设。
  const { current: sessionSong, status: sessionStatus } = state
  React.useEffect(() => {
    applyMediaSession(sessionSong, sessionStatus === 'playing')
  }, [sessionSong, sessionStatus])

  // 音量持久化
  React.useEffect(() => {
    try {
      localStorage.setItem(STORAGE_VOLUME, String(state.volume))
    } catch {
      // 隐私模式下 localStorage 可能抛错
    }
  }, [state.volume])

  // 随机 / 循环持久化
  React.useEffect(() => {
    try {
      localStorage.setItem(STORAGE_SHUFFLE, state.shuffle ? '1' : '0')
      localStorage.setItem(STORAGE_REPEAT, state.repeat)
    } catch {
      // 同上
    }
  }, [state.shuffle, state.repeat])

  // 音质偏好持久化（lib/quality.ts 里也有 saveQuality，这里统一由 state 驱动，
  // 保证「设置页选」与「播放栏选」两条入口写的是同一个来源）
  React.useEffect(() => {
    saveQuality(state.preferredQuality as never)
  }, [state.preferredQuality])

  React.useEffect(() => {
    saveAutoBest(state.autoBestQuality)
  }, [state.autoBestQuality])

  /** 解析并播放：从用户偏好档位起，沿回退链逐档降级，任一档成功即播。
   *
   *  `tierOverride` 用于「刚切换档位、state 还没提交」的场景 —— 此时 stateRef
   *  里的 preferredQuality 仍是旧值（ref 由 useEffect 同步，晚于本次调用），
   *  直接读 ref 会拿着旧档位去解析，表现为「切了档位但音质没变」。 */
  /** 倍速落到 <audio> 并持久化。preservesPitch 显式置 true：
   *  音乐场景默认不该出现「变速变调」（现代浏览器默认即 true，显式写
   *  是防旧内核/未来默认变化）。 */
  const applyPlaybackRate = React.useCallback((rate: number) => {
    const el = audioRef.current
    if (!el) return
    el.playbackRate = rate
    el.preservesPitch = true
  }, [])

  /** 当前生效的 blob: URL（缓存命中时用它当 src）；换歌/换源时 revoke 旧句柄 */
  const blobUrlRef = React.useRef<string | null>(null)
  const applyBlobSrc = React.useCallback((blob: Blob, el: HTMLAudioElement): void => {
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
    blobUrlRef.current = URL.createObjectURL(blob)
    el.src = blobUrlRef.current
  }, [])

  /** 后台缓存写入的守卫句柄（seq 变了就作废） */
  const cacheWriteSeqRef = React.useRef(0)
  /** 进行中的缓存下载（服务端中转，整首歌几十 MB）—— 切歌/停止必须中止，
   *  否则快速切歌时每个 15s 窗口都可能挂着一个无人认领的几十 MB 下载在跑 */
  const cacheFetchAbortRef = React.useRef<AbortController | null>(null)

  /** 联网播放稳定后后台缓存一次。
   *  【为什么延后】跳过的歌不值得缓存（几十 MB 的 flac 白下）；听了一段
   *  才算「真的在听」。默认 15s；测试可用 lx.player.cacheDelayMs 缩短。 */
  const scheduleCacheWrite = React.useCallback(
    (seq: number, songKeyStr: string, url: string, tier: string, song: Song) => {
      if (!stateRef.current.audioCacheOn) return
      const cache = getAudioCache()
      if (!cache) return
      const delay = Number.parseFloat(localStorage.getItem('lx.player.cacheDelayMs') ?? '') || 15000
      cacheWriteSeqRef.current = seq
      cacheFetchAbortRef.current?.abort()
      const ac = new AbortController()
      cacheFetchAbortRef.current = ac
      window.setTimeout(() => {
        if (cacheWriteSeqRef.current !== seq) return // 已切歌
        if (stateRef.current.status !== 'playing') return // 没在播（暂停/出错）不缓存
        const st = stateRef.current
        if (songKey(st.current) !== songKeyStr) return
        void (async () => {
          try {
            // 直链是跨域 CDN，页面 fetch 会被 CORS 拦（<audio> 标签不受限、
            // JS 读字节受限）—— 走服务端中转（/api/music/download 本就是
            // 流式代理，inline=1 不带附件头），同源响应才能读成 Blob
            const res = await fetch(
              `/api/music/download?url=${encodeURIComponent(url)}&inline=1`,
              { headers: userAuthHeaders(), signal: ac.signal },
            )
            if (!res.ok) return
            const blob = await res.blob()
            if (cacheWriteSeqRef.current !== seq) return
            await cache.put(cacheKey(songKeyStr, tier), blob, {
              tier,
              name: song.name,
              singer: song.singer,
            })
          } catch {
            /* 缓存失败不影响播放 */
          }
        })()
      }, delay)
    },
    [],
  )

  const loadAndPlay = React.useCallback(
    async (song: Song, tierOverride?: string, autoBestOverride?: boolean) => {
      const el = audioRef.current
      if (!el) return

      reqSeqRef.current += 1
      const seq = reqSeqRef.current
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac
      // 上一首的缓存下载（若有）立即中止：seq 守卫只拦「写入」，拦不住已发出的下载
      cacheFetchAbortRef.current?.abort()

      console.warn('[DBG loadAndPlay]', song.source + ':' + song.songmid, song.name, (new Error().stack || '').split(String.fromCharCode(10)).slice(2, 5).join(' | ').slice(0, 300))
      const key = songKey(song)
      const exclude = excludedRef.current.get(key) ?? []
      // 换到别的曲目时重置自动换源计数（同一曲目的重试会保留计数）
      if (audioFailRef.current.key !== key) audioFailRef.current = { key, count: 0 }

      // 音质档位从 stateRef 读（不放进依赖数组）：否则每次切档都会重建 loadAndPlay，
      // 连锁让下游依赖它的 useCallback/useEffect 全部失效。ref 读最新值语义等价。
      //
      // 起手档位三条优先级（高 → 低）：
      //   1. 用户**显式点选**的档位（tierOverride）—— 点了什么就是什么，任何自动策略都不得改写
      //   2. 开了「按曲目自动选最高档」时，本曲申报的更高档位
      //   3. 用户偏好档位
      // 自动抬升只改**起点**，回退链仍是原生的「由高到低」，故解析成功率不变。
      const startTier =
        tierOverride ??
        pickStartTier(
          songTiers(song),
          stateRef.current.preferredQuality,
          autoBestOverride ?? stateRef.current.autoBestQuality,
        )
      const tiers = qualityFallback(startTier)

      patch({
        status: 'loading',
        error: null,
        attempts: [],
        ready: false,
        position: 0,
        duration: 0,
      })

      let lastMessage = '解析失败'
      let lastAttempts: ResolveAttempt[] = []

      // 播放缓存优先（v2.39.0）：命中直接播 blob —— 不发解析请求、不下载，
      // 断网也能放。键用**起手档位**（同一偏好下次点同一首必然同键），
      // 实得档位以缓存里记录的为准。
      if (stateRef.current.audioCacheOn) {
        const cache = getAudioCache()
        const hit = cache ? await cache.get(cacheKey(key, startTier)) : null
        if (seq !== reqSeqRef.current) return
        if (hit) {
          patch({ resolvedQuality: hit.tier, sourceName: '播放缓存', attempts: [] })
          applyBlobSrc(hit.blob, el)
          el.load()
          applyPlaybackRate(stateRef.current.rate)
          try {
            await el.play()
          } catch {
            if (seq === reqSeqRef.current) patch({ status: 'paused' })
          }
          return
        }
      }

      // 本地音乐带直链：解析器只认在线平台，对本地文件必然失败，直接用它播放。
      // 封面/时长等元信息由 lib/localMusic.ts 在构造 Song 时补好。
      if (song.url) {
        patch({ resolvedQuality: null, sourceName: '本地音乐', attempts: [] })
        el.src = song.url
        el.load()
        applyPlaybackRate(stateRef.current.rate)
        try {
          await el.play()
        } catch {
          if (seq === reqSeqRef.current) patch({ status: 'paused' })
        }
        return
      }

      for (const quality of tiers) {
        try {
          const result = await resolveMusicUrl({
            songInfo: song,
            quality,
            excludeApiSources: exclude,
            signal: ac.signal,
          })
          if (seq !== reqSeqRef.current) return // 已被更新的点歌请求取代

          patch({
            resolvedQuality: result.quality ?? quality,
            sourceName: result.sourceName ?? null,
            attempts: result.attempts ?? [],
          })

          if (blobUrlRef.current) {
            URL.revokeObjectURL(blobUrlRef.current)
            blobUrlRef.current = null
          }
          el.src = result.url
          el.load()
          applyPlaybackRate(stateRef.current.rate)
          // 设置 src 后立即起表，而不是等 `waiting` 事件。
          // 慢源在拿到第一个字节前可能**根本不触发 waiting**（连接建立中），
          // 只靠事件起表会漏掉最典型的「点了歌一直转圈」那一类。
          armStallWatchdog()
          try {
            await el.play()
          } catch {
            // 自动播放被拦：保持 paused 等用户点播放，不算错误
            if (seq === reqSeqRef.current) patch({ status: 'paused' })
          }
          // 缓存键用**请求档位**（quality），实际写入字节是 result.quality 的 ——
          // 降级时缓存的就是低档字节，info.tier 如实记录，重播不会谎报档位
          scheduleCacheWrite(seq, key, result.url, String(result.quality ?? quality), song)
          return
        } catch (e) {
          if (seq !== reqSeqRef.current) return
          if (e instanceof DOMException && e.name === 'AbortError') return
          lastAttempts = e instanceof MusicApiError ? (e.attempts ?? []) : []
          lastMessage = e instanceof Error ? e.message : '解析失败'
          // 换下一档音质继续试
        }
      }

      if (seq !== reqSeqRef.current) return
      // 所有档位都解析失败：缓存里这首歌任意档位兜底（断网/全源故障时仍能放）
      if (stateRef.current.audioCacheOn) {
        const cache = getAudioCache()
        const fallback = cache ? await cache.newestFor(key) : null
        if (seq !== reqSeqRef.current) return
        if (fallback) {
          patch({
            resolvedQuality: fallback.tier,
            sourceName: '播放缓存（音源不可用兜底）',
            attempts: lastAttempts,
            error: null,
          })
          applyBlobSrc(fallback.blob, el)
          el.load()
          applyPlaybackRate(stateRef.current.rate)
          try {
            await el.play()
          } catch {
            if (seq === reqSeqRef.current) patch({ status: 'paused' })
          }
          return
        }
      }
      patch({ status: 'error', error: lastMessage, attempts: lastAttempts, ready: false })
    },
    [patch, applyPlaybackRate, scheduleCacheWrite, applyBlobSrc],
  )

  /** 音频层失败后的自动换源：把刚失败的源排除，再解析一次。
   *  这正是旧版播放器「播放失败自动恢复」的核心（清单第 13 项）——
   *  自定义源里总有几个是返回死链/非音频内容的，没有这层恢复就会"解析成功但播不出声"。
   *  有次数上限，避免所有源都坏时无限打转。 */
  const MAX_AUDIO_RETRIES = 3
  const recoverFromAudioFailure = React.useCallback(() => {
    const s = stateRef.current
    if (!s.current) return

    // 本地直链没有别的源可换，重试同一个地址也没意义，直接报错
    if (s.current.url) {
      patch({ status: 'error', error: s.error ?? '本地文件无法播放（可能已被移动或删除）' })
      return
    }

    const key = songKey(s.current)
    if (audioFailRef.current.key !== key) audioFailRef.current = { key, count: 0 }

    if (audioFailRef.current.count >= MAX_AUDIO_RETRIES) {
      patch({
        status: 'error',
        error: s.error ?? '这首歌试过的音源都放不出来，换一首或稍后再试',
      })
      return
    }
    audioFailRef.current.count += 1

    // 排除刚失败的那个源，下次解析换别的
    if (s.sourceName) {
      const prev = excludedRef.current.get(key) ?? []
      excludedRef.current.set(key, Array.from(new Set([...prev, s.sourceName])))
    }
    void loadAndPlay(s.current)
  }, [loadAndPlay, patch])

  React.useEffect(() => {
    recoverRef.current = recoverFromAudioFailure
  }, [recoverFromAudioFailure])

  /** 切歌核心：随机开关 + 循环三态决定下一首。
   *  auto=true 表示「本曲自然播完」触发的切换 —— 只有这种情况下单曲循环才重播本首、
   *  不循环才会在最后一首停下；手动点上一首/下一首始终换曲，不会卡住。 */
  const advance = React.useCallback(
    (dir: 1 | -1, auto: boolean) => {
      const s = stateRef.current
      const len = s.queue.length
      if (!len) return
      const el = audioRef.current

      if (auto && s.repeat === 'one') {
        if (el) {
          el.currentTime = 0
          void el.play().catch(() => patch({ status: 'paused' }))
        }
        return
      }

      let idx: number
      if (s.shuffle && len > 1) {
        do {
          idx = Math.floor(Math.random() * len)
        } while (idx === s.index)
      } else {
        idx = s.index + dir
        if (idx >= len) {
          // 到底了：不循环则停下，否则回到开头
          if (auto && s.repeat === 'off') {
            el?.pause()
            patch({ status: 'paused' })
            return
          }
          idx = 0
        } else if (idx < 0) {
          idx = len - 1
        }
      }

      const song = s.queue[idx]
      setState((prev) => ({ ...prev, index: idx, current: song, position: 0, duration: 0 }))
      void loadAndPlay(song)
    },
    [loadAndPlay, patch],
  )

  const next = React.useCallback(() => advance(1, false), [advance])

  const prev = React.useCallback(() => {
    const el = audioRef.current
    // 播放超过 3 秒：上一首 = 回到本曲开头（与主流播放器一致）
    if (el && el.currentTime > 3) {
      el.currentTime = 0
      patch({ position: 0 })
      return
    }
    advance(-1, false)
  }, [advance, patch])

  const playAt = React.useCallback(
    (index: number) => {
      const s = stateRef.current
      if (index < 0 || index >= s.queue.length) return
      const song = s.queue[index]
      if (sameSong(song, s.current)) {
        // 同一首：只切换播放/暂停，不重新解析
        const el = audioRef.current
        if (el?.paused) void el.play().catch(() => patch({ status: 'paused' }))
        else el?.pause()
        return
      }
      setState((p) => ({ ...p, index, current: song, position: 0, duration: 0 }))
      void loadAndPlay(song)
    },
    [loadAndPlay, patch],
  )

  const playSong = React.useCallback(
    (song: Song, queue?: Song[]) => {
      if (queue && queue.length) {
        const found = queue.findIndex((q) => sameSong(q, song))
        const idx = found >= 0 ? found : 0
        const target = queue[idx] ?? song
        setState((s) => ({ ...s, queue, index: idx, current: target, position: 0, duration: 0 }))
        void loadAndPlay(target)
        return
      }
      const s = stateRef.current
      const existing = s.queue.findIndex((q) => sameSong(q, song))
      if (existing >= 0) {
        setState((p) => ({ ...p, index: existing, current: p.queue[existing], position: 0, duration: 0 }))
        void loadAndPlay(s.queue[existing])
        return
      }
      setState((p) => ({
        ...p,
        queue: [...p.queue, song],
        index: p.queue.length,
        current: song,
        position: 0,
        duration: 0,
      }))
      void loadAndPlay(song)
    },
    [loadAndPlay],
  )

  const playQueue = React.useCallback(
    (songs: Song[], startIndex = 0) => {
      if (!songs.length) return
      const idx = Math.min(Math.max(startIndex, 0), songs.length - 1)
      const song = songs[idx]
      setState((s) => ({ ...s, queue: songs, index: idx, current: song, position: 0, duration: 0 }))
      void loadAndPlay(song)
    },
    [loadAndPlay],
  )

  const toggle = React.useCallback(() => {
    const el = audioRef.current
    const s = stateRef.current
    if (!el || !s.current) return
    if (s.status === 'error') {
      void loadAndPlay(s.current) // 失败态下点播放 = 换源重试
      return
    }
    if (el.paused) void el.play().catch(() => patch({ status: 'paused' }))
    else el.pause()
  }, [loadAndPlay, patch])

  const retry = React.useCallback(() => {
    const s = stateRef.current
    if (!s.current) return
    // 手动重试 = 重置自动换源额度，并把当前这个源也排除掉
    audioFailRef.current = { key: songKey(s.current), count: 0 }
    if (s.sourceName) {
      const key = songKey(s.current)
      const prev = excludedRef.current.get(key) ?? []
      excludedRef.current.set(key, Array.from(new Set([...prev, s.sourceName])))
    }
    // 把这次失败的源加进排除清单，下次解析换别的源（对齐旧版播放器的换源恢复）
    const failed = s.attempts
      .filter((a) => a.status === 'fail' && (a.name || a.sourceName))
      .map((a) => (a.name ?? a.sourceName) as string)
    if (failed.length) {
      const key = songKey(s.current)
      const prevList = excludedRef.current.get(key) ?? []
      excludedRef.current.set(key, Array.from(new Set([...prevList, ...failed])))
    }
    void loadAndPlay(s.current)
  }, [loadAndPlay])

  const seek = React.useCallback(
    (seconds: number) => {
      const el = audioRef.current
      if (!el || !Number.isFinite(el.duration)) return // 直播流不可跳
      el.currentTime = Math.max(0, Math.min(seconds, el.duration))
      patch({ position: el.currentTime })
    },
    [patch],
  )

  const setVolume = React.useCallback((v: number) => {
    const vol = Math.max(0, Math.min(1, v))
    // 调音量即取消静音（与系统播放器一致）
    setState((s) => ({ ...s, volume: vol, muted: vol === 0 ? s.muted : false }))
  }, [])

  const toggleMute = React.useCallback(() => {
    setState((s) => ({ ...s, muted: !s.muted }))
  }, [])

  const toggleShuffle = React.useCallback(() => {
    setState((s) => ({ ...s, shuffle: !s.shuffle }))
  }, [])

  const cycleRepeat = React.useCallback(() => {
    setState((s) => {
      const next = REPEAT_ORDER[(REPEAT_ORDER.indexOf(s.repeat) + 1) % REPEAT_ORDER.length]
      return { ...s, repeat: next }
    })
  }, [])

  // ===== 睡眠定时（v2.35.0）=====
  //
  // 触发与迁移分离：迁移走 lib/sleepTimer 的纯状态机（单测 + 变异盯边界），
  // 这里只做接线 —— timeout / 淡出 / ended 拦截。
  /** 'after' 模式的到期 timeout（含淡出阶段） */
  const sleepTimeoutRef = React.useRef<number | null>(null)
  /** 淡出间隔句柄 */
  const sleepFadeRef = React.useRef<number | null>(null)
  /** 淡出前的音量，暂停后还原 —— 否则下次播放是静音的 */
  const preFadeVolumeRef = React.useRef(1)

  const clearSleepTimers = React.useCallback(() => {
    if (sleepTimeoutRef.current != null) {
      window.clearTimeout(sleepTimeoutRef.current)
      sleepTimeoutRef.current = null
    }
    if (sleepFadeRef.current != null) {
      window.clearInterval(sleepFadeRef.current)
      sleepFadeRef.current = null
    }
  }, [])

  const setSleep = React.useCallback(
    (mode: SleepMode, minutes?: number) => {
      clearSleepTimers()
      const next =
        mode === 'off'
          ? SLEEP_OFF
          : applySleepAction(stateRef.current.sleep, { type: 'set', mode, minutes, now: Date.now() })
      setState((s) => ({ ...s, sleep: next }))

      if (next.mode !== 'after' || next.endsAt == null) return
      const endsAt = next.endsAt
      const FADE_MS = 4000
      // 到点前 FADE_MS 开始淡出（听着睡着的人不该被「啪」地一下吵醒），
      // 到点暂停并还原音量。淡出期间用户手动调音量会和它打架 ≤4s ——
      // 可接受（换任何实现都避免不了），收益是停止时不生硬。
      const startFade = Math.max(0, endsAt - FADE_MS - Date.now())
      sleepTimeoutRef.current = window.setTimeout(() => {
        const el = audioRef.current
        if (!el || el.paused) {
          // 没在播（用户自己早停了）：定时直接结束，不碰音量
          setState((s) => ({ ...s, sleep: applySleepAction(s.sleep, { type: 'expire' }) }))
          return
        }
        preFadeVolumeRef.current = stateRef.current.volume
        let step = 0
        const STEPS = 10
        sleepFadeRef.current = window.setInterval(() => {
          step += 1
          if (step >= STEPS || el.paused) {
            window.clearInterval(sleepFadeRef.current!)
            sleepFadeRef.current = null
            el.pause()
            // 还原音量但不触发「调音量取消静音」语义之外的变化：
            // 直接写回 state，下一首照常出声
            setState((s) => ({
              ...s,
              volume: preFadeVolumeRef.current,
              sleep: applySleepAction(s.sleep, { type: 'expire' }),
            }))
            return
          }
          setState((s) => ({ ...s, volume: preFadeVolumeRef.current * (1 - step / STEPS) }))
        }, FADE_MS / STEPS)
      }, startFade)
    },
    [clearSleepTimers],
  )

  const setRate = React.useCallback(
    (rate: number) => {
      const v = Math.min(3, Math.max(0.25, rate))
      setState((s) => ({ ...s, rate: v }))
      try {
        localStorage.setItem(STORAGE_RATE, String(v))
      } catch {
        /* 隐私模式：不持久化也能用，不炸主流程 */
      }
      applyPlaybackRate(v)
    },
    [applyPlaybackRate],
  )

  const setAudioCacheOn = React.useCallback((on: boolean) => {
    setState((s) => ({ ...s, audioCacheOn: on }))
    try {
      localStorage.setItem(STORAGE_AUDIO_CACHE, on ? '1' : '0')
    } catch {
      /* 隐私模式：不持久化也能用 */
    }
  }, [])

  /** 倍速落到 <audio> 并持久化。正在播放时立刻按新档位重新解析当前曲目 ——
   *  否则用户改了档位却要等下一首才生效，与「改设置即时生效」的预期不符。
   *  注意把 tier 显式传给 loadAndPlay：setState 是异步的，此刻 stateRef 还是旧值。 */
  const setQuality = React.useCallback(
    (tier: string) => {
      if (stateRef.current.preferredQuality === tier) return
      setState((s) => ({ ...s, preferredQuality: tier }))
      const cur = stateRef.current.current
      if (cur && !cur.url) {
        // 本地音乐是直链、不走解析器，切档位对它无意义
        void loadAndPlay(cur, tier)
      }
    },
    [loadAndPlay],
  )

  /** 开关「按曲目自动选最高可用档位」。
   *
   *  这是**播放策略**而不是纯显示偏好，所以开启/关闭都要对正在播的曲目立刻生效：
   *  否则用户打开了开关却发现当前这首没变，会以为没生效（与 setQuality 同理）。
   *  两个方向都重新解析：开启→可能抬到更高档；关闭→退回用户首选。
   *  显式传 autoBestOverride：setState 是异步的，此刻 stateRef 还是旧值。 */
  const setAutoBestQuality = React.useCallback(
    (on: boolean) => {
      if (stateRef.current.autoBestQuality === on) return
      setState((s) => ({ ...s, autoBestQuality: on }))
      const cur = stateRef.current.current
      if (cur && !cur.url) void loadAndPlay(cur, undefined, on)
    },
    [loadAndPlay],
  )

  const stopAudio = React.useCallback(() => {
    reqSeqRef.current += 1
    cacheWriteSeqRef.current = reqSeqRef.current // 让进行中的后台缓存作废
    cacheFetchAbortRef.current?.abort()
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = null
    }
    abortRef.current?.abort()
    // 清空/切换队列时解除上报守卫，避免「同一首歌在两次播放会话里只记一次」
    reportedRef.current = ''
    const el = audioRef.current
    if (el) {
      el.pause()
      el.removeAttribute('src')
      el.load()
    }
  }, [])

  /** 复位播放态。注意：**播放偏好（音量/静音/随机/循环/音质）必须原样保留**——
   *  它们与「当前在播什么」无关，清掉会让用户每次退出登录都被重置一遍。
   *  （原实现只保留了 volume/muted，shuffle/repeat 会被悄悄重置回默认值。） */
  const clear = React.useCallback(() => {
    stopAudio()
    setState((s) => ({
      ...initialState,
      volume: s.volume,
      muted: s.muted,
      shuffle: s.shuffle,
      repeat: s.repeat,
      preferredQuality: s.preferredQuality,
    }))
  }, [stopAudio])

  const removeAt = React.useCallback(
    (index: number) => {
      const s = stateRef.current
      if (index < 0 || index >= s.queue.length) return
      const nextQueue = s.queue.filter((_, i) => i !== index)
      if (!nextQueue.length) {
        stopAudio()
        // 同上：清空队列只重置「在播什么」，播放偏好一律保留
        setState((p) => ({
          ...initialState,
          volume: p.volume,
          muted: p.muted,
          shuffle: p.shuffle,
          repeat: p.repeat,
          preferredQuality: p.preferredQuality,
        }))
        return
      }
      if (index === s.index) {
        // 删掉正在播的：顺延到下一首（越界回到最后一首）
        const idx = Math.min(index, nextQueue.length - 1)
        const song = nextQueue[idx]
        setState((p) => ({ ...p, queue: nextQueue, index: idx, current: song, position: 0, duration: 0 }))
        void loadAndPlay(song)
        return
      }
      const idx = index < s.index ? s.index - 1 : s.index
      setState((p) => ({
        ...p,
        queue: nextQueue,
        index: idx,
        current: nextQueue[idx] ?? p.current,
      }))
    },
    [loadAndPlay, stopAudio],
  )

  // 播放自然结束 → 按播放模式推进（单曲循环重播本首、顺序播放在末尾停下）。
  // 例外：睡眠定时「播完当前这首」—— ended 是停止点不是推进点（单曲循环也一样停）。
  React.useEffect(() => {
    const el = audioRef.current
    if (!el) return
    const onEnded = () => {
      if (stateRef.current.sleep.mode === 'endOfSong') {
        el.pause()
        setState((s) => ({ ...s, sleep: applySleepAction(s.sleep, { type: 'songEnded' }) }))
        return
      }
      advance(1, true)
    }
    el.addEventListener('ended', onEnded)
    return () => el.removeEventListener('ended', onEnded)
  }, [advance])

  // 键盘：空格播放/暂停，Shift+←/→ 上下一首（输入框内不拦截）
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.code === 'Space') {
        e.preventDefault()
        toggle()
      } else if (e.code === 'ArrowRight' && e.shiftKey) {
        next()
      } else if (e.code === 'ArrowLeft' && e.shiftKey) {
        prev()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, next, prev])

  const api = React.useMemo<PlayerApi>(
    () => ({
      ...state,
      playSong,
      playQueue,
      playAt,
      toggle,
      next,
      prev,
      seek,
      setVolume,
      toggleMute,
      toggleShuffle,
      cycleRepeat,
      setSleep,
      setRate,
      setAudioCacheOn,
      setQuality,
      setAutoBestQuality,
      clear,
      retry,
      removeAt,
    }),
    [
      state,
      playSong,
      playQueue,
      playAt,
      toggle,
      next,
      prev,
      seek,
      setVolume,
      toggleMute,
      toggleShuffle,
      cycleRepeat,
      setSleep,
      setRate,
      setAudioCacheOn,
      setQuality,
      setAutoBestQuality,
      clear,
      retry,
      removeAt,
    ],
  )

  return (
    <PlayerContext.Provider value={api}>
      {children}
      {/* 约束一：唯一的 <audio>，永远挂在树根，不随任何条件挂载/卸载。
          刻意不设 crossOrigin —— 设了会强制 CORS 请求，多数音源 CDN 不带
          CORS 头，反而直接播不了（后续要做 Web Audio 可视化时再单独评估）。 */}
      <audio ref={audioRef} preload="metadata" />
    </PlayerContext.Provider>
  )
}

export function usePlayer(): PlayerApi {
  const ctx = React.useContext(PlayerContext)
  if (!ctx) throw new Error('usePlayer 必须在 <PlayerProvider> 内使用')
  return ctx
}
