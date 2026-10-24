/**
 * playlistTransfer.test.ts — 歌单导入导出的纯逻辑回归测试。
 *
 * 每个用例对应一个真实会踩的边界（写错会怎样见注释），
 * 配套变异脚本 scripts/mutation-check-playlisttransfer.cjs。
 *
 * 运行：npx tsx --test test/playlistTransfer.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildExport,
  EXPORT_TYPE,
  mergeImport,
  parseImport,
  PlaylistImportError,
  type RawListData,
  type RawUserList,
} from '../web/src/lib/playlistTransfer'
import type { Song } from '../web/src/lib/music'

const song = (id: string, name: string, songmid = id): Song => ({
  id,
  name,
  singer: '歌手',
  source: 'kw',
  songmid,
})

const list = (id: string, name: string, songs: Song[]): RawUserList => ({ id, name, list: songs })

test('导出信封：type/version/exportedAt 齐全，数据归一', () => {
  const out = JSON.parse(buildExport({ defaultList: [song('a', 'A')], loveList: [], userList: [list('u1', '歌单一', [song('b', 'B')])] })) as {
    type: string
    version: number
    exportedAt: string
    data: RawListData
  }
  assert.equal(out.type, EXPORT_TYPE)
  assert.equal(out.version, 1)
  assert.ok(!Number.isNaN(Date.parse(out.exportedAt)))
  assert.equal(out.data.userList.length, 1)
  assert.equal(out.data.userList[0].list.length, 1)
})

test('导入兼容三种格式：本站信封 / 落雪桌面 play_list / 裸服务端形状', () => {
  const data = { defaultList: [song('a', 'A')], loveList: [], userList: [list('u1', 'U', [])] }
  const a = parseImport(JSON.stringify({ type: EXPORT_TYPE, version: 1, data }))
  const b = parseImport(JSON.stringify({ type: 'play_list', data }))
  const c = parseImport(JSON.stringify(data))
  assert.equal(a.userList.length, 1)
  assert.equal(b.userList.length, 1)
  assert.equal(c.userList.length, 1)
})

test('不是 JSON / 缺字段 / 未知格式 → 抛可读的错误', () => {
  assert.throws(() => parseImport('{oops'), PlaylistImportError)
  // 写错会怎样：静默返回空数据会让「导入成功」实际什么都没进来
  assert.throws(() => parseImport('{"type":"lxserver.playlists","data":{}}'), PlaylistImportError)
  assert.throws(() => parseImport('{"hello":1}'), PlaylistImportError)
})

test('导入文件里 userList 项缺 list 字段：按空歌单处理而不是崩', () => {
  const parsed = parseImport(JSON.stringify({ defaultList: [], loveList: [], userList: [{ id: 'x', name: 'Y' }] }))
  assert.equal(parsed.userList[0].list.length, 0)
})

test('合并：同 id 歌单并入歌曲且按自然键去重（不产生重复）', () => {
  const current: RawListData = { defaultList: [], loveList: [], userList: [list('u1', '歌单', [song('a', 'A')])] }
  const imported: RawListData = {
    defaultList: [],
    loveList: [],
    userList: [list('u1', '歌单（别人机器上的同名 id）', [song('a', 'A'), song('b', 'B')])],
  }
  const { next, summary } = mergeImport(current, imported)
  assert.equal(next.userList.length, 1, '同 id 不能长出第二个歌单')
  assert.equal(next.userList[0].list.length, 2, 'a 去重、b 追加')
  assert.equal(summary.mergedLists, 1)
  assert.equal(summary.newSongs, 1)
})

test('合并：不同 id 追加为新歌单，现有歌单一字不动', () => {
  const keep = list('u1', '现有', [song('a', 'A')])
  const current: RawListData = { defaultList: [], loveList: [], userList: [keep] }
  const imported: RawListData = { defaultList: [], loveList: [], userList: [list('u2', '导入', [song('b', 'B')])] }
  const { next, summary } = mergeImport(current, imported)
  assert.equal(next.userList.length, 2)
  assert.deepEqual(next.userList[0], keep, '现有歌单必须原样保留（restore 是全量覆盖，弄丢=删用户数据）')
  assert.equal(summary.newLists, 1)
})

test('合并：default/love 按自然键去重（现有保序在前）', () => {
  const current: RawListData = { defaultList: [song('a', 'A')], loveList: [], userList: [] }
  const imported: RawListData = { defaultList: [song('a', 'A'), song('c', 'C')], loveList: [], userList: [] }
  const { next } = mergeImport(current, imported)
  assert.deepEqual(next.defaultList.map((s) => s.name), ['A', 'C'])
})

test('合并：无 id 的歌曲回落 自然键（source+songmid+名+歌手）判重', () => {
  // 落雪桌面写的条目 id 格式不同，只有回落键能把它们判为同一首
  const s1 = { name: '晴天', singer: '周杰伦', source: 'kw', songmid: '228908' } as Song
  const s2 = { id: 'kw_228908_x', name: '晴天', singer: '周杰伦', source: 'kw', songmid: '228908' } as Song
  const current: RawListData = { defaultList: [s1], loveList: [], userList: [] }
  const imported: RawListData = { defaultList: [s2], loveList: [], userList: [] }
  const { next } = mergeImport(current, imported)
  assert.equal(next.defaultList.length, 1)
})

test('合并：空导入 → 原样返回，summary 全零', () => {
  const current: RawListData = { defaultList: [song('a', 'A')], loveList: [], userList: [list('u1', 'U', [])] }
  const { next, summary } = mergeImport(current, { defaultList: [], loveList: [], userList: [] })
  assert.equal(next.userList.length, 1)
  assert.equal(summary.newLists + summary.mergedLists + summary.newSongs, 0)
})
