import { useEffect, useState } from 'react'
import { api } from '@/lib/auth'
import { Stack } from '@/components/ui'

interface StatusShape {
  uptime?: number
  totalMemory?: number
  freeMemory?: number
  memory?: number
  cpuUsage?: number | string
  processCpuUsage?: number | string
  osUptime?: number
  cpus?: number
  cpuModel?: string
  isWebDAVConfigured?: boolean
  sourcesCount?: number
  nodeVersion?: string
  platform?: string
}

function fmtBytes(n?: number): string {
  if (n === undefined) return '…'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-2 text-sm transition-colors last:border-b-0 hover:bg-panel2/40">
      <span className="shrink-0 text-dim">{k}</span>
      <span className="truncate text-right font-mono text-ink" title={v}>
        {v}
      </span>
    </div>
  )
}

/** 系统组：运行状态（/api/status 实时） + 全局配置只读视图（/api/config）。
 * 配置的「可写编辑 + 逐键表单」在后续切片接入（对应计划「配置」面板并入） */
export default function SystemGroup() {
  const [status, setStatus] = useState<StatusShape | null>(null)
  const [config, setConfig] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    const load = () =>
      api
        .status()
        .then((d) => alive && setStatus(d as StatusShape))
        .catch(() => alive && setError('状态获取失败（401 会自动清除本地密码）'))
    load()
    const timer = setInterval(load, 10_000)
    api
      .config()
      .then((d) => alive && setConfig(d))
      .catch(() => {})
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  if (error && !status) return <div className="text-sm text-danger">{error}</div>
  if (!status) return <div className="text-sm text-dim">加载中…</div>

  return (
    <Stack gap={5}>
      <section className="rounded-2xl border border-line bg-panel p-5">
        <h3 className="text-sm font-medium text-ink">运行环境</h3>
        <div className="mt-2">
          <Row k="平台" v={status.platform ?? '…'} />
          <Row k="Node" v={status.nodeVersion ?? '…'} />
          <Row k="CPU" v={`${status.cpus ?? '…'} 核 · ${status.cpuModel ?? ''}`} />
          <Row k="CPU 占用" v={status.cpuUsage !== undefined ? `${typeof status.cpuUsage === 'number' ? status.cpuUsage.toFixed(1) : status.cpuUsage}%（进程 ${typeof status.processCpuUsage === 'number' ? status.processCpuUsage.toFixed(1) : status.processCpuUsage}%）` : '…'} />
          <Row k="系统内存" v={`${fmtBytes(status.totalMemory! - (status.freeMemory ?? 0))} / ${fmtBytes(status.totalMemory)}`} />
          <Row k="进程内存" v={fmtBytes(status.memory)} />
          <Row k="系统已运行" v={`${Math.floor((status.osUptime ?? 0) / 3600)} 小时`} />
          <Row k="WebDAV" v={status.isWebDAVConfigured ? '已配置' : '未配置'} />
          <Row k="已载入音源" v={String(status.sourcesCount ?? 0)} />
        </div>
      </section>

      {config && (
        <section className="rounded-2xl border border-line bg-panel p-5">
          <h3 className="text-sm font-medium text-ink">全局配置（只读）</h3>
          <p className="mt-1 text-xs text-faint">对应 data/config.js 的服务端视图；编辑能力随「配置」面板迁移接入。</p>
          <div className="mt-2">
            {Object.entries(config).map(([k, v]) => (
              <Row key={k} k={k} v={typeof v === 'object' ? JSON.stringify(v) : String(v)} />
            ))}
          </div>
        </section>
      )}
    </Stack>
  )
}
