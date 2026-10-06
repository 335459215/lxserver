import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { api, useAuth } from '@/lib/auth'
import { SETTINGS_GROUPS } from '@/lib/groups'
import { HStack, Stack } from '@/components/ui'

function fmtUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d} 天 ${h} 小时`
  if (h > 0) return `${h} 小时 ${m} 分`
  return `${m} 分钟`
}

function fmtBytes(n: number | undefined): string {
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

interface StatusShape {
  users?: number
  devices?: number
  uptime?: number
  memory?: number
  totalMemory?: number
  freeMemory?: number
  cpuUsage?: number | string
  sourcesCount?: number
  nodeVersion?: string
  platform?: string
}

/** 仪表盘：登录后首屏。管理员可见运行状态卡；九宫格即设置中心入口 */
export default function Dashboard() {
  const { auth } = useAuth()
  const [status, setStatus] = useState<StatusShape | null>(null)

  useEffect(() => {
    if (!auth.admin.ok) return
    let alive = true
    const load = () =>
      api
        .status()
        .then((d) => alive && setStatus(d as StatusShape))
        .catch(() => {})
    load()
    const timer = setInterval(load, 10_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [auth.admin.ok])

  return (
    <Stack gap={6} className="w-full rise">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          {auth.admin.ok ? '服务器运行正常' : '欢迎回来'}
        </h1>
        <p className="mt-1 text-sm text-dim">
          {auth.admin.ok
            ? '以下是实例的实时状态，分组管理在左侧导航。'
            : '以当前身份登录，可用的管理功能在左侧导航中。'}
        </p>
      </header>

      {auth.admin.ok && (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: '在线设备', value: status ? String(status.devices ?? '—') : '…' },
            { label: '用户数', value: status ? String(status.users ?? '—') : '…' },
            {
              label: '内存占用',
              value: status?.totalMemory
                ? `${Math.round(100 - ((status.freeMemory ?? 0) / status.totalMemory) * 100)}%`
                : '…',
              sub: status?.totalMemory
                ? `${fmtBytes(status.totalMemory - (status.freeMemory ?? 0))} / ${fmtBytes(status.totalMemory)}`
                : undefined,
            },
            {
              label: 'CPU',
              value:
                status?.cpuUsage !== undefined
                  ? `${typeof status.cpuUsage === 'number' ? status.cpuUsage.toFixed(1) : status.cpuUsage}%`
                  : '…',
              sub: status?.memory ? `进程 ${fmtBytes(status.memory)}` : undefined,
            },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-line bg-panel p-4 shadow-card">
              <div className="text-xs text-dim">{s.label}</div>
              <div className="mt-1 font-mono text-xl font-medium text-ink">{s.value}</div>
              {s.sub && <div className="mt-0.5 text-[11px] text-faint">{s.sub}</div>}
            </div>
          ))}
        </section>
      )}

      {auth.admin.ok && status && (
        <p className="font-mono text-xs text-faint">
          已运行 {fmtUptime(status.uptime ?? 0)} · {status.platform} · Node {status.nodeVersion} · 音源 {status.sourcesCount ?? 0} 个
        </p>
      )}

      <section>
        <h2 className="text-sm font-medium text-ink">设置中心</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3">
          {SETTINGS_GROUPS.map((g, i) => (
            <Link
              key={g.key}
              to={`/settings/${g.key}`}
              className="group rise flex items-center gap-3 rounded-xl border border-line bg-panel p-4 shadow-card transition-all hover:border-accent/40 hover:shadow-pop"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <g.icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">{g.label}</span>
                <span className="block truncate text-xs text-faint">{g.hint}</span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
            </Link>
          ))}
        </div>
      </section>

      {!auth.admin.ok && (
        <HStack gap={2}>
          <Link to="/settings/about" className="text-xs text-accent hover:underline">
            查看版本信息 →
          </Link>
        </HStack>
      )}
    </Stack>
  )
}
