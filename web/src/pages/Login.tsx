import { useEffect, useState } from 'react'
import { api, useAuth } from '@/lib/auth'
import { Button, Input } from '@/components/ui'

interface RuntimeConfig {
  version?: string
  serverName?: string
}

/** 统一登录页（v2.24.0）。
 *
 * 【为什么只剩一个表单】
 * 此前这里是「管理员 / 用户 / 播放器」三个页签，对应服务端三套互不相干的凭据。
 * 用户要记两套密码，而且「我是管理员吗」与「我是谁」被拆成了两个问题。
 * 现在统一为**一个账号 + 一个密码**：账号在服务端 config.users 里，
 * 其中标记为管理员的账号登录后即可进入「设置」。
 *
 * 旧的「部署管理密码」不再需要在页面上输入；服务端仍兼容它（外部工具/脚本在用），
 * 但浏览器侧不再提示、不再落盘。 */
export default function Login() {
  const { refresh } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [cfg, setCfg] = useState<RuntimeConfig | null>(null)

  useEffect(() => {
    let alive = true
    // 绝对路径：登录页在任意路由下都可能渲染（未登录访问 /playlist/xxx 也是它），
    // 用相对路径会解析成 /playlist/config.json → 落到 SPA 回退拿到 HTML → 解析失败。
    fetch('/app/config.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setCfg(d))
      .catch(() => alive && setCfg({}))
    return () => {
      alive = false
    }
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const res = await api.login(username.trim(), password)
    setBusy(false)
    if (res.ok) await refresh()
    else setError('账号或密码不正确')
  }

  return (
    <div className="login-atmos flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rise">
        <div className="mb-6 flex flex-col items-center gap-1.5">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-accent" />
            <span className="text-lg font-semibold tracking-tight text-ink">
              {cfg?.serverName || 'lxserver'}
            </span>
          </div>
          <p className="text-xs text-dim">登录你的音乐服务器</p>
        </div>

        <div className="rounded-2xl border border-line bg-panel p-8 shadow-card">
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-dim" htmlFor="login-name">账号</label>
              <Input
                id="login-name"
                autoComplete="username"
                placeholder="用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-dim" htmlFor="login-pw">密码</label>
              <Input
                id="login-pw"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy || !username.trim() || !password}>
              {busy ? '验证中…' : '登录'}
            </Button>
          </form>

          {error && <p className="mt-3 text-center text-xs text-danger">{error}</p>}
        </div>

        <p className="mt-5 text-center font-mono text-[11px] text-faint">
          {cfg?.version ?? ''} {cfg?.serverName ? `· ${cfg.serverName}` : ''}
        </p>
      </div>
    </div>
  )
}
