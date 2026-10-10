/** 播放音质偏好（localStorage，不走后端）。
 *
 *  为什么是客户端偏好而不是服务端配置：音质是「这个人此刻想听多好」，同一台服务器
 *  上不同设备/不同人的合理取值不同（手机流量下想省流、局域网大屏想听无损）。
 *  而 /api/music/url 的 quality 是**每次请求都可传**的参数，服务端也不做白名单校验
 *  （直接透传给解析器），所以放在前端最合适。
 *
 *  档位取自服务端解析器实际支持的全集（见 src/server/downloadQuality.ts 的
 *  DOWNLOAD_QUALITY_PRIORITY），并已用 .playwright/probe-quality.py 对五个平台实测过
 *  可达性（192k 及以上全平台可用）。
 *
 *  重要：这里选择的是**首选档位**，不是硬约束。解析器会从该档位向下逐级回退，
 *  所以选「无损」但该曲只有 320k 时，仍会正常播放 320k —— 此时 UI 必须如实显示
 *  **实得档位**而不是首选档位（这就是 resolvedQuality 存在的原因）。
 */

/** 可选档位（由低到高）。label 用于 UI，desc 说明典型场景/体积量级。 */
export const QUALITY_TIERS = [
  { value: '128k', label: '标准', short: '128k', desc: '体积最小，省流量', approx: '约 1 MB/分钟' },
  { value: '192k', label: '较高', short: '192k', desc: '体积与听感均衡', approx: '约 1.5 MB/分钟' },
  { value: '320k', label: '高', short: '320k', desc: '多数平台的最佳有损音质', approx: '约 2.5 MB/分钟' },
  { value: 'flac', label: '无损', short: 'FLAC', desc: '无损压缩，需源提供', approx: '约 7 MB/分钟' },
  { value: 'flac24bit', label: '无损 24bit', short: '24bit', desc: '高解析，体积更大', approx: '约 12 MB/分钟' },
  { value: 'hires', label: 'Hi-Res', short: 'Hi-Res', desc: '最高规格，源支持得少', approx: '约 15 MB/分钟' },
] as const

export type QualityTier = (typeof QUALITY_TIERS)[number]['value']

/** 默认档位：320k。理由是同档位在五个平台都稳定可得，且是有损音质的上限，
 *  在「听感」与「体积/等待」之间是主流播放器的默认选择（Spotify Premium 的 Very High 同理）。 */
export const DEFAULT_QUALITY: QualityTier = '320k'

const STORAGE_KEY = 'lx.playback.quality'

/** 解析器回退链：从首选档位开始，依次尝试更低档位。
 *  与服务端 DOWNLOAD_QUALITY_PRIORITY 的前缀语义一致（低→高），这里只取到 128k 为止，
 *  不包含 atmos/master（那是下载专有、播放源几乎不提供）。 */
const FALLBACK_CHAIN: readonly QualityTier[] = ['hires', 'flac24bit', 'flac', '320k', '192k', '128k']

/** 由首选档位生成回退链（首选 + 其下所有档位）。
 *  例：首选 flac → ['flac', '320k', '192k', '128k']。
 *  未知档位（后端将来加了新值）返回它自己，避免误伤。 */
export function qualityFallback(tier: string): string[] {
  const i = FALLBACK_CHAIN.indexOf(tier as QualityTier)
  if (i < 0) return [tier]
  return FALLBACK_CHAIN.slice(i) as unknown as string[]
}

/** 读取已保存的档位；未保存/值非法时回落默认。 */
export function savedQuality(): QualityTier {
  if (typeof localStorage === 'undefined') return DEFAULT_QUALITY
  const v = localStorage.getItem(STORAGE_KEY)
  return QUALITY_TIERS.some((t) => t.value === v) ? (v as QualityTier) : DEFAULT_QUALITY
}

export function saveQuality(tier: QualityTier) {
  try {
    localStorage.setItem(STORAGE_KEY, tier)
  } catch {
    // 隐私模式：仅本次会话生效
  }
}

/** 档位 → 展示标签。未知值原样返回（后端将来新增档位时不至于显示空白）。 */
export function qualityLabel(value: string | null | undefined): string {
  if (!value) return ''
  const t = QUALITY_TIERS.find((x) => x.value === value)
  return t ? t.label : value
}

/** 档位 → 紧凑标签（播放栏这类窄位置用）。 */
export function qualityShort(value: string | null | undefined): string {
  if (!value) return ''
  const t = QUALITY_TIERS.find((x) => x.value === value)
  return t ? t.short : value
}
