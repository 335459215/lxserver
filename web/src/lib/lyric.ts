/** 歌词：拉取 + LRC 解析（支持翻译 / 音译 / 逐字）。
 *
 * 服务端接口（现成，无需改服务端）：
 *   GET /api/music/lyric?source=&songmid=&name=&singer=&interval=&hash=
 *                       &copyrightId=&albumId=&lrcUrl=&mrcUrl=&trcUrl=
 *   返回 SDK 原样结构 { lyric, tlyric?, rlyric?, lxlyric? }，均为 LRC 文本，字段可能缺失或为空串；
 *   命中本地 .lrc 缓存时额外带 _fromLocalCache: true。
 *   无歌词时服务端返回 500 + text/plain —— fetchLyric 把它当作「该源无歌词」，
 *   自动按 LYRIC_FALLBACK_SOURCES 换源再取（见下方注释），全部落空才按「暂无歌词」处理。
 *
 * 逐字标签 <起始, 数值> 的语义各平台不一致（见 §parseWords 注释），这里做了自动判型。
 */
import * as React from 'react'
import { userAuthHeaders } from '@/lib/auth'
import { MusicApiError, type Song } from '@/lib/music'

/** 逐字：相对本行开头的毫秒偏移与持续时长 */
export interface LyricWord {
  start: number
  duration: number
  text: string
}

export interface LyricLine {
  /** 行开始时间（秒） */
  time: number
  text: string
  /** 翻译（tlyric 就近对齐） */
  translation?: string
  /** 音译（rlyric 就近对齐） */
  roma?: string
  /** 逐字（lxlyric），有则可做卡拉 OK 高亮 */
  words?: LyricWord[]
}

export interface LyricData {
  lines: LyricLine[]
  /** 没有时间轴的纯文本歌词（极少数源会这样返回） */
  plain: string | null
  hasTranslation: boolean
  hasWord: boolean
}

/** 支持在线歌词的音源（local / custom 没有这个接口） */
const LYRIC_SOURCES = new Set(['kw', 'wy', 'tx', 'kg', 'mg'])

const EMPTY: LyricData = { lines: [], plain: null, hasTranslation: false, hasWord: false }

// ===== LRC 解析 =====

/** "00:12.34" / "00:12:34" / "00:12" → 秒。1/2/3 位小数分别按 100/10/1 毫秒补足 */
function toSeconds(min: string, sec: string, frac?: string): number {
  const m = Number.parseInt(min, 10)
  const s = Number.parseInt(sec, 10)
  let ms = 0
  if (frac) {
    const f = Number.parseInt(frac, 10)
    ms = frac.length >= 3 ? f : frac.length === 2 ? f * 10 : f * 100
  }
  return m * 60 + s + ms / 1000
}

interface RawLine {
  time: number
  text: string
}

/** 解析带时间轴的 LRC；忽略头部标签行（[ti:]/[ar:]/[offset:]…）与空文本行 */
function parseTimedLrc(text: string): RawLine[] {
  if (!text) return []
  const tag = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
  const out: RawLine[] = []

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.includes('[')) continue

    tag.lastIndex = 0
    const marks: Array<{ time: number; end: number }> = []
    let m: RegExpExecArray | null
    while ((m = tag.exec(line))) {
      marks.push({ time: toSeconds(m[1], m[2], m[3]), end: m.index + m[0].length })
    }
    if (!marks.length) continue

    // 文本取最后一个时间标签之后的内容（一行多标签时同一文本重复挂到各时间点）
    const last = marks[marks.length - 1]
    const content = line.slice(last.end).trim()
    if (!content) continue
    for (const mark of marks) out.push({ time: mark.time, text: content })
  }

  out.sort((a, b) => a.time - b.time)
  return out
}

/** 取时间最接近的一行文本（容差 0.8s）；找不到返回 undefined。
 *  各平台翻译行的时间轴未必与主歌词严格对齐，故用就近匹配而非等值匹配。 */
function nearest(list: RawLine[], time: number): string | undefined {
  let best: RawLine | null = null
  let bestDiff = Number.POSITIVE_INFINITY
  for (const item of list) {
    const diff = Math.abs(item.time - time)
    if (diff < bestDiff) {
      bestDiff = diff
      best = item
    }
  }
  return best && bestDiff <= 0.8 ? best.text : undefined
}

const WORD_TAG = /<(\d+),(\d+)>([^<]*)/g

/** 解析逐字标签。
 *
 *  各平台第二个数值语义不同（实测 2026-10）：
 *   - 酷我：`<起始, 时长>`      —— 下一词的 start == 本词 start + second
 *   - 网易/咪咕：`<起始, 结束偏移>` —— 下一词的 start == 本词 second
 *  这里用「下一词的 start」统一确定每个词的结束边界（两种语义下都成立），
 *  只有最后一个词需要先投票判型再算时长 —— 即使判错也只影响最后一词的收尾。 */
