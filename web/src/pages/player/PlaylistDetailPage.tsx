import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ListMusic } from 'lucide-react'
import { Stack } from '@/components/ui'
import { PlannedPanel } from '@/components/player/PlannedPanel'

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v)
  } catch {
    return v
  }
}

/** 歌单详情壳（/playlist/:id）：先认领路由与返回路径，数据接入在后续版本 */
export default function PlaylistDetailPage() {
  const { id } = useParams()
  const name = safeDecode(id ?? '')

  return (
    <Stack gap={6} className="w-full rise">
      <Link to="/playlist" className="inline-flex w-fit items-center gap-1 text-xs text-dim hover:text-ink">
        <ArrowLeft className="size-3.5" /> 返回歌单
      </Link>

      <header className="flex items-center gap-4">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-xl border border-line bg-panel2 text-faint">
          <ListMusic className="size-6" />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight text-ink">{name || '歌单'}</h1>
          <p className="mt-0.5 text-sm text-dim">曲目与播放将在阶段 C 后续版本接入。</p>
        </div>
      </header>

      <PlannedPanel
        icon={ListMusic}
        title="曲目列表"
        note="歌单曲目读取（/api/user/list、/api/data）与点歌播放在后续版本接入。"
      />
    </Stack>
  )
}
