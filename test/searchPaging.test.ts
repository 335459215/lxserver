/**
 * searchPaging.test.ts — 搜索分页的回归测试。
 *
 * 这里验证的是**分页控制器**（纯逻辑，不依赖 React），
 * 对应三个已实测复现的缺陷：
 *   1. 旧查询的翻页结果覆盖新查询
 *   2. 用去重后条数判断到底 → 第一页就误判 / 整页重复后永久停止
 *   3. 网络错误被当成「到底了」
 *
 * 运行：npx tsx --test test/searchPaging.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSearchPager } from '../web/src/lib/searchPaging'
import { dedupeSongs } from '../web/src/lib/songIdentity'

const PAGE = 20

const mk = (prefix: string, n: number, singer = 'A') =>
  Array.from({ length: n }, (_, i) => ({
    source: 'wy', songmid: `${prefix}-${i}`, name: `${prefix}${i}`, singer,
  })) as any[]

/** 构造一个可控的聚合分页数据源：每页返回给定的原始条目。
 *  failOnceOn 模拟**一次性**网络抖动（第一次请求该页失败、重试成功）——
 *  用 failOn 会让重试也失败，测不出「重试能恢复」。 */
function sourceOf(pages: any[][], opts: { pageSize?: number, failOnceOn?: number[] } = {}) {
  const pageSize = opts.pageSize ?? PAGE
  const calls: number[] = []
  const failed = new Set<number>()
  return {
    calls,
    fetchPage: async (page: number) => {
      calls.push(page)
      if (opts.failOnceOn?.includes(page) && !failed.has(page)) {
        failed.add(page)
        throw new Error('network down')
      }
      const items = pages[page - 1] ?? []
      return {
        items: dedupeSongs(items),
        rawCounts: [items.length],
        rawHasMore: items.length >= pageSize,
        anyFulfilled: true,
      }
    },
  }
}

test('整页都是重复时仍然继续翻页，不永久停止', async () => {
  // 第 2 页整页与第 1 页重复，第 3 页才有新歌。
  // 旧实现：fresh.length === 0 → hasMore=false 且不推进 page，第 3 页永远拉不到。
  const p1 = mk('dup', PAGE)
  const src = sourceOf([p1, p1, mk('new', PAGE)])
  const pager = createSearchPager({ pageSize: PAGE })

  await pager.loadFirst(src.fetchPage)
  assert.equal(pager.state().page, 1)
  assert.equal(pager.state().hasMore, true, '第一页满页，应还有下一页')

  await pager.loadMore(src.fetchPage)
  assert.equal(pager.state().page, 2, '整页重复也要推进页码')
  assert.equal(pager.state().hasMore, true, '整页重复不代表到底')

  await pager.loadMore(src.fetchPage)
  assert.ok(pager.items().some((s: any) => s.name.startsWith('new')),
    `第 3 页的新歌必须出现，实际 ${pager.items().length} 条`)
})

test('去重缩页不影响「还有下一页」的判断', async () => {
  // 5 源各回 20 条、其中大量重复 → 原始 100 条、去重后只剩 10 条。
  // 旧实现用展示条数判断，第一页就误判到底。
  //
  // 【测试数据必须真的会缩水】用 20 条互不重复的数据是测不出问题的：
  // 单页去重后仍是 20 条，与 pageSize 相等，两种判断恰好同结果。
  const raw = Array.from({ length: PAGE }, (_, i) => ({
    source: 'wy', songmid: `x-${i}`, name: `同名单曲`, singer: 'A',
  })) as any[]                       // 20 条同名同歌手 → 去重后只剩 1 条
  const fetchPage = async () => {
    const items = dedupeSongs(raw)
    return {
      items,
      rawCounts: [PAGE, PAGE, PAGE, PAGE, PAGE],
      rawHasMore: true,               // 上游明确说还有
      anyFulfilled: true,
    }
  }
  const pager = createSearchPager({ pageSize: PAGE })
  await pager.loadFirst(fetchPage)
  assert.ok(pager.items().length < PAGE,
    `去重后应少于 ${PAGE} 条，实际 ${pager.items().length}`)
  assert.equal(pager.state().hasMore, true,
    '必须依据上游原始状态，而不是去重后的展示条数')
})

test('旧查询的翻页结果不能覆盖新查询', async () => {
  const pager = createSearchPager({ pageSize: PAGE })

  // 旧查询第一页
  await pager.loadFirst(async () => ({
    items: mk('old', PAGE), rawCounts: [PAGE], rawHasMore: true, anyFulfilled: true,
  }))
  assert.ok(pager.items().every((s: any) => s.name.startsWith('old')))

  // 在途的旧翻页（延迟释放）
  let releaseOld: (() => void) | null = null
  const oldMore = pager.loadMore(() => new Promise((resolve) => {
    releaseOld = () => resolve({
      items: mk('old-p2', PAGE), rawCounts: [PAGE], rawHasMore: true, anyFulfilled: true,
    })
  }))

  // 用户改了关键词 → 新查询
  await pager.loadFirst(async () => ({
    items: mk('new', PAGE), rawCounts: [PAGE], rawHasMore: true, anyFulfilled: true,
  }))
  assert.ok(pager.items().every((s: any) => s.name.startsWith('new')), '新查询结果已生效')

  // 现在才放行旧翻页
  releaseOld!()
  await oldMore

  assert.ok(pager.items().every((s: any) => s.name.startsWith('new')),
    `旧翻页结果不得污染新查询，实际 ${JSON.stringify(pager.items().slice(0, 3).map((s: any) => s.name))}`)
  assert.equal(pager.state().page, 1, '旧翻页不得推进新查询的页码')
})

test('网络错误不当作到底，保持可重试', async () => {
  const src = sourceOf([mk('a', PAGE), mk('b', PAGE), mk('c', PAGE)], { failOnceOn: [2] })
  const pager = createSearchPager({ pageSize: PAGE })
  await pager.loadFirst(src.fetchPage)

  await pager.loadMore(src.fetchPage)   // 第 2 页首次失败
  assert.equal(pager.state().hasMore, true, '失败不应终止翻页')
  assert.equal(pager.state().page, 1, '失败不应推进页码')
  assert.equal(pager.state().loadingMore, false, '失败后必须解锁，否则永远卡住')

  await pager.loadMore(src.fetchPage)   // 重试成功
  assert.equal(pager.state().page, 2, '重试应能成功推进')
  assert.ok(pager.items().some((s: any) => s.name.startsWith('b')), '重试后应拿到第 2 页数据')
})

test('并发触发 loadMore 只发一次请求（single flight）', async () => {
  let calls = 0
  const fetchPage = async () => {
    calls++
    await new Promise((r) => setTimeout(r, 10))
    return { items: mk('a', PAGE), rawCounts: [PAGE], rawHasMore: true, anyFulfilled: true }
  }
  const pager = createSearchPager({ pageSize: PAGE })
  await pager.loadFirst(fetchPage)
  calls = 0

  await Promise.all([pager.loadMore(fetchPage), pager.loadMore(fetchPage), pager.loadMore(fetchPage)])
  assert.equal(calls, 1, `并发滚动只应请求一次，实际 ${calls} 次`)
})

test('真正没有更多数据时正常停止', async () => {
  const src = sourceOf([mk('a', PAGE), mk('b', 5)])
  const pager = createSearchPager({ pageSize: PAGE })
  await pager.loadFirst(src.fetchPage)
  assert.equal(pager.state().hasMore, true)
  await pager.loadMore(src.fetchPage)
  assert.equal(pager.state().hasMore, false, '不足一页即到底')
})