function parseWords(content: string): LyricWord[] | null {
  if (!content.includes('<')) return null

  WORD_TAG.lastIndex = 0
  const raw: Array<{ start: number; second: number; text: string }> = []
  let m: RegExpExecArray | null
  while ((m = WORD_TAG.exec(content))) {
    raw.push({ start: Number.parseInt(m[1], 10), second: Number.parseInt(m[2], 10), text: m[3] })
  }
  if (raw.length < 2) return null

  let durationStyle = 0
  let endStyle = 0
  for (let i = 0; i < raw.length - 1; i++) {
    const cur = raw[i]
    const next = raw[i + 1]
    if (next.start === cur.start + cur.second) durationStyle++
    else if (next.start === cur.second) endStyle++
  }
  const asDuration = durationStyle >= endStyle

  return raw.map((w, i) => {
    const next = raw[i + 1]
    const end = next ? next.start : asDuration ? w.start + w.second : w.second
    return { start: w.start, duration: Math.max(0, end - w.start), text: w.text }
  })
}

interface LyricPayload {
  lyric?: string | null
  tlyric?: string | null
  rlyric?: string | null
  lxlyric?: string | null
}

/** 把服务端返回的歌词文本解析成可渲染结构 */
export function parseLyric(payload: LyricPayload): LyricData {
  const lyricText = payload.lyric ?? ''
  const main = parseTimedLrc(lyricText)

  // 无时间轴：极少数源直接给纯文本，原样展示（不参与滚动高亮）
  if (!main.length) {
    const plain = lyricText.trim()
    return { lines: [], plain: plain || null, hasTranslation: false, hasWord: false }
  }

  const trans = parseTimedLrc(payload.tlyric ?? '')
  const roma = parseTimedLrc(payload.rlyric ?? '')
  const wordLines = parseTimedLrc(payload.lxlyric ?? '')

  const wordMap = new Map<number, LyricWord[]>()
  for (const wl of wordLines) {
    const words = parseWords(wl.text)
    if (words) wordMap.set(Math.round(wl.time * 1000), words)
  }

  const lines: LyricLine[] = main.map((l) => ({
    time: l.time,
    text: l.text,
    translation: nearest(trans, l.time),
    roma: nearest(roma, l.time),
    words: wordMap.get(Math.round(l.time * 1000)),
  }))

  return {
    lines,
    plain: null,
    hasTranslation: lines.some((l) => !!l.translation),
    hasWord: lines.some((l) => !!l.words),
  }
}

// ===== 拉取 =====

/** 收集歌词接口参数：各平台字段不一，歌单曲目还会把它们塞进 meta 下 */
function lyricParams(song: Song): Record<string, string> {
  const meta = (song.meta ?? {}) as Record<string, unknown>
  const self = song as unknown as Record<string, unknown>
  const pick = (key: string): string => {
    const v = self[key] ?? meta[key]
    return v == null ? '' : String(v)
  }
  return {
    source: song.source,
    songmid: pick('songmid') || pick('id') || pick('songId'),
    name: song.name ?? '',
    singer: song.singer ?? '',
    interval: song.interval ?? '',
    hash: pick('hash'),
    copyrightId: pick('copyrightId'),
    albumId: pick('albumId'),
    lrcUrl: pick('lrcUrl'),
    mrcUrl: pick('mrcUrl'),
    trcUrl: pick('trcUrl'),
  }
}

/** 无歌词时的回退源（按序尝试）。
 *
 *  【为什么只有 kg】酷狗的歌词接口按**歌名 + 时长**搜酷狗歌词库
 *  （lyrics.kugou.com/search），不依赖平台 songmid —— 拿着 kw 的歌
 *  一次请求就能直接查。而 wy/tx/mg 的歌词接口都要**本平台的 songmid**，
 *  回退得先跨平台搜索换 ID：两次请求，且可能匹配到同名别的歌 ——
 *  错歌词比没歌词更糟。故第一版只回退 kg（它也是覆盖面最大的歌词库），
 *  链是数组，后续要加源往里放即可。
 */
const LYRIC_FALLBACK_SOURCES = ['kg']

/** 从指定源拉歌词。返回 null = 该源没有这首歌的歌词（服务端对此回 5xx），
 *  其它失败（4xx/格式异常/网络）照常抛错。 */
