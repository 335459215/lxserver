
declare namespace LX {
  namespace History {
    /** 一条播放记录。
     *
     *  只存**播放所必需的字段**（平台 + songmid + 歌名/歌手/时长/封面），
     *  不存整个 MusicInfo —— meta 里的 qualitys 等字段体积大且与"听过什么"无关，
     *  存全量会让历史文件迅速膨胀（500 条 × 每首几百字节的 qualitys）。
     *  前端要拿来播放时，用这些字段重建 playable song，足够解析器工作。 */
    interface HistoryItem {
      /** 去重键：`${source}|${songmid}`。同一首歌重复播放只更新时间戳，不新增条目。 */
      key: string
      source: string
      songmid: string
      name: string
      singer: string
      /** 格式化时长，如 "03:55" */
      interval: string | null
      /** 专辑名（列表可显示） */
      albumName?: string
      /** 封面直链 */
      img?: string | null
      /** 最近一次播放时间（毫秒时间戳） */
      playedAt: number
      /** 累计播放次数 */
      playCount: number
    }

    interface HistoryListData {
      /** 倒序（最近在前） */
      list: HistoryItem[]
    }

    /** 上报入参（前端传过来的原始 song 字段，服务端负责归一化） */
    interface ReportPayload {
      source?: string
      songmid?: string | number
      id?: string | number
      name?: string
      singer?: string
      interval?: string | null
      albumName?: string
      img?: string | null
    }
  }
}
