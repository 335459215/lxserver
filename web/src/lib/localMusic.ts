/** 本地音乐：服务端「自定义目录」里的音频文件。
 *
 *  - `GET  /api/music/custom/list`  → `{ success, data: LocalTrack[], allowOperateCustomMusicDir, allowWriteCustomMusicDir }`（需鉴权）
 *  - `POST /api/music/custom/sync`  → 强制重新扫描目录（需鉴权）
 *  - `GET  /api/music/custom/file?filename=&user=&token=`  → 音频流
 *  - `GET  /api/music/custom/cover?filename=&user=&token=` → 封面（内嵌图或同目录图片）
 *
 *  **为什么这两个 URL 走 query 而不是请求头**：`<audio src>` / `<img src>` 没法带请求头。
 *  服务端专门支持把 `user`/`token` 放 query 上再转成鉴权头（见 server.ts 的
 *  `custom/file` / `custom/cover` 分支），旧版播放器也是这么做的。
 *
 *  **本地曲目不走解析器**：`/api/music/url` 只认在线平台，对本地文件必然失败。
 *  所以这里给 `Song.url` 直链，播放内核见到 `url` 就直接播（见 lib/player.tsx）。
 */
import { MusicApiError, type Song } from '@/lib/music'
import { userAuthHeaders } from '@/lib/auth'
import { useAsyncResource, type AsyncResource } from '@/lib/asyncResource'

/** 服务端 custom_index.json 里的一条（字段来自 customMusicManager 的 CustomCacheItem） */
export interface LocalTrack {
  id: string | number
  songmid?: string
  name: string
  singer: string
  album?: string
  albumId?: string | number
  img?: string
  interval?: string
  quality?: string
  /** 相对自定义目录的路径，形如 `歌手 - 歌名.mp3` 或 `subdir/歌手 - 歌名.mp3` */
  filename: string
  subPath?: string
  source?: string
  ext?: string
  size?: number
  bitrate?: number
  sampleRate?: number
  bitDepth?: number
  hasLyric?: boolean
  hasCover?: boolean
  /** 服务端补的在线元信息（关联到在线歌曲时有值） */
  songInfo?: Partial<Song>
}

export interface LocalMusicResult {
  list: LocalTrack[]
  /** 是否允许在服务端做目录级操作（重命名/删除等），由用户配置决定 */
  allowOperateCustomMusicDir: boolean
  allowWriteCustomMusicDir: boolean
}

/** 把用户名与 token 拼成 query，供 <audio>/<img> 这类无法带请求头的场景使用。 */
function authQuery(): string {
  const h = userAuthHeaders()
  const p = new URLSearchParams()
  if (h['x-user-name']) p.set('user', h['x-user-name'])
  if (h['x-user-token']) p.set('token', h['x-user-token'])
  return p.toString()
}

export function localFileUrl(filename: string): string {
  return `/api/music/custom/file?filename=${encodeURIComponent(filename)}&${authQuery()}`
}

export function localCoverUrl(filename: string): string {
  return `/api/music/custom/cover?filename=${encodeURIComponent(filename)}&${authQuery()}`
}

/** 本地曲目 → 可播放的 Song。
 *  `source` 固定成 `local`：解析器不认它，播放内核靠 `url` 走直链。 */
export function toPlayableSong(track: LocalTrack): Song {
  return {
    ...(track.songInfo ?? {}),
    source: 'local',
    id: track.id,
    songmid: track.songmid ?? String(track.id),
    name: track.name,
    singer: track.singer,
    albumName: track.album,
    albumId: track.albumId,
    interval: track.interval,
    // 封面只能从服务端取（内嵌图 / 同目录图片），有封面才给地址
    img: track.hasCover ? localCoverUrl(track.filename) : undefined,
    url: localFileUrl(track.filename),
  }
}

export function useLocalMusic(): AsyncResource<LocalMusicResult> {
  const auth = userAuthHeaders()
  // 本地曲库是**用户级**的（目录按账号配置），没以用户身份登录时服务端必然 401。
  // 这里直接给出可执行提示、不发这一枪 —— 否则页面会白挨一个 401 报错，
  // 用户只看到「读取失败」却不知道是没登录（与 lib/lists.ts 同一处理方式）。
  const key = auth['x-user-token'] ? 'localMusic' : ''

  return useAsyncResource(key, async (signal) => {
    const res = await fetch('/api/music/custom/list', { headers: auth, signal })
    const data: unknown = await res.json().catch(() => null)
    const body = data as
      | { success?: boolean; data?: unknown; message?: string; allowOperateCustomMusicDir?: boolean; allowWriteCustomMusicDir?: boolean }
      | null
    if (res.status === 401) {
      throw new MusicApiError('登录已过期，请重新登录后再看本地音乐')
    }
    if (!res.ok || !body?.success) {
      throw new MusicApiError(body?.message ?? `读取本地曲库失败（HTTP ${res.status}）`)
    }
    return {
      list: Array.isArray(body.data) ? (body.data as LocalTrack[]) : [],
      allowOperateCustomMusicDir: !!body.allowOperateCustomMusicDir,
      allowWriteCustomMusicDir: !!body.allowWriteCustomMusicDir,
    }
  })
}

/** 当前是否具备「以用户身份」的条件（本地音乐页据此提示先登录）。 */
export function hasUserAuth(): boolean {
  return !!userAuthHeaders()['x-user-token']
}

/** 强制服务端重新扫描自定义目录（新增/删除文件后调用）。 */
export async function syncLocalMusic(): Promise<void> {
  const res = await fetch('/api/music/custom/sync', { method: 'POST', headers: userAuthHeaders() })
  const data: unknown = await res.json().catch(() => null)
  const body = data as { success?: boolean; message?: string } | null
  if (!res.ok || !body?.success) {
    throw new MusicApiError(body?.message ?? `重新扫描失败（HTTP ${res.status}）`)
  }
}
