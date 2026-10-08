import type { ReactNode } from 'react'
import { FileMusic, Heart, Trophy } from 'lucide-react'
import { Stack } from '@/components/ui'
import { PlannedPanel } from '@/components/player/PlannedPanel'

function Frame({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <Stack gap={6} className="w-full rise">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-1 text-sm text-dim">{hint}</p>
      </header>
      {children}
    </Stack>
  )
}

/** 排行榜壳：数据接口（/api/music/leaderboard）已就绪，页面在阶段 C 后续版本接入 */
export function LeaderboardPage() {
  return (
    <Frame title="排行榜" hint="酷我 / 网易 / QQ / 酷狗 / 咪咕 五平台榜单。">
      <PlannedPanel
        icon={Trophy}
        title="榜单列表"
        note="榜单数据（/api/music/leaderboard）与整榜播放在阶段 C 后续版本接入。"
        action={{ to: '/search', label: '先去搜索音乐' }}
      />
    </Frame>
  )
}

/** 我的收藏壳：喜欢列表接口已就绪，页面在阶段 C 后续版本接入 */
export function FavoritesPage() {
  return (
    <Frame title="我的收藏" hint="同步账号里喜欢的歌曲与收藏的歌单。">
      <PlannedPanel
        icon={Heart}
        title="喜欢的歌曲"
        note="喜欢列表（/api/music/user/list/*、/api/music/dislike）与收藏歌单在阶段 C 后续版本接入。"
        action={{ to: '/search', label: '先去搜索音乐' }}
      />
    </Frame>
  )
}

/** 本地音乐壳：服务端目录扫描接口已有，页面在阶段 C 后续版本接入 */
export function LocalMusicPage() {
  return (
    <Frame title="本地音乐" hint="服务端音乐目录里的歌曲、封面与标签。">
      <PlannedPanel
        icon={FileMusic}
        title="目录扫描"
        note="本地音乐扫描（/api/music/custom/list 等）与播放将在阶段 C 后续版本接入。"
        action={{ to: '/search', label: '先去搜索音乐' }}
      />
    </Frame>
  )
}
