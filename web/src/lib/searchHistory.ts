/** 最近搜索（v2.34.0）：localStorage 持久化的搜索关键词历史。
 *
 *  【为什么放 localStorage 而不是服务端】搜索历史是「这台设备上你想再搜什么」，
 *  与账号无强绑定（手机上搜过的词在电脑上未必想看到）；且搜索行为本身不鉴权，
 *  为它开服务端接口会把写入口扩大到未登录会话。各家主流客户端
 *  （网易云 / QQ 音乐）也均为本地存储。
 *
 *  语义（与网易云一致）：
 *  - 新词 unshift 到最前；**重复搜索把旧条目挪到最前**（不是删掉再不加，
 *    也不是保留原位置 —— 用户刚搜过的词就该最先被再点到）
 *  - 上限 10 条，超出丢弃最旧的
 *  - 空白词不记录（runSearch 里也有 trim，这里再兜一层 —— 这个模块被
 *    多处调用，不能假设调用方都 trim 过）
 */

const KEY = 'lx.search.history'
const LIMIT = 10

/** 纯函数核心：把 q 并入历史列表（不碰存储）。
 *  拆出来是为了让单测能直接测边界，不依赖 localStorage 桩。 */
export function mergeSearchHistory(list: readonly string[], q: string): string[] {
  const word = q.trim()
  if (!word) return [...list]
  const rest = list.filter((x) => x !== word)
  return [word, ...rest].slice(0, LIMIT)
}

export function loadSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const data: unknown = JSON.parse(raw)
    if (!Array.isArray(data)) return []
    return data.filter((x): x is string => typeof x === 'string').slice(0, LIMIT)
  } catch {
    // 损坏的历史不值得报错 —— 清掉重来即可
    return []
  }
}

function save(list: readonly string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // 隐私模式 / 存储被禁：历史是锦上添花，不因它炸主流程
  }
}

/** 记录一次搜索，返回记录后的列表（供调用方直接 setState） */
export function pushSearchHistory(q: string): string[] {
  const next = mergeSearchHistory(loadSearchHistory(), q)
  save(next)
  return next
}

/** 删除单条，返回删除后的列表 */
export function removeSearchHistory(q: string): string[] {
  const next = loadSearchHistory().filter((x) => x !== q)
  save(next)
  return next
}

/** 清空 */
export function clearSearchHistory(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* 同 save：存储异常不炸主流程 */
  }
}
