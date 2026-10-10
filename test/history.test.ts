import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { HistoryDataManage, HISTORY_MAX_ITEMS } from '@/modules/history'
import { filterFileName, toMD5 } from '@/utils'

// 播放历史的数据层约定：
// - 去重：同一 source|songmid 重复上报**不新增条目**，只更新 playedAt/playCount 并置顶
// - 容量：超过 HISTORY_MAX_ITEMS 淘汰最旧的（列表尾部）
// - 分页：倒序，page 从 1 开始，pageSize 有上限
// - 隔离：不同用户空间互不可见
// - 守卫：字段不完整的上报被丢弃，不写脏数据
// - 容错：文件损坏/缺失时回落空列表，不抛

let root = ''

/** 复刻 `src/user/data.ts` 的 getUserDirname。
 *  刻意不 import 那个模块 —— 它在加载时会读 `global.lx.dataPath`，
 *  会让本测试在 import 阶段就炸。HistoryDataManage 也因此只依赖
 *  结构化的 { userName, userDir }，不依赖 UserDataManage 类型。 */
const userDirname = (userName: string) =>
  userName === '_open' ? '_open' : `${filterFileName(userName)}_${toMD5(userName).substring(0, 6)}`

const makeManage = (userName = 'yueyue') => {
  const dir = path.join(root, userDirname(userName))
  fs.mkdirSync(dir, { recursive: true })
  return new HistoryDataManage({ userName, userDir: dir })
}

const song = (over: Partial<LX.History.ReportPayload> = {}): LX.History.ReportPayload => ({
  source: 'tx',
  songmid: '12345',
  name: '测试歌曲',
  singer: '测试歌手',
  interval: '03:20',
  ...over,
})

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-hist-'))
  ;(global as any).lx = { userPath: root }

})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

test('上报一条后能查到；字段完整保留', () => {
  const m = makeManage()
  const item = m.report(song())
  assert.ok(item, 'report 应返回写入的条目')
  assert.equal(item!.key, 'tx|12345')
  assert.equal(item!.name, '测试歌曲')
  assert.equal(item!.singer, '测试歌手')
  assert.equal(item!.interval, '03:20')
  assert.equal(item!.playCount, 1)
  assert.ok(item!.playedAt > 0)

  const { list, total } = m.list(1, 50)
  assert.equal(total, 1)
  assert.equal(list.length, 1)
  assert.equal(list[0].key, 'tx|12345')
})

test('去重：同一首歌重复上报不新增条目，只更新 playedAt 与 playCount', async () => {
  const m = makeManage()
  const first = m.report(song())!
  await new Promise((r) => setTimeout(r, 5))
  const again = m.report(song())!

  const { list, total } = m.list()
  assert.equal(total, 1, '重复上报不应产生第二条')
  assert.equal(list.length, 1)
  assert.equal(again.playCount, 2, 'playCount 应累加')
  assert.ok(again.playedAt >= first.playedAt, 'playedAt 应更新')
})

test('去重后置顶：重新播放旧歌会把它移到列表最前', () => {
  const m = makeManage()
  m.report(song({ songmid: 'A', name: 'A' }))
  m.report(song({ songmid: 'B', name: 'B' }))
  m.report(song({ songmid: 'C', name: 'C' }))
  assert.deepEqual(m.list().list.map((x) => x.name), ['C', 'B', 'A'], '倒序：最近在前')

  m.report(song({ songmid: 'A', name: 'A' }))
  assert.deepEqual(m.list().list.map((x) => x.name), ['A', 'C', 'B'], 'A 应被置顶')
})

test('不同平台同一 songmid 视为不同条目（key 含 source）', () => {
  const m = makeManage()
  m.report(song({ source: 'tx', songmid: '999' }))
  m.report(song({ source: 'wy', songmid: '999' }))
  const { total } = m.list()
  assert.equal(total, 2, 'source 不同 → 不应被归并')
})

test('容量上限：超过上限淘汰最旧的', () => {
  const m = makeManage()
  for (let i = 0; i < HISTORY_MAX_ITEMS + 20; i++) {
    m.report(song({ songmid: `s${i}`, name: `n${i}` }))
  }
  const { total, list } = m.list(1, 10)
  assert.equal(total, HISTORY_MAX_ITEMS, `条目数应被裁剪到 ${HISTORY_MAX_ITEMS}`)
  // 最新的一定在
  assert.equal(list[0].name, `n${HISTORY_MAX_ITEMS + 19}`)
  // 最旧的已被淘汰
  const all = m.list(1, 200).list.map((x) => x.name)
  assert.ok(!all.includes('n0'), '最早的 n0 应已被淘汰')
})

