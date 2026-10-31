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
import { coverUrl, type Song } from '@/lib/music'

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

/** 整份写回歌单（POST /api/user/list = 全量恢复语义：先清空再重建）。
 *
 *  ⚠️ 调用方必须先拉**最新**全量、在内存里合并完再传 —— 直接把外部文件
 *  POST 上去等于清空用户现有歌单。歌单导入（playlistTransfer）走这条。
 *  wire 形状：userList 每项的曲目字段是 list（不是快照里的 songs）。 */
export async function restoreLists(raw: {
  defaultList: Song[]
  loveList: Song[]
  userList: Array<{ id: string; name: string; list: Song[]; [key: string]: unknown }>
}): Promise<void> {
  const auth = userAuthHeaders()
  if (!auth['x-user-token']) throw new ListsApiError('登录已过期，请重新登录后再导入')
  const res = await fetch('/api/user/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify(raw),
  })
  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    throw new ListsApiError(msg || `写回歌单失败（HTTP ${res.status}）`)
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
/** 把歌曲加到**内置列表**（试听 default / 收藏 love）。
 *
 *  已有的增量接口，不做去重（服务端按 id 判重，同 id 再加不会重复）。
 *  自建歌单请用 addSongsToUserPlaylist —— 那个走 restore 通道并做了去重。 */
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

/** 新建一个空歌单，返回新歌单 id。
 *
 *  【为什么是「整份读出来 → 加一条 → 整份写回」这么绕】
 *  服务端**没有**「新建歌单」这种增量接口。`POST /api/user/list` 的语义是
 *  **整份恢复（restore）**：它先 `allMusicList.clear()`、`userLists = []`，
 *  再按传入的 defaultList/loveList/userList 重建（见 listDataManage.restore）。
 *  所以想只加一个歌单，就必须先把当前全量读出来、在 userList 末尾追加一条空歌单、
 *  再整份写回；漏掉任何一段都会把别的歌单清掉。
 *
 *  id 用 `user_<时间戳>`：服务端只要求 id 唯一（userListCreate 里查重），
 *  带时间戳既避免撞车，排查时也能一眼看出是什么时候建的。 */
export async function createPlaylist(name: string): Promise<string> {
  const trimmed = name.trim()
  if (!trimmed) throw new ListsApiError('歌单名不能为空')
  const auth = userAuthHeaders()
  if (!auth['x-user-token']) throw new ListsApiError('歌单属于登录账号，请先登录')

  const res = await fetch('/api/user/list', { headers: auth, cache: 'no-store' })
  if (res.status === 401) throw new ListsApiError('登录已过期，请重新登录后再建歌单')
  if (!res.ok) throw new ListsApiError(`读取歌单失败（HTTP ${res.status}）`)
  const data = (await res.json().catch(() => null)) as RawListData | null
  if (!data) throw new ListsApiError('读取歌单失败：返回内容不是 JSON')

  const id = `user_${Date.now()}`
  const next = {
    defaultList: data.defaultList ?? [],
    loveList: data.loveList ?? [],
    userList: [
      ...(data.userList ?? []).map((l) => ({ ...l, list: l.list ?? [] })),
      { id, name: trimmed, list: [] as Song[] },
    ],
  }

  const put = await fetch('/api/user/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify(next),
  })
  if (!put.ok) {
    const msg = await put.text().catch(() => '')
    throw new ListsApiError(msg || `新建歌单失败（HTTP ${put.status}）`)
  }
  return id
}

/** 歌单曲目的稳定 key（id 优先，回落 平台+歌名+歌手） */
export function songKeyOf(song: Song, index: number): string {
  return String(song.id ?? `${song.source}-${song.name}-${song.singer}-${index}`)
}

/** 读出当前全量快照（restore 写回前的必读步骤，见 createPlaylist 的长注释）。 */
async function readRawLists(): Promise<RawListData> {
  const res = await fetch('/api/user/list', { headers: userAuthHeaders(), cache: 'no-store' })
  if (res.status === 401) throw new ListsApiError('登录已过期，请重新登录后再操作歌单')
  if (!res.ok) throw new ListsApiError(`读取歌单失败（HTTP ${res.status}）`)
  const data = (await res.json().catch(() => null)) as RawListData | null
  if (!data) throw new ListsApiError('读取歌单失败：返回内容不是 JSON')
  return data
}

/** 整份写回（restore 语义）。调用方必须先 readRawLists() 再只改一侧。 */
async function writeRawLists(next: {
  defaultList: Song[]
  loveList: Song[]
  userList: Array<{ id: string; name: string; list: Song[]; [key: string]: unknown }>
}): Promise<void> {
  const auth = userAuthHeaders()
  if (!auth['x-user-token']) throw new ListsApiError('登录已过期，请重新登录后再操作歌单')
  const res = await fetch('/api/user/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify(next),
  })
  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    throw new ListsApiError(msg || `写回歌单失败（HTTP ${res.status}）`)
  }
}

