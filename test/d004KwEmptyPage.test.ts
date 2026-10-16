/**
 * d004KwEmptyPage.test.ts — D-004：kw 越界页不应让搜索接口 500。
 *
 * 【缺陷】kw SDK 把「有总数但本页 0 条」当成需要重试的失败，重试 3 次后
 * `throw new Error('try max num')`，服务端 catch 直接 500。
 * 用户翻到最后一页之后再翻（或前端预取越界页）就看到「搜索坏了」。
 *
 * 【修法】越界页不是错误，是「没有更多了」—— 返回空列表让翻页自然结束。
 *
 * 这里直接打桩 `musicSearch`（真实 SDK 的网络调用），验证 search() 的返回语义。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import kwSearchModule from '../src/modules/utils/musicSdk/kw/musicSearch.js'

// 该模块是 ESM default 导出（`export default { …, search() {} }`），
// 服务端经 musicSdk[source].musicSearch 拿到它。
const kwSearch: any = kwSearchModule

/** 用桩替换底层网络调用，模拟平台返回 */
function stub(body: any) {
  const original = kwSearch.musicSearch
  kwSearch.musicSearch = () => Promise.resolve({ body })
  return () => { kwSearch.musicSearch = original }
}

test('D-004：越界页（有总数但本页 0 条）返回空列表而不是抛错', async () => {
  // 这是缺陷的核心场景：TOTAL 非 0（说明有歌）但 SHOW === '0'（本页为空）
  const restore = stub({ TOTAL: '45', SHOW: '0', abslist: [] })
  try {
    const r = await kwSearch.search('周杰伦', 4, 20)
    assert.ok(Array.isArray(r.list), '应返回结果对象而不是抛错')
    assert.equal(r.list.length, 0, '越界页应返回空列表')
    assert.equal(r.total, 45, '总数应保留（前端可据此判断到底了）')
  } finally {
    restore()
  }
})

test('D-004：TOTAL=0（本来就搜不到）同样返回空列表', async () => {
  const restore = stub({ TOTAL: '0', SHOW: '0', abslist: [] })
  try {
    const r = await kwSearch.search('不存在的歌xyz', 1, 20)
    assert.equal(r.list.length, 0)
    assert.equal(r.total, 0)
  } finally {
    restore()
  }
})

test('D-004：响应体为空时也不抛错', async () => {
  const restore = stub(null)
  try {
    const r = await kwSearch.search('任意', 1, 20)
    assert.equal(r.list.length, 0, '空响应应返回空列表')
  } finally {
    restore()
  }
})

test('D-004：正常页仍要正常返回（别把功能一起改坏）', async () => {
  // handleResult 需要 N_MINFO（音质信息串），缺了会返回 null —— 那是另一条路径。
  // 这里给真实形态的数据，确认正常页没被改坏。
  const restore = stub({
    TOTAL: '45',
    SHOW: '2',
    abslist: [
      {
        MUSICRID: 'MUSIC_1', NAME: '歌一', ARTIST: '歌手', ALBUM: '专辑', ALBUMID: '1', DURATION: '200',
        N_MINFO: 'level:320,bitrate:320,format:mp3,size:8.5M;level:128,bitrate:128,format:mp3,size:3.2M',
      },
      {
        MUSICRID: 'MUSIC_2', NAME: '歌二', ARTIST: '歌手', ALBUM: '专辑', ALBUMID: '1', DURATION: '210',
        N_MINFO: 'level:320,bitrate:320,format:mp3,size:9.1M',
      },
    ],
  })
  try {
    const r = await kwSearch.search('周杰伦', 1, 20)
    assert.equal(r.list.length, 2, '正常页应返回 2 条')
    assert.equal(r.total, 45)
    assert.equal(r.allPage, 3, '45/20 → 3 页')
  } finally {
    restore()
  }
})

test('D-004：解析不出结果时重试有限次后返回空列表（不抛错）', async () => {
  // handleResult 拿不到 abslist → list 为 null → 旧逻辑重试 3 次后抛 try max num
  let calls = 0
  const original = kwSearch.musicSearch
  kwSearch.musicSearch = () => { calls++; return Promise.resolve({ body: { TOTAL: '10', SHOW: '1' } }) }
  try {
    const r = await kwSearch.search('周杰伦', 1, 20)
    assert.equal(r.list.length, 0, '不应抛错，应返回空列表')
    assert.ok(calls <= 4, `重试次数应有上限，实际 ${calls} 次`)
  } finally {
    kwSearch.musicSearch = original
  }
})