test('分页：倒序、页码从 1 起、越界返回空、pageSize 有上限', () => {
  const m = makeManage()
  for (let i = 1; i <= 25; i++) m.report(song({ songmid: `p${i}`, name: `p${i}` }))

  const p1 = m.list(1, 10)
  assert.equal(p1.list.length, 10)
  assert.equal(p1.total, 25)
  assert.equal(p1.page, 1)
  assert.equal(p1.hasMore, true)
  assert.equal(p1.list[0].name, 'p25', '第一页第一条应是最新的')

  const p3 = m.list(3, 10)
  assert.equal(p3.list.length, 5)
  assert.equal(p3.hasMore, false)

  const p9 = m.list(9, 10)
  assert.deepEqual(p9.list, [], '越界页返回空数组而不是报错')

  // 非法入参回落默认
  assert.equal(m.list(0, 10).page, 1, 'page<1 应回落 1')
  assert.equal(m.list(-5, 10).page, 1)
  assert.ok(m.list(1, 99999).pageSize <= 200, 'pageSize 应被限制在 200 以内')
})

test('守卫：字段不完整的上报被丢弃（不写脏数据）', () => {
  const m = makeManage()
  assert.equal(m.report({ songmid: 'x', name: '有ID无平台' }), null, '缺 source 应拒绝')
  assert.equal(m.report({ source: 'tx', name: '有平台无ID' }), null, '缺 songmid 应拒绝')
  assert.equal(m.report({ source: 'tx', songmid: 'y' }), null, '缺 name 应拒绝')
  assert.equal(m.report({ source: '  ', songmid: 'y', name: 'z' }), null, '空白 source 应拒绝')
  assert.equal(m.list().total, 0, '不应写入任何脏数据')
})

test('守卫：songmid 缺失时回落 id 字段', () => {
  const m = makeManage()
  const item = m.report({ source: 'kw', id: 777, name: '用 id 兜底', singer: 's' })
  assert.ok(item)
  assert.equal(item!.key, 'kw|777')
})

test('多用户隔离：A 的历史不会被 B 看到', () => {
  const a = makeManage('alice')
  const b = makeManage('bob')
  a.report(song({ songmid: 'only-a', name: 'A 的歌' }))
  assert.equal(a.list().total, 1)
  assert.equal(b.list().total, 0, 'bob 不应看到 alice 的历史')

  b.report(song({ songmid: 'only-b', name: 'B 的歌' }))
  assert.equal(a.list().total, 1)
  assert.equal(b.list().total, 1)
  assert.equal(a.list().list[0].name, 'A 的歌')
})

test('清空：clear 后列表为空且立即落盘', () => {
  const m = makeManage()
  m.report(song({ songmid: '1' }))
  m.report(song({ songmid: '2' }))
  assert.equal(m.list().total, 2)

  m.clear()
  assert.equal(m.list().total, 0)
  // 立即落盘：新实例读到的也应是空
  const again = makeManage()
  assert.equal(again.list().total, 0, 'clear 必须立即写盘')
})

test('删除单条：按 key 移除，不存在时返回 false', () => {
  const m = makeManage()
  m.report(song({ songmid: 'keep' }))
  m.report(song({ songmid: 'drop' }))
  assert.equal(m.remove('tx|drop'), true)
  assert.deepEqual(m.list().list.map((x) => x.songmid), ['keep'])
  assert.equal(m.remove('tx|不存在'), false)
})

test('持久化：flush 后新实例能读回（跨重启不丢）', () => {
  const m = makeManage()
  m.report(song({ songmid: 'persist-1', name: '持久化测试' }))
  m.flush()

  const again = makeManage()
  const { list, total } = again.list()
  assert.equal(total, 1)
  assert.equal(list[0].name, '持久化测试')
  assert.equal(list[0].playCount, 1)
})

test('容错：文件损坏时回落空列表而不是抛异常', () => {
  const m = makeManage()
  const file = path.join(root, userDirname('yueyue'), 'history', 'history.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, '{ 这不是合法 JSON', 'utf8')

  const broken = makeManage()
  assert.equal(broken.list().total, 0, '损坏文件应被当作空历史')
  // 且仍能正常写入
  broken.report(song({ songmid: 'after-corrupt' }))
  assert.equal(broken.list().total, 1)
})

test('容错：list 里混入结构不完整的条目时被过滤', () => {
  const dir = path.join(root, userDirname('yueyue'), 'history')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'history.json'),
    JSON.stringify({
      list: [
        { key: 'tx|good', source: 'tx', songmid: 'good', name: 'ok', singer: '', playedAt: Date.now(), playCount: 1 },
        { name: '没有 key 和 playedAt 的脏数据' },
        null,
      ],
    }),
    'utf8',
  )
  const m = makeManage()
  const { list, total } = m.list()
  assert.equal(total, 1, '只应保留结构完整的条目')
  assert.equal(list[0].key, 'tx|good')
})

test('重复上报时保留首次的封面/专辑（新上报缺字段不覆盖成空）', () => {
  const m = makeManage()
  m.report(song({ songmid: 'meta', img: 'http://cover/1.jpg', albumName: '专辑A' }))
  // 第二次上报不带封面/专辑（某些平台搜索结果的字段缺失）
  m.report({ source: 'tx', songmid: 'meta', name: '测试歌曲', singer: '测试歌手' })
  const item = m.list().list[0]
  assert.equal(item.img, 'http://cover/1.jpg', '旧封面应被保留')
  assert.equal(item.albumName, '专辑A', '旧专辑名应被保留')
})