/** 把快照规整成可写回的 wire 形状（userList 每项必须带 `list`）。 */
function toWire(data: RawListData) {
  return {
    defaultList: data.defaultList ?? [],
    loveList: data.loveList ?? [],
    userList: (data.userList ?? []).map((l) => ({ ...l, list: l.list ?? [] })),
  }
}

/** 重命名自建歌单。
 *
 *  服务端确实有 `POST /api/data/rename-playlist`，但那是**旧数据管理面板**的接口：
 *  它要求 `{ username, playlistId, newName }` 且走 admin-only 鉴权，还会在
 *  每次改名时打一张快照。前端主体（/api/user/list）从来不调它 —— 这就是
 *  「歌单不能改名」的直接原因。
 *
 *  这里走前端已有的 restore 通道：读全量 → 只改目标歌单的 name → 整份写回。
 *  好处是鉴权与其它歌单操作完全一致（用户 token 即可，不必是管理员），
 *  也不会因为多打快照把快照位占满（服务端 maxSnapshotNum 默认 10）。 */
export async function renamePlaylist(listId: string, newName: string): Promise<void> {
  const trimmed = newName.trim()
  if (!trimmed) throw new ListsApiError('歌单名不能为空')
  const data = await readRawLists()
  const wire = toWire(data)
  const target = wire.userList.find((l) => l.id === listId)
  if (!target) throw new ListsApiError('找不到这个歌单（可能已被删除）')
  await writeRawLists({
    ...wire,
    userList: wire.userList.map((l) => (l.id === listId ? { ...l, name: trimmed } : l)),
  })
}

/** 删除整个自建歌单（连同其中的曲目）。
 *
 *  同 renamePlaylist：服务端 `/api/data/delete-playlist` 是旧管理面板接口，
 *  前端从不调用；这里用 restore 通道删掉目标项后整份写回。
 *
 *  ⚠️ 内置的「试听列表 / 我的收藏」不允许删 —— 它们的 id 是 default/love，
 *  服务端 restore 会把它们重建，删了也不会消失，只会让人以为没生效。 */
export async function deletePlaylist(listId: string): Promise<void> {
  if (listId === LIST_DEFAULT_ID || listId === LIST_LOVE_ID) {
    throw new ListsApiError('试听列表与我的收藏是内置列表，不能删除')
  }
  const data = await readRawLists()
  const wire = toWire(data)
  if (!wire.userList.some((l) => l.id === listId)) {
    throw new ListsApiError('找不到这个歌单（可能已被删除）')
  }
  await writeRawLists({
    ...wire,
    userList: wire.userList.filter((l) => l.id !== listId),
  })
}

/** 歌单曲目的判重键：平台 + songmid/id。
 *  加歌前用它过滤，避免同一首歌被重复塞进同一个歌单。 */
export function playlistSongKey(song: Song): string {
  const mid = String(song.songmid ?? song.meta?.songId ?? song.id ?? '')
  return `${song.source}::${mid || `${song.name}::${song.singer}`}`
}

/** 把歌加到指定歌单（去重，加在顶部）。
 *
 *  此前全站只有「收藏到我的收藏」（KeyboardShortcuts 里直接写死 love 列表），
 *  没有任何入口能把歌放进**自建歌单** —— 建好的歌单永远加不进歌，
 *  这是「歌单不能编辑」的另一半原因。 */
export async function addSongsToUserPlaylist(listId: string, songs: Song[]): Promise<number> {
  if (!songs.length) return 0
  const data = await readRawLists()
  const wire = toWire(data)
  const target = wire.userList.find((l) => l.id === listId)
  if (!target) throw new ListsApiError('找不到这个歌单（可能已被删除）')

  const seen = new Set(target.list.map((s) => playlistSongKey(s)))
  const fresh = songs.filter((s) => {
    const k = playlistSongKey(s)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  if (!fresh.length) return 0

  // 与账号偏好一致：'top' 时新歌放最前（默认 addMusicLocationType='top'）
  const merged = [...fresh, ...target.list]
  await writeRawLists({
    ...wire,
    userList: wire.userList.map((l) => (l.id === listId ? { ...l, list: merged } : l)),
  })
  return fresh.length
}

/** 歌单封面：优先**随机**取一首带封面的曲目，其次取第一首有封面的。
 *
 *  为什么随机：固定取第一首时，同一个歌单的封面永远是那张，几张歌单看起来
 *  一模一样；随机取能让每个歌单有辨识度。用 useMemo 在渲染期算一次即可，
 *  不要在 render 里直接 Math.random()（会导致每次重渲染都换图闪烁）。
 *
 *  返回 undefined 表示整个歌单都没有封面 —— 调用方此时必须**画占位图**，
 *  不能留白（见 PlaylistCard 的渐变兜底）。 */
export function playlistCoverUrl(songs: Song[]): string | undefined {
  const withCover = songs.map((s) => coverUrl(s)).filter((u): u is string => !!u)
  if (!withCover.length) return undefined
  return withCover[Math.floor(Math.random() * withCover.length)]
}
