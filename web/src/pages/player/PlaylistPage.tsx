import { ListMusic } from 'lucide-react'
import { Stack } from '@/components/ui'
import { PlannedPanel } from '@/components/player/PlannedPanel'

/** 歌单页壳：列表 / 详情 / 播放整条链路在阶段 C 后续版本接入 */
export default function PlaylistPage() {
  return (
    <Stack gap={6} className="w-full rise">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">歌单</h1>
        <p className="mt-1 text-sm text-dim">同步账号里的歌单与收藏歌曲，集中在一个地方。</p>
      </header>
      <PlannedPanel
        icon={ListMusic}
        title="歌单列表"
        note="读取同步账号歌单（/api/user/list）、歌单详情与整单播放在阶段 C 后续版本接入。"
        action={{ to: '/search', label: '先去搜索音乐' }}
      />
    </Stack>
  )
}
