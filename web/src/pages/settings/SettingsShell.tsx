import { useState } from 'react'
import { NavLink, Navigate, useParams } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { api, isAdmin, useAuth } from '@/lib/auth'
import { SETTINGS_GROUPS } from '@/lib/groups'
import { Button, Input, Stack } from '@/components/ui'
import { cn } from '@/lib/utils'
import UsersGroup from './groups/UsersGroup'
import TokensGroup from './groups/TokensGroup'
import DataGroup from './groups/DataGroup'
import LogsGroup from './groups/LogsGroup'
import PlaybackGroup from './groups/PlaybackGroup'
import NetworkGroup from './groups/NetworkGroup'
import SourcesGroup from './groups/SourcesGroup'
import AppearanceGroup from './groups/AppearanceGroup'

/** 管理员解锁卡（v2.24.0）。
 *
 * 管理员现在是**账号属性**：正常情况下登录即具备，这个卡片不会出现。
 * 它只在一种情形下渲染——已登录但不是管理员，此时给一次「用管理员账号重新登录」的机会，
 * 而不是把用户丢回登录页（那样会丢掉当前账号的听歌状态）。 */
function AdminGate() {
  const { refresh } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const res = await api.login(username.trim(), password)
    setBusy(false)
    if (!res.ok) {
      // 断网与凭据错误要分开提示（否则用户会反复重输密码）
      setError(res.error === 'network' ? '连不上服务器，请检查网络后重试' : '账号或密码不正确')
      return
    }
    await refresh()
    if (!res.isAdmin) setError('该账号不是管理员')
  }

  return (
    <form
      onSubmit={submit}
      className="mx-auto mt-10 w-full max-w-sm rounded-2xl border border-line bg-panel p-6 shadow-card rise"
    >
      <span className="flex size-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
        <Lock className="size-4" />
      </span>
      <h1 className="mt-3 text-base font-semibold text-ink">需要管理员账号</h1>
      <p className="mt-1 text-sm text-dim">
        当前账号没有管理权限。请用管理员账号登录以继续。
      </p>
      <div className="mt-4 space-y-3">
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="管理员账号"
          autoComplete="username"
          autoFocus
        />
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="密码"
          autoComplete="current-password"
        />
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <Button type="submit" className="mt-4 w-full" disabled={busy || !username.trim() || !password}>
        {busy ? '验证中…' : '登录'}
      </Button>
    </form>
  )
}

function GroupPage() {
  const { group } = useParams()
  switch (group) {
    case 'users':
      return <UsersGroup />
    case 'tokens':
      return <TokensGroup />
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
    default:
      // 【为什么是重定向而不是占位文案】
      // 走到这里只剩两种情况：用户直接访问 `/settings`（不带分组），
      // 或者访问了本次已删除的分组（`/settings/system`、`/settings/about` —— 老书签
      // 或浏览器历史里可能有）。两者都应该落到第一个分组，而不是显示一句
      // 让人以为「功能还没做」的占位话术。删除的分组由此自然失效，不必单独处理。
      return <Navigate to={`/settings/${SETTINGS_GROUPS[0].key}`} replace />
  }
}

const GROUP_TITLES: Map<string, string> = new Map(SETTINGS_GROUPS.map((g) => [g.key as string, g.label]))

/** 设置分组导航：设置自成体系，不再占用主侧栏（主侧栏只留「听歌」入口）。 */
function GroupNav({ current }: { current?: string }) {
  return (
    <nav aria-label="设置分组" className="flex flex-wrap gap-1.5">
      {SETTINGS_GROUPS.map((g) => (
        <NavLink
          key={g.key}
          to={`/settings/${g.key}`}
          aria-current={current === g.key ? 'page' : undefined}
          className={cn(
            // py-2 让命中高度到 34px（原 py-1 只有 26px，低于 WCAG 2.2 AA 的 24px 下限
            // 之上但离 Apple HIG 的 44px 还远）。这些是设置页的主导航，值得给足。
            'flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-2 text-xs transition-colors',
            current === g.key
              ? 'border-accent bg-accent text-white'
              : 'border-line bg-panel text-dim hover:border-accent/40 hover:text-ink',
          )}
        >
          <g.icon className="size-3.5" />
          {g.label}
        </NavLink>
      ))}
    </nav>
  )
}

/** 设置页内容区：分组导航 + 标题 + 分组内容。
 * 身份不足时渲染解锁卡（保持路由不动，登录后原位显示内容） */
export default function SettingsShell() {
  const { auth } = useAuth()
  const { group } = useParams()

  if (!isAdmin(auth)) return <AdminGate />

  const title = GROUP_TITLES.get(group ?? '') ?? '设置'
  const hint = SETTINGS_GROUPS.find((g) => g.key === group)?.hint

  return (
    <Stack gap={5} className="w-full rise">
      <GroupNav current={group} />
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {hint && <p className="mt-1 text-sm text-dim">{hint}</p>}
      </header>
      <GroupPage />
    </Stack>
  )
}