async function fetchLyricPayload(
  source: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<LyricPayload | null> {
  const res = await fetch(`/api/music/lyric?${new URLSearchParams({ ...params, source }).toString()}`, {
    signal,
    // 带上用户身份：服务端据此优先命中该用户已缓存的 .lrc（不带会退化成公开用户 open）
    headers: userAuthHeaders(),
  })
  // 本路由「无歌词」的信号就是 5xx（见文件头注释）——那是正常状态不是故障
  if (res.status >= 500) return null
  if (!res.ok) throw new MusicApiError(`HTTP ${res.status}`)
  const data = (await res.json().catch(() => null)) as LyricPayload | null
  if (!data) throw new MusicApiError('歌词返回格式异常')
  return data
}

export interface LyricResult {
  data: LyricData
  /** 实际给出歌词的源；等于本源 = 没发生回退 */
  fromSource: string
}

export async function fetchLyric(song: Song, signal?: AbortSignal): Promise<LyricResult> {
  if (!LYRIC_SOURCES.has(song.source)) return { data: EMPTY, fromSource: song.source }

  const params = lyricParams(song)
  if (!params.songmid) return { data: EMPTY, fromSource: song.source }

  const attempts: Array<{ source: string; params: Record<string, string> }> = [
    { source: song.source, params },
  ]
  for (const fb of LYRIC_FALLBACK_SOURCES) {
    if (fb === song.source) continue
    attempts.push({
      source: fb,
      params: {
        ...params,
        // 异源的字段对回退目标是脏提示：kg 按名搜，kw 的 hash/咪咕的
        // lrcUrl 等只会干扰匹配，全部清空让它纯按「名 + 时长」找
        hash: '',
        copyrightId: '',
        albumId: '',
        lrcUrl: '',
        mrcUrl: '',
        trcUrl: '',
      },
    })
  }

  for (let i = 0; i < attempts.length; i++) {
    const at = attempts[i]
    let payload: LyricPayload | null
    if (i === 0) {
      // 本源的错误照旧抛：网络断了/鉴权失败该显示「重试」，而不是悄悄回退
      payload = await fetchLyricPayload(at.source, at.params, signal)
    } else {
      try {
        payload = await fetchLyricPayload(at.source, at.params, signal)
      } catch (e) {
        // 换歌的 abort 必须穿透，否则旧请求的回退会覆盖新歌的状态
        if (e instanceof DOMException && e.name === 'AbortError') throw e
        // 本源已判「无歌词」，回退拿不到就按无歌词收场，不升级成错误态
        continue
      }
    }
    const data = payload ? parseLyric(payload) : EMPTY
    if (data.lines.length > 0 || data.plain) return { data, fromSource: at.source }
  }
  return { data: EMPTY, fromSource: song.source }
}

// ===== Hook =====

export type LyricStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

export interface LyricState {
  status: LyricStatus
  data: LyricData | null
  error: string | null
  /** 实际给出歌词的源（回退成功时 ≠ song.source）；无歌词/出错时为本源或 null */
  fromSource: string | null
}

/** 曲目唯一键：只有换了歌才重新拉歌词（同一首歌的 position 更新不该触发） */
function lyricKey(song: Song | null): string {
  if (!song) return ''
  const id = song.songmid ?? song.id ?? song.meta?.songId ?? song.name
  return `${song.source}:${id}`
}

/** 当前曲目的歌词。失败与「暂无歌词」区分：后者是正常状态，不显示重试。 */
export function useLyric(song: Song | null): LyricState & { reload: () => void } {
  const [state, setState] = React.useState<LyricState>({
    status: 'idle',
    data: null,
    error: null,
    fromSource: null,
  })
  const [nonce, setNonce] = React.useState(0)

  // song 只作为「最新值」读取；重拉与否由 key 决定，避免对象引用变化引发重复请求
  const songRef = React.useRef(song)
  React.useEffect(() => {
    songRef.current = song
  })
  const key = lyricKey(song)

  React.useEffect(() => {
    const target = songRef.current
    if (!target) {
      setState({ status: 'idle', data: null, error: null, fromSource: null })
      return
    }

    const ac = new AbortController()
    let alive = true
    setState({ status: 'loading', data: null, error: null, fromSource: null })

    fetchLyric(target, ac.signal)
      .then(({ data, fromSource }) => {
        if (!alive) return
        const empty = data.lines.length === 0 && !data.plain
        setState({ status: empty ? 'empty' : 'ready', data, error: null, fromSource })
      })
      .catch((e: unknown) => {
        if (!alive) return
        if (e instanceof DOMException && e.name === 'AbortError') return
        const msg = e instanceof Error ? e.message : '歌词获取失败'
        setState({ status: 'error', data: null, error: msg, fromSource: null })
      })

    return () => {
      alive = false
      ac.abort()
    }
  }, [key, nonce])

  const reload = React.useCallback(() => setNonce((n) => n + 1), [])
  return { ...state, reload }
}

/** 当前应高亮的行号（二分查找，找不到返回 -1）。
 *  提前 0.15s 切换，避免高亮总是"慢半拍"。 */
export function activeLineIndex(lines: LyricLine[], position: number): number {
  let lo = 0
  let hi = lines.length - 1
  let ans = -1
  const t = position + 0.15
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].time <= t) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}
