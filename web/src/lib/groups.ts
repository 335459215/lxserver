import { Database, KeyRound, Music, Network, Palette, Play, ScrollText, Users2 } from 'lucide-react'

/** 设置中心分组（计划阶段 B：九宫格入口 → Tab 分组，组内可折叠分区）。
 * key 同时是 /settings/:group 的路由参数
 *
 * 【本次删减】去掉「系统」与「关于」两组：
 *  - 「关于」纯粹是版本号/致谢展示，没有可操作项，用户原话「没有用，可以彻底删除」。
 *  - 「系统」里的设置与「网络」重复（两处都有代理），其余项按归属拆走：
 *      代理相关      → 网络
 *      播放音质      → 播放（原先错放在「外观」）
 *      allowUnsafeVM → 音源（它管的就是音源脚本）
 *      调试/列表/快照 → 播放
 *    剩下只有「运行环境」状态面板与「全部配置（只读）」——前者信息在「日志」里够用，
 *    后者是一大坨只读键值，对普通用户没有意义，一并删除。
 * 结果：每个设置只在一个地方出现，且出现在用户会去找它的那个菜单里。 */
export const SETTINGS_GROUPS = [
  { key: 'playback', label: '播放', icon: Play, hint: '音质、播放偏好、解析策略' },
  { key: 'appearance', label: '外观', icon: Palette, hint: '主题、强调色' },
  { key: 'sources', label: '音源', icon: Music, hint: '自定义源、脚本安全' },
  { key: 'data', label: '数据', icon: Database, hint: '歌单快照、备份、缓存' },
  { key: 'users', label: '用户', icon: Users2, hint: '账号与权限管理' },
  // v2.25.0：外部工具（MCP / 脚本 / 第三方客户端）的凭据在这里管理。
  // 放在「用户」后面是因为它俩是一对：先有账号，才谈得上给账号发令牌。
  { key: 'tokens', label: '令牌', icon: KeyRound, hint: '外部工具访问凭据' },
  { key: 'network', label: '网络', icon: Network, hint: '代理、连接、反代' },
  { key: 'logs', label: '日志', icon: ScrollText, hint: '运行日志查看' },
] as const

export type SettingsGroupKey = (typeof SETTINGS_GROUPS)[number]['key']
