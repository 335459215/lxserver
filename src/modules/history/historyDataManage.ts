import fs from 'node:fs'
import path from 'node:path'
import { File } from '@/constants'
import { checkAndCreateDirSync } from '@/utils'
import { throttle } from '@/utils/common'

/** 每用户历史条数上限。
 *
 *  为什么要上限：历史是无限增长的（听歌是最频繁的操作），没有上限的话
 *  文件会一直变大，且「拉取历史」会越来越慢。500 条对个人使用足够——
 *  按每天听 30 首算能覆盖半个月，而超过这个跨度的"历史"其实已经没人翻了。
 *  淘汰策略是**淘汰最旧的**（list 尾部），因为列表是倒序的（最近在前）。 */
export const HISTORY_MAX_ITEMS = 500

/** 写盘防抖窗口。听歌时切歌/重播都可能触发上报，
 *  每次都同步写盘会在连续切歌时产生大量无谓 IO。
 *  参考 `src/server/sessionStore.ts` 的做法（它用 3s），这里取 1s：
 *  历史数据本身不重要到必须立即落盘，但也不该丢太多。
 *
 *  **已知取舍**：`throttle` 是「首次调用后等 delay 才执行」的语义，
 *  所以进程在最后 1 秒内被强杀（容器重建走 SIGKILL 收尾）时，
 *  这条上报会丢。因为丢失面只有「正在播的那一首」且下次播同曲会重记，
 *  不值得为此挂全局退出钩子（SIGKILL 下也无能为力）。 */
const SAVE_THROTTLE_MS = 1000

/** 单个文本字段的长度上限。
 *
 *  为什么需要：`readBody`（server.ts）**没有请求体体积上限**，而这里要落盘并长期保存。
 *  不设限的话，一次上报塞一个几 MB 的 name 就能让 history.json 膨胀到内存/磁盘吃不消
 *  （500 条 × 几 MB）。各平台正常歌名/歌手名都远低于此，超长一律**截断**而不是拒绝——
 *  截断仍保留了「听过这首歌」的事实，比整条丢弃更有用。 */
const MAX_TEXT = 200

const clip = (s: string, max = MAX_TEXT) => (s.length > max ? s.slice(0, max) : s)

/** 只依赖 userDir 的最小接口。
 *
 *  刻意**不 import `UserDataManage` 类型**（来自 `@/user/data`）：
 *  那个模块在**加载时**就会读 `global.lx.dataPath`，任何 import 它的测试
 *  都必须先构造好 global.lx，非常难测。这里改用结构化的最小依赖。 */
export interface HistoryOwner {
  userName: string
  userDir: string
}

export class HistoryDataManage {
  userDataManage: HistoryOwner
  historyDir: string
  historyFilePath: string
  data: LX.History.HistoryListData
  private readonly saveThrottle: () => void

  constructor(userDataManage: HistoryOwner) {
    this.userDataManage = userDataManage
    this.historyDir = path.join(userDataManage.userDir, File.historyDir)
    this.historyFilePath = path.join(this.historyDir, File.historyDataJSON)
    this.data = this.load()

    this.saveThrottle = throttle(() => {
      this.saveNow()
    }, SAVE_THROTTLE_MS)
  }

  /** 读盘。任何异常都回落空列表 —— 历史损坏不该让用户空间初始化失败
   *  （那会连带歌单/不喜欢一起不可用，代价太大）。 */
  private load(): LX.History.HistoryListData {
    try {
      if (!fs.existsSync(this.historyFilePath)) return { list: [] }
      const raw = fs.readFileSync(this.historyFilePath, 'utf-8').trim()
      if (!raw) return { list: [] }
      const parsed = JSON.parse(raw)
      if (!parsed || !Array.isArray(parsed.list)) return { list: [] }
      // 过滤掉结构不完整的条目（手改文件/旧版本残留）
      const list = parsed.list.filter(
        (x: unknown): x is LX.History.HistoryItem =>
          !!x && typeof x === 'object' &&
          typeof (x as LX.History.HistoryItem).key === 'string' &&
          typeof (x as LX.History.HistoryItem).playedAt === 'number',
      )
      return { list: list.slice(0, HISTORY_MAX_ITEMS) }
    } catch (e) {
      console.error('[播放历史] 读取失败，按空处理:', e)
      return { list: [] }
    }
  }

