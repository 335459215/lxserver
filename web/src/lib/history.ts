/** 播放历史接口层。
 *
 *  三个接口（均为**用户 token 鉴权**，未登录返回 401）：
 *   - `POST /api/music/history/report`  body 为歌曲字段；服务端按 `source|songmid` 去重
 *   - `GET  /api/music/history/list`    `?page=&pageSize=`，倒序（最近在前）
 *   - `POST /api/music/history/clear`   清空当前用户历史
 *
 *  服务端语义（见 src/modules/history/historyDataManage.ts）：
 *  同一首歌重复播放**不新增条目**，只更新时间戳、递增 playCount 并置顶；
 *  每用户上限 500 条，超出淘汰最旧的。
 */
import { userAuthHeaders } from '@/lib/auth'
import type { Song } from '@/lib/music'

export interface HistoryItem {
  /** `${source}|${songmid}` */
  key: string
  source: string
  songmid: string
  name: string
  singer: string
  interval: string | null
  albumName?: string
  img?: string | null
  /** 最近一次播放时间（毫秒） */
  playedAt: number
  playCount: number
}

export interface HistoryPage {
  list: HistoryItem[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

/** 把历史条目还原成可播放的 Song。
 *  服务端只存了播放必需的字段（省体积），这里补成播放器能直接吃的形状。
 *  注意 `id` 用 songmid 兜底：播放器内部按 songKey（source:songmid）判重与会话。 */
export function historyToSong(item: HistoryItem): Song {
  return {
    id: item.songmid,
    songmid: item.songmid,
    source: item.source as Song['source'],
    name: item.name,
    singer: item.singer,
    interval: item.interval,
    img: item.img ?? undefined,
    albumName: item.albumName,
  } as Song
}

/** 上报一次播放。失败**静默**——上报不是用户主动操作，
 *  失败时弹提示只会打断听歌；服务端侧也只是少一条历史记录。 */
export async function reportHistory(song: Song): Promise<void> {
  const headers = userAuthHeaders()
  if (!Object.keys(headers).length) return // 未登录用户不记历史
  // PWA 离线时不必徒劳发请求（SW 也不缓存 /api/，必然失败）
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  try {
    await fetch('/api/music/history/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        source: song.source,
        songmid: song.songmid ?? song.id ?? song.meta?.songId,
        name: song.name,
        singer: song.singer,
        interval: song.interval ?? null,
        albumName: song.albumName ?? song.meta?.albumName,
        img: song.img ?? song.picUrl ?? song.meta?.picUrl ?? null,
      }),
    })
  } catch {
    // 网络异常静默忽略
  }
}

export async function fetchHistory(page = 1, pageSize = 50): Promise<HistoryPage> {
  const res = await fetch(`/api/music/history/list?page=${page}&pageSize=${pageSize}`, {
    headers: userAuthHeaders(),
  })
  if (res.status === 401) throw new Error('登录已过期，请重新登录后再看播放历史')
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.success) {
    throw new Error(data?.message ?? `读取播放历史失败（HTTP ${res.status}）`)
  }
  return {
    list: Array.isArray(data.list) ? data.list : [],
    total: data.total ?? 0,
    page: data.page ?? page,
    pageSize: data.pageSize ?? pageSize,
    hasMore: !!data.hasMore,
  }
}

export async function clearHistory(): Promise<void> {
  const res = await fetch('/api/music/history/clear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...userAuthHeaders() },
  })
  if (res.status === 401) throw new Error('登录已过期，请重新登录')
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.success) {
    throw new Error(data?.message ?? `清空失败（HTTP ${res.status}）`)
  }
}
