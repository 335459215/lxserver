import type { ReactNode } from 'react'
import { FileMusic } from 'lucide-react'
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