  /** 立即落盘（内部用；外部走 saveThrottle）。
   *
   *  用 **writeFileSync**：这里的语义是「现在就该写完了」。
   *  原先用异步 writeFile，调用方（尤其是 `flush()` 与进程退出）会在写完成前继续，
   *  表现为「刚 flush 完读回来还是旧的」——测试里踩到的就是这个。 */
  private saveNow() {
    try {
      checkAndCreateDirSync(this.historyDir)
      fs.writeFileSync(this.historyFilePath, JSON.stringify(this.data), 'utf8')
    } catch (e) {
      console.error('[播放历史] 写入异常:', e)
    }
  }

  /** 强制立即落盘（测试与优雅退出用，避免等防抖窗口） */
  flush = () => {
    this.saveNow()
  }

  /** 归一化上报入参 → HistoryItem；字段不完整时返回 null（不该把脏数据写进历史）。 */
  private normalize(payload: LX.History.ReportPayload): LX.History.HistoryItem | null {
    const source = clip(String(payload.source ?? '').trim(), 32)
    const songmid = clip(String(payload.songmid ?? payload.id ?? '').trim(), 128)
    const name = clip(String(payload.name ?? '').trim())
    if (!source || !songmid || !name) return null
    return {
      key: `${source}|${songmid}`,
      source,
      songmid,
      name,
      singer: clip(String(payload.singer ?? '').trim()),
      interval: payload.interval ? clip(String(payload.interval), 32) : null,
      albumName: payload.albumName ? clip(String(payload.albumName)) : undefined,
      // 封面是 CDN 直链，正常几百字符；限 2KB 足够，也能挡住「塞 base64 进 img」的滥用
      img: payload.img ? clip(String(payload.img), 2048) : null,
      playedAt: Date.now(),
      playCount: 1,
    }
  }

  /** 上报一次播放。
   *
   *  **去重规则（这是本模块最重要的语义）**：按 `source|songmid` 归并 ——
   *  同一首歌重复播放**不新增条目**，只更新 playedAt、递增 playCount，
   *  并把它移到列表最前。
   *  理由：历史回答的是「我最近听过什么」，不是「我按了几次播放键」。
   *  Spotify / Apple Music / YouTube Music 都是这个语义；做成流水会让列表
   *  被同一首歌刷屏（单曲循环一晚上就是几百条），完全不可用。
   *  真正的「播放流水」如果需要，应该是另一个功能（且要按时间分桶）。
   *
   *  **playCount 的精确语义**：它统计的是「通过换曲 / 点播重新开始的次数」，
   *  **不含单曲循环的自动重播**（前端 reportedRef 会在同一首上拦住重复上报）。
   *  这是刻意的：单曲循环一晚不应把 playCount 刷成几百。 */
  report = (payload: LX.History.ReportPayload): LX.History.HistoryItem | null => {
    const item = this.normalize(payload)
    if (!item) return null

    const idx = this.data.list.findIndex((x) => x.key === item.key)
    if (idx >= 0) {
      const prev = this.data.list[idx]
      // 保留首次的封面/专辑等元信息兜底：新上报可能缺字段
      item.playCount = (prev.playCount ?? 1) + 1
      item.img = item.img ?? prev.img ?? null
      item.albumName = item.albumName ?? prev.albumName
      item.interval = item.interval ?? prev.interval
      this.data.list.splice(idx, 1)
    }
    this.data.list.unshift(item)

    // 超限淘汰最旧的（列表尾部）
    if (this.data.list.length > HISTORY_MAX_ITEMS) {
      this.data.list.length = HISTORY_MAX_ITEMS
    }

    this.saveThrottle()
    return item
  }

  /** 分页拉取（倒序：最近在前）。page 从 1 开始。 */
  list = (page = 1, pageSize = 50): { list: LX.History.HistoryItem[], total: number, page: number, pageSize: number, hasMore: boolean } => {
    const p = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1
    const size = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(Math.floor(pageSize), 200) : 50
    const start = (p - 1) * size
    return {
      list: this.data.list.slice(start, start + size),
      total: this.data.list.length,
      page: p,
      pageSize: size,
      hasMore: start + size < this.data.list.length,
    }
  }

  /** 清空当前用户的历史 */
  clear = () => {
    this.data.list = []
    this.saveNow()
  }

  /** 删除单条（按 key） */
  remove = (key: string) => {
    const idx = this.data.list.findIndex((x) => x.key === key)
    if (idx < 0) return false
    this.data.list.splice(idx, 1)
    this.saveThrottle()
    return true
  }
}
