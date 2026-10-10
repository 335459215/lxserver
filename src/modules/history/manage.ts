import { type UserDataManage } from '@/user'
import { HistoryDataManage } from './historyDataManage'

/** 播放历史的用户空间入口。
 *
 *  与 list / dislike 不同，这里**不做快照、不接客户端同步**（见 historyDataManage.ts
 *  顶部注释：历史是"最近听过什么"的投影，不需要多设备回滚语义，
 *  冲突时后写覆盖即可）。所以没有 snapshotDataManage，也没有 sync/ 目录。 */
export class HistoryManage {
  historyDataManage: HistoryDataManage

  constructor(userDataManage: UserDataManage) {
    // UserDataManage 结构上满足 HistoryOwner（有 userName + userDir）
    this.historyDataManage = new HistoryDataManage(userDataManage)
  }

  report = (payload: LX.History.ReportPayload) => this.historyDataManage.report(payload)
  list = (page?: number, pageSize?: number) => this.historyDataManage.list(page, pageSize)
  clear = () => this.historyDataManage.clear()
  remove = (key: string) => this.historyDataManage.remove(key)

  /** 测试与优雅退出时强制落盘 */
  flush = () => this.historyDataManage.flush()
}
