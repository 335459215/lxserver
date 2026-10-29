/** 搜索分页控制器（纯逻辑，**零依赖**，便于单测直接 import）。
 *
 *  【为什么要把分页逻辑从 SearchPage 里抽出来】
 *  这段逻辑有三个互相纠缠的约束（代次隔离、上游分页状态、失败重试），
 *  埋在 React 组件的 useCallback 里既难测也容易在改动时破掉。
 *  抽成纯函数后可以脱离浏览器直接跑回归测试。
 *
 *  【三条硬约束】
 *  1. **代次隔离**：旧查询的翻页结果绝不能覆盖新查询。
 *     每次 loadFirst 递增 epoch；所有异步回写前先核对 epoch。
 *  2. **用上游状态判断到底**：聚合去重后条数必然缩水（5 源各 20 条、
 *     10 对重复 → 只剩 10 条），拿展示条数判断会让第一页就误判到底。
 *     整页恰好全是重复也不代表后面没有新歌，页码照常推进。
 *  3. **失败不等于到底**：网络抖动一次就永久停止翻页是错的，
 *     必须保持 hasMore 让用户滚动时重试。
 */

/** 一页的取数结果：items 是已去重的展示条目，其余是**上游原始**分页状态 */
export interface PageResult<T> {
  items: T[]
  /** 各平台原始返回条数（未去重） */
  rawCounts: number[]
  /** 上游是否可能还有下一页（依据原始满页判断，不是去重后条数） */
  rawHasMore: boolean
  /** 至少一个平台成功返回（区分「真没数据」与「全部失败」） */
  anyFulfilled: boolean
}

export interface PagerState {
  page: number
  hasMore: boolean
  loadingMore: boolean
  /** 当前代次，仅供诊断 */
  epoch: number
}

export function createSearchPager<T>(options: {
  pageSize?: number
  /** 合并去重函数。默认按引用去重（不关心跨平台重复的调用方用）。
   *  显式传入而不是模块级可变状态 —— 后者会让并发测试互相污染。 */
  dedupe?: (list: T[]) => T[]
} = {}) {
  const pageSize = options.pageSize ?? 20
  const merge = options.dedupe ?? ((list: T[]) => list)
  let epoch = 0
  let page = 1
  let hasMore = false
  let loadingMore = false
  let items: T[] = []
  /** 本次代次内已成功加载过的最大页码，防止重复拉同一页 */
  let loadedPage = 0
  let inflight: Promise<void> | null = null

  const state = (): PagerState => ({ page, hasMore, loadingMore, epoch })

  const reset = () => {
    epoch++
    page = 1
    hasMore = false
    loadingMore = false
    loadedPage = 0
    items = []
  }

  /** 首次搜索：重置代次并加载第 1 页 */
  const loadFirst = async (fetchPage: (page: number, epoch: number) => Promise<PageResult<T>>): Promise<void> => {
    reset()
    const mine = epoch
    const r = await fetchPage(1, mine)
    if (mine !== epoch) return           // 期间又发起了新搜索，丢弃
    items = r.items
    page = 1
    loadedPage = 1
    hasMore = r.rawHasMore
  }

  /** 用一份**已有结果**接管控制器（返回搜索页时恢复上次会话）。
   *
   *  【为什么要走到 loadedPage 而不只是 items】搜索页返回后用户往往继续
   *  往下翻页。若只塞 items、loadedPage 仍是 0，`loadMore` 会被
   *  `if (!loadedPage) return` 直接挡掉 —— 表现为「恢复结果后翻页按钮没反应」。
   *  这里把页码一并接上，恢复后的「加载更多」从下一页继续。
   *
   *  代次照常 +1：任何恢复前还在飞的旧请求都必须作废。 */
  const hydrate = (nextItems: T[], nextHasMore: boolean, loadedPageNo = 1) => {
    reset()
    items = nextItems
    page = loadedPageNo
    loadedPage = loadedPageNo
    hasMore = nextHasMore
  }

  /** 追加下一页。并发调用只发一次请求；失败保持可重试。 */
  const loadMore = async (fetchPage: (page: number, epoch: number) => Promise<PageResult<T>>): Promise<void> => {
    if (loadingMore || !hasMore || !loadedPage) return
    if (inflight) return inflight

    const mine = epoch
    const next = loadedPage + 1
    loadingMore = true

    inflight = (async () => {
      try {
        const r = await fetchPage(next, mine)
        // 代次已变（用户改了关键词）→ 结果整体丢弃，绝不回写
        if (mine !== epoch) return
        // 合并策略：整体重跑去重，而不是按旧长度切「新增部分」。
        // 去重是非传递的，重跑可能让前缀条目数变少，slice 会把新歌切掉。
        items = merge([...items, ...r.items])
        loadedPage = next
        page = next
        hasMore = r.rawHasMore
      } catch (e) {
        // 失败：不推进页码、不关掉 hasMore（否则一次抖动就永久停止翻页）
        if (mine !== epoch) return
        void e
      } finally {
        // 只有仍属于当前代次才解锁，否则会解掉新查询的锁
        if (mine === epoch) loadingMore = false
        inflight = null
      }
    })()

    return inflight
  }

  return {
    state,
    items: () => items,
    loadFirst,
    loadMore,
    hydrate,
    reset,
    get pageSize() { return pageSize },
  }
}
