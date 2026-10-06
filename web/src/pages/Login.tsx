import { useEffect, useState } from 'react'
import { api, useAuth } from '@/lib/auth'
import { Button, Input, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui'

interface RuntimeConfig {
  version?: string
  serverName?: string
}

/** 登录页（阶段 B：首访即登录）。三种身份一张卡，服务端真实校验：
 * 管理员=/api/login、用户=/api/user/login(发 Token)、播放器=/api/music/auth(发 Cookie) */
export default function Login() {
  const { refresh } = useAuth()
  const [tab, setTab] = useState('admin')
  const [adminPassword, setAdminPassword] = useState('')
  const [username, setUsername] = useState('')
  const [userPassword, setUserPassword] = useState('')
  const [playerPassword, setPlayerPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [cfg, setCfg] = useState<RuntimeConfig | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/app/config.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setCfg(d))
      .catch(() => alive && setCfg({}))
    return () => {
      alive = false
    }
  }, [])

  const run = async (fn: () => Promise<boolean>) => {
    setBusy(true)
    setError('')
    const ok = await fn()
    setBusy(false)
    if (ok) await refresh()
    else setError('凭据不正确，请重试')
  }

  return (
    <div className="login-atmos flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rise">
        <div className="mb-6 flex flex-col items-center gap-1.5">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-accent" />
            <span className="text-lg font-semibold tracking-tight text-ink">lxserver</span>
          </div>
          <p className="text-xs text-dim">登录以管理你的音乐服务器</p>
        </div>

        <div className="rounded-2xl border border-line bg-panel p-8 shadow-card">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="w-full">
              <TabsTrigger value="admin" className="flex-1">管理员</TabsTrigger>
              <TabsTrigger value="user" className="flex-1">用户</TabsTrigger>
              <TabsTrigger value="player" className="flex-1">播放器</TabsTrigger>
            </TabsList>

            <TabsContent value="admin">
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void run(() => api.adminLogin(adminPassword))
                }}
                className="space-y-3"
              >
                <p className="text-xs text-dim">服务端管理密码（旧后台 /admin 同一个）。</p>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-dim" htmlFor="admin-pw">管理密码</label>
                  <Input
                    id="admin-pw"
                    type="password"
                    placeholder="••••••••"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    autoFocus
                  />
                </div>
                <Button type="submit" className="w-full" disabled={busy || !adminPassword}>
                  {busy ? '验证中…' : '登录'}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="user">
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void run(() => api.userLogin(username, userPassword))
                }}
                className="space-y-3"
              >
                <p className="text-xs text-dim">同步账号，登录后可管理歌单与个人设置。</p>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-dim" htmlFor="user-name">用户名</label>
                  <Input id="user-name" placeholder="yueyue" value={username} onChange={(e) => setUsername(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-dim" htmlFor="user-pw">密码</label>
                  <Input
                    id="user-pw"
                    type="password"
                    placeholder="••••••••"
                    value={userPassword}
                    onChange={(e) => setUserPassword(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={busy || !username || !userPassword}>
                  {busy ? '验证中…' : '登录'}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="player">
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void run(() => api.playerLogin(playerPassword))
                }}
                className="space-y-3"
              >
                <p className="text-xs text-dim">Web 播放器访问密码（服务端开启播放器认证时需要）。</p>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-dim" htmlFor="player-pw">播放器密码</label>
                  <Input
                    id="player-pw"
                    type="password"
                    placeholder="••••••••"
                    value={playerPassword}
                    onChange={(e) => setPlayerPassword(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={busy || !playerPassword}>
                  {busy ? '验证中…' : '进入播放器'}
                </Button>
                <p className="text-center text-xs text-faint">
                  或直接使用 <a href="/" className="text-accent hover:underline">旧版播放器</a>
                </p>
              </form>
            </TabsContent>
          </Tabs>

          {error && <p className="mt-3 text-center text-xs text-danger">{error}</p>}
        </div>

        <p className="mt-5 text-center font-mono text-[11px] text-faint">
          {cfg?.version ?? ''} {cfg?.serverName ? `· ${cfg.serverName}` : ''}
        </p>
      </div>
    </div>
  )
}
