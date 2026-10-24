/** 歌单导入/导出（v2.37.0）的纯逻辑：信封构建、导入解析、合并语义。
 *
 *  【格式】服务端原生形状就是落雪同步协议的 ListDataFull（去 tempList）：
 *    { defaultList: Song[], loveList: Song[], userList: [{id, name, list: Song[]}] }
 *  导出再包一层自描述信封（type/version/exportedAt），导入同时兼容三种：
 *    ① 本站信封 {type:'lxserver.playlists', data}
 *    ② 落雪桌面「部分备份-歌单列表」的 {type:'play_list', data}
 *    ③ 裸的服务端形状（直接把 GET /api/user/list 的响应存成了文件）
 *
 *  【为什么合并而不是整份替换】POST /api/user/list 的语义是**全量恢复**
 *  （先 clear 再重建，见 listDataManage.restore）—— 直接把导入文件 POST 上去
 *  会把用户现有歌单全部抹掉。导入必须：先拉**最新**全量 → 在内存里合并 →
 *  再整份写回。合并规则：
 *    - default/love：按歌曲自然键去重，现有的保序在前，新歌追加
 *    - 用户歌单：现有的全保留；导入的按 id 匹配 —— 命中则把歌合并进去，
 *      未命中则追加为新歌单
 */
import type { Song } from '@/lib/music'

export const EXPORT_TYPE = 'lxserver.playlists'
/** 落雪桌面的部分备份类型标识（兼容读取用） */
const DESKTOP_TYPE = 'play_list'

export interface RawUserList {
  id: string
  name: string
  list: Song[]
  [key: string]: unknown
}

export interface RawListData {
  defaultList: Song[]
  loveList: Song[]
  userList: RawUserList[]
}

export class PlaylistImportError extends Error {}

/** 歌曲判重键：**source+songmid 平台自然键优先**（与 L 键收藏同一原则 ——
 *  收藏/备份里可能混着落雪桌面写的条目，id 格式互不相同，只有平台自然键
 *  能把它们判为同一首）；songmid 缺失回落 id；再缺失回落 名+歌手。 */
function songKey(s: Song): string {
  const mid = s.songmid ?? s.meta?.songId
  if (mid != null && String(mid) !== '') return `s:${s.source}_${mid}`
  if (s.id != null && String(s.id) !== '') return `id:${s.id}`
  return `n:${s.source}_${s.name}_${s.singer ?? ''}`
}

/** base 保序在前，add 里 base 没有的追加到后 */
function dedupSongs(base: readonly Song[], add: readonly Song[]): Song[] {
  const seen = new Set(base.map(songKey))
  const out = [...base]
  for (const s of add) {
    const k = songKey(s)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
  }
  return out
}

export interface ExportEnvelope {
  type: string
  version: number
  exportedAt: string
  data: RawListData
}

export function buildExport(data: RawListData): string {
  const envelope: ExportEnvelope = {
    type: EXPORT_TYPE,
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      defaultList: data.defaultList ?? [],
      loveList: data.loveList ?? [],
      userList: (data.userList ?? []).map((l) => ({ ...l, list: l.list ?? [] })),
    },
  }
  return JSON.stringify(envelope, null, 2)
}

function asRawListData(v: unknown, where: string): RawListData {
  if (typeof v !== 'object' || v == null) throw new PlaylistImportError(`${where}不是对象`)
  const o = v as Record<string, unknown>
  const isArr = (x: unknown): x is Song[] => Array.isArray(x)
  if (!isArr(o.defaultList) || !isArr(o.loveList) || !Array.isArray(o.userList)) {
    throw new PlaylistImportError(`${where}缺少 defaultList / loveList / userList 数组字段`)
  }
  const userList: RawUserList[] = []
  for (const raw of o.userList) {
    if (typeof raw !== 'object' || raw == null) continue
    const l = raw as Record<string, unknown>
    const id = String(l.id ?? '')
    const name = String(l.name ?? '未命名歌单')
    userList.push({ ...(l as RawUserList), id, name, list: isArr(l.list) ? l.list : [] })
  }
  return { defaultList: o.defaultList, loveList: o.loveList, userList }
}

export function parseImport(text: string): RawListData {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new PlaylistImportError('文件不是有效的 JSON')
  }
  if (typeof parsed !== 'object' || parsed == null) {
    throw new PlaylistImportError('文件内容不是 JSON 对象')
  }
  const o = parsed as Record<string, unknown>
  if (o.type === EXPORT_TYPE || o.type === DESKTOP_TYPE) {
    return asRawListData(o.data, '备份文件的 data 字段')
  }
  // 裸的服务端形状（GET /api/user/list 的响应直接存盘）
  if ('defaultList' in o || 'loveList' in o || 'userList' in o) {
    return asRawListData(parsed, '备份文件')
  }
  throw new PlaylistImportError(
    `不认识的备份格式（type=${String(o.type)}）。支持：本站导出、落雪桌面歌单备份、服务端列表 JSON`,
  )
}

export interface MergeSummary {
  /** 追加为新歌单的数量 */
  newLists: number
  /** 合并进已有歌单（按 id 匹配）的数量 */
  mergedLists: number
  /** 全部列表合计新增的歌曲数 */
  newSongs: number
}

export function mergeImport(
  current: RawListData,
  imported: RawListData,
): { next: RawListData; summary: MergeSummary } {
  const defaultList = dedupSongs(current.defaultList ?? [], imported.defaultList ?? [])
  const loveList = dedupSongs(current.loveList ?? [], imported.loveList ?? [])
  const userList: RawUserList[] = (current.userList ?? []).map((l) => ({ ...l, list: l.list ?? [] }))
  const summary: MergeSummary = { newLists: 0, mergedLists: 0, newSongs: 0 }

  for (const inc of imported.userList ?? []) {
    const existing = userList.find((l) => l.id === inc.id)
    if (existing) {
      const before = existing.list.length
      existing.list = dedupSongs(existing.list, inc.list ?? [])
      if (existing.list.length > before) summary.mergedLists++
    } else {
      userList.push({ ...inc, list: [...(inc.list ?? [])] })
      summary.newLists++
    }
  }

  const count = (l: RawUserList): number => l.list.length
  summary.newSongs =
    defaultList.length - (current.defaultList?.length ?? 0) +
    loveList.length - (current.loveList?.length ?? 0) +
    userList.reduce((acc, l) => acc + count(l), 0) -
    (current.userList ?? []).reduce((acc, l) => acc + (l.list?.length ?? 0), 0)

  return { next: { defaultList, loveList, userList }, summary }
}
