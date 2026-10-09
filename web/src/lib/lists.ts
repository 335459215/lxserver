/** 歌单 / 收藏接口层。
 *
 *  接口面与鉴权见 docs/stage0/api-and-state-map.md：
 *   - `GET  /api/user/list`              混合鉴权：具名用户须带 token（见 userAuthHeaders）
 *   - `POST /api/music/user/list/add`    用户 token，body { listId, musicInfos, location? }
 *   - `POST /api/music/user/list/remove` 用户 token，body { listId, songIds }
 *
 *  返回形状见 src/types/list.d.ts：
 *    { defaultList: MusicInfo[], loveList: MusicInfo[], userList: [{ ...info, list: MusicInfo[] }] }
 *  其中 MusicInfo = { id, name, singer, source, interval, meta: { songId, albumName, picUrl, qualitys } }
 */
import { userAuthHeaders } from '@/lib/auth'
import type { Song } from '@/lib/music'

/** 服务端内置列表 id（src/constants.ts LIST_IDS） */
export const LIST_DEFAULT_ID = 'default'
export const LIST_LOVE_ID = 'love'

/** 歌单元信息（不含曲目） */
export interface PlaylistInfo {
  id: string
  name: string
  /** 网络歌单来源平台（kw/wy/tx/kg/mg） */
  source?: string
  /** 有值即为外部导入的网络歌单 */
  sourceListId?: string
  locationUpdateTime?: number | null
}

export interface Playlist extends PlaylistInfo {
  songs: Song[]
}

export interface ListsSnapshot {
  /** 试听列表（旧版播放器的默认列表） */
  defaultList: Song[]
  /** 我的收藏（喜欢） */
  loveList: Song[]
  /** 用户自建 / 导入的歌单 */
  userList: Playlist[]
}

export class ListsApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ListsApiError'
  }
}

interface RawUserList extends PlaylistInfo {
  list?: Song[]
}

interface RawListData {
  defaultList?: Song[]
  loveList?: Song[]
  userList?: RawUserList[]
}

/** 拉取当前用户的全部列表（试听/收藏/自建歌单） */
export async function fetchLists(signal?: AbortSignal): Promise<ListsSnapshot> {
  const auth = userAuthHeaders()
  // 没以用户身份登录时服务端必然 401，这里直接给出可执行提示，不发这一枪
  if (!auth['x-user-token']) {
    throw new ListsApiError('歌单属于登录账号，请先用「用户」身份登录（管理员密码看不到歌单）')
  }

  const res = await fetch('/api/user/list', {
    headers: auth,
    signal,
    cache: 'no-store',
  })
  if (res.status === 401) throw new ListsApiError('登录已过期，请重新登录后再看歌单')
  const data = (await res.json().catch(() => null)) as RawListData | null
  if (!res.ok || !data) throw new ListsApiError(`读取歌单失败（HTTP ${res.status}）`)

  return {
    defaultList: data.defaultList ?? [],
    loveList: data.loveList ?? [],
    userList: (data.userList ?? []).map((l) => {
      const { list, ...info } = l
      return { ...info, songs: list ?? [] }
    }),
  }
}

/** 从快照里按 id 找列表（'default' / 'love' / 用户歌单 id） */
export function findPlaylist(
  snapshot: ListsSnapshot | null,
  id: string | undefined,
): Playlist | null {
  if (!snapshot || !id) return null
  if (id === LIST_DEFAULT_ID) {
    return { id: LIST_DEFAULT_ID, name: '试听列表', songs: snapshot.defaultList }
  }
  if (id === LIST_LOVE_ID) {
    return { id: LIST_LOVE_ID, name: '我的收藏', songs: snapshot.loveList }
  }
  return snapshot.userList.find((l) => l.id === id) ?? null
}

/** 把若干首歌加入指定列表；location 不传则用账号偏好 */
export async function addSongsToPlaylist(
  listId: string,
  musicInfos: Song[],
  location?: 'top' | 'bottom',
): Promise<void> {
  const res = await fetch('/api/music/user/list/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...userAuthHeaders() },
    body: JSON.stringify({ listId, musicInfos, location }),
  })
  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    throw new ListsApiError(msg || `加入歌单失败（HTTP ${res.status}）`)
  }
}

/** 从指定列表移除若干首歌（songIds 为 MusicInfo.id） */
export async function removeSongsFromPlaylist(listId: string, songIds: string[]): Promise<void> {
  const res = await fetch('/api/music/user/list/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...userAuthHeaders() },
    body: JSON.stringify({ listId, songIds }),
  })
  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    throw new ListsApiError(msg || `移除歌曲失败（HTTP ${res.status}）`)
  }
}

/** 歌单曲目的稳定 key（id 优先，回落 平台+歌名+歌手） */
export function songKeyOf(song: Song, index: number): string {
  return String(song.id ?? `${song.source}-${song.name}-${song.singer}-${index}`)
}
