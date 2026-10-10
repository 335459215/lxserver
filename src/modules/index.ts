import { sync as listSync } from './list'
import { sync as dislikeSync } from './dislike'

export const callObj = Object.assign({},
  listSync.handler,
  dislikeSync.handler,
)

export const modules = {
  list: listSync,
  dislike: dislikeSync,
}


export { ListManage, ListEvent, type ListEventType } from './list'

export { DislikeManage, DislikeEvent, type DislikeEventType } from './dislike'

// 播放历史：只读/写用户数据，不参与客户端同步协议（故不进 callObj / modules / featureVersion）
export { HistoryManage, type HistoryDataManage } from './history'

export const featureVersion = {
  list: 1,
  dislike: 1,
} as const
