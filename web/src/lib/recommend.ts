/** 今日甄选推荐流（前端接口层，v2.48.0）。
 *
 *  与服务端 `GET /api/music/recommend/daily` 对接。**这是「推荐」不是「搜索」**：
 *  服务端抓平台官方推荐专辑做候选池，再用本用户的播放历史重排，
 *  与 v2.47 之前「拿固定关键词去搜前 20 首」是两件事。
 *
 *  鉴权：必须带用户 token（推荐是**按人**算的，游客没有画像可用）。
 */
import { userAuthHeaders } from '@/lib/auth'
import type { Song } from '@/lib/music'

/** 服务端返回的一首歌（字段是 LX.Music.MusicInfo 的正常形状，前端按 Song 用） */
export interface RecommendMix {
  id: string
  songs: Song[]
  /** 命中的偏好歌手（可用来说明「因为你常听 X」） */
  topSingers: string[]
  /** 这一卡为什么是这些歌 */
  basis: string
}

export interface DailyRecommendation {
  /** 刷新日 `YYYY-MM-DD`（凌晨 6:00 为界） */
  day: string
  /** 整体来源说明 */
  basis: string
  cached: boolean
  /** 画像里权重最高的几个歌手（归一化后的名字） */
  affinitySingers: string[]
  /** 候选池构成：discover=平台推荐流，taste=按口味歌手搜来的（诊断用） */
  poolStats?: { discover: number; taste: number; total: number }
  /** 实际拿来搜歌的种子歌手（让「凭什么推这些」可解释） */
  seedSingers?: string[]
  mixes: RecommendMix[]
}

/** 拉今日推荐。失败抛错，调用方决定是提示还是静默回落。 */
export async function fetchDailyRecommendation(params?: {
  limit?: number
  force?: boolean
  signal?: AbortSignal
}): Promise<DailyRecommendation> {
  const qs = new URLSearchParams()
  if (params?.limit) qs.set('limit', String(params.limit))
  if (params?.force) qs.set('force', '1')
  const res = await fetch(`/api/music/recommend/daily?${qs.toString()}`, {
    headers: userAuthHeaders(),
    signal: params?.signal,
  })
  const data = (await res.json().catch(() => null)) as
    | (DailyRecommendation & { success?: boolean; message?: string })
    | null
  if (!res.ok || !data?.mixes) {
    throw new Error(data?.message ?? `获取推荐失败（HTTP ${res.status}）`)
  }
  return data
}
