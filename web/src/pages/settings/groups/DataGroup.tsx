import { useEffect, useState } from 'react'
import { adminFetch, api } from '@/lib/auth'
import { Button, Stack, useToast } from '@/components/ui'

interface BackupRow {
  name: string
  size: number
  time: number
  type: 'auto' | 'manual'
}

function fmtBytes(n?: number): string {
  if (n === undefined) return '…'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(1)} ${units[i]}`
}

/** 数据组：配置备份列表 + 手动备份（复用现有 /api/config/backups* 接口）。
 * 歌单快照管理、缓存清理等后续切片接入 */
export default function DataGroup() {
  const { toast } = useToast()
  const [backups, setBackups] = useState<BackupRow[] | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () =>
    api
      .backups()
      .then(setBackups)
      .catch(() => setBackups([]))

  useEffect(() => {
    void load()
  }, [])

  const backupNow = async () => {
    setBusy(true)
    try {
      const res = await adminFetch('/api/config/backup-now', { method: 'POST' })
      if (res.ok) {
        toast({ title: '备份完成', variant: 'success' })
        await load()
      } else {
        toast({ title: '备份失败', description: `HTTP ${res.status}`, variant: 'destructive' })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack gap={3}>
      <div className="rounded-2xl border border-line bg-panel p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-ink">配置备份</h3>
          <Button size="sm" variant="secondary" onClick={backupNow} disabled={busy}>
            {busy ? '备份中…' : '立即备份'}
          </Button>
        </div>
        <p className="mt-1 text-xs text-faint">
          仅元数据（config/users/snapshots 指针），不含音频缓存；自动备份每天一份。
        </p>
        <div className="mt-3 divide-y divide-line">
          {(backups ?? []).map((b) => (
            <div key={b.name} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="truncate font-mono text-ink">{b.name}</span>
              <span className="flex shrink-0 items-center gap-2 text-xs text-dim">
                <span className={`rounded px-1.5 py-0.5 ${b.type === 'auto' ? 'bg-panel2 text-dim' : 'bg-accent-soft text-accent'}`}>
                  {b.type === 'auto' ? '自动' : '手动'}
                </span>
                {fmtBytes(b.size)}
                <span>{new Date(b.time).toLocaleString()}</span>
              </span>
            </div>
          ))}
          {backups && backups.length === 0 && (
            <div className="py-4 text-center text-sm text-faint">暂无备份</div>
          )}
        </div>
      </div>
    </Stack>
  )
}
