import { Database, Gauge, Info, Music, Network, Palette, Play, ScrollText, Users2 } from 'lucide-react'

/** 设置中心九组（计划阶段 B：九宫格入口 → Tab 分组，组内可折叠分区）。
 * key 同时是 /settings/:group 的路由参数 */
export const SETTINGS_GROUPS = [
  { key: 'playback', label: '播放', icon: Play, hint: '播放偏好、音质、输出' },
  { key: 'appearance', label: '外观', icon: Palette, hint: '主题、布局、歌词样式' },
  { key: 'sources', label: '音源', icon: Music, hint: '自定义源、换源、优先级' },
  { key: 'data', label: '数据', icon: Database, hint: '歌单快照、备份、缓存' },
  { key: 'users', label: '用户', icon: Users2, hint: '账号与权限管理' },
  { key: 'network', label: '网络', icon: Network, hint: '代理、Subsonic、连接' },
  { key: 'system', label: '系统', icon: Gauge, hint: '运行状态、全局配置' },
  { key: 'logs', label: '日志', icon: ScrollText, hint: '运行日志查看' },
  { key: 'about', label: '关于', icon: Info, hint: '版本、更新、致谢' },
] as const

export type SettingsGroupKey = (typeof SETTINGS_GROUPS)[number]['key']
