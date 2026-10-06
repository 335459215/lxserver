import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { api, setAdminPassword, useAuth } from '@/lib/auth'
import { SETTINGS_GROUPS } from '@/lib/groups'
import { Button, Input, Stack } from '@/components/ui'
import SystemGroup from './groups/SystemGroup'
import UsersGroup from './groups/UsersGroup'
import DataGroup from './groups/DataGroup'
import AboutGroup from './groups/AboutGroup'
import LogsGroup from './groups/LogsGroup'
import PlaybackGroup from './groups/PlaybackGroup'
import NetworkGroup from './groups/NetworkGroup'
import SourcesGroup from './groups/SourcesGroup'
import AppearanceGroup from './groups/AppearanceGroup'

/** 管理员登录卡：验证走服务端 /api/login（与旧后台同一信任模型：密码留存浏览器） */
function AdminGate() {
  const { refresh } = useAuth()
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(false)
    const ok = await api.adminLogin(password)
    setBusy(false)
    if (ok) {
      setAdminPassword(password)
      await refresh()
    } else {
      setError(true)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mx-auto mt-10 w-full max-w-sm rounded-2xl border border-line bg-panel p-6 shadow-card rise"
    >
      <span className="flex size-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
        <Lock className="size-4" />
      </span>
      <h1 className="mt-3 text-base font-semibold text-ink">需要管理员权限</h1>
      <p className="mt-1 text-sm text-dim">输入管理密码以继续（旧后台 /admin 的访问密码）。</p>
      <Input
        type="password"
        className="mt-4"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="管理密码"
        autoFocus
      />
      {error && <p className="mt-2 text-xs text-danger">密码不正确</p>}
      <Button type="submit" className="mt-4 w-full" disabled={busy || !password}>
        {busy ? '验证中…' : '解锁'}
      </Button>
    </form>
  )
}

function GroupPage() {
  const { group } = useParams()
  switch (group) {
    case 'system':
      return <SystemGroup />
    case 'users':
      return <UsersGroup />
    case 'data':
      return <DataGroup />
    case 'logs':
      return <LogsGroup />
    case 'playback':
      return <PlaybackGroup />
    case 'network':
      return <NetworkGroup />
    case 'sources':
      return <SourcesGroup />
    case 'appearance':
      return <AppearanceGroup />
    case 'about':
      return <AboutGroup />
    default:
      return (
        <div className="rounded-2xl border border-dashed border-line bg-panel/60 p-10 text-center text-sm text-faint">
          该分组将在阶段 B 的后续切片接入（原后台对应面板迁移时替换本占位）。
        </div>
      )
  }
}

const GROUP_TITLES: Map<string, string> = new Map(SETTINGS_GROUPS.map((g) => [g.key as string, g.label]))

/** 设置页内容区：侧边栏在应用外壳里，这里只负责标题 + 分组内容。
 * 身份不足时渲染解锁卡（保持路由不动，登录后原位显示内容） */
export default function SettingsShell() {
  const { auth } = useAuth()
  const { group } = useParams()

  if (!auth.admin.ok) return <AdminGate />

  const title = GROUP_TITLES.get(group ?? '') ?? '设置'
  const hint = SETTINGS_GROUPS.find((g) => g.key === group)?.hint

  return (
    <Stack gap={5} className="w-full rise">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {hint && <p className="mt-1 text-sm text-dim">{hint}</p>}
      </header>
      <GroupPage />
    </Stack>
  )
}
