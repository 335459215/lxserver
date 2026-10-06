import * as React from 'react'

// ===== 鉴权状态（阶段 B 开篇）=====
// 服务器现有四套鉴权，本 hook 统一为前端可消费的单一状态：
//   管理员：POST /api/login 验密（无会话），此后每个管理 API 带 x-frontend-auth 头。
//           密码存 localStorage——与旧后台完全相同的信任模型（密码在浏览器侧持有）。
//   用户  ：POST /api/user/login 换 token（7 天 TTL，Redis 会话层），带 x-user-token 头。
//   播放器：POST /api/music/auth 换 HttpOnly Cookie（24h TTL），服务端 checkPlayerAuth 校验。
//   同步协议：LX 客户端专用，与 Web UI 无关，这里不涉及。
// 状态判定全部调用服务端真实校验端点，不在前端「猜」。

const ADMIN_KEY = 'lx.admin.password'
const USER_TOKEN_KEY = 'lx.user.token'

export interface AuthState {
  loading: boolean
  /** 管理员：ok=true 表示本地持有且服务端验证通过的密码 */
  admin: { ok: boolean; checked: boolean }
  user: { ok: boolean; username: string | null; checked: boolean }
  player: { ok: boolean; checked: boolean }
}

export function getAdminPassword(): string {
  return localStorage.getItem(ADMIN_KEY) ?? ''
}

export function setAdminPassword(password: string) {
  if (password) localStorage.setItem(ADMIN_KEY, password)
  else localStorage.removeItem(ADMIN_KEY)
}

export function getUserToken(): string {
  return localStorage.getItem(USER_TOKEN_KEY) ?? ''
}

export function setUserToken(token: string) {
  if (token) localStorage.setItem(USER_TOKEN_KEY, token)
  else localStorage.removeItem(USER_TOKEN_KEY)
}

/** 管理 API 包装：自动带 x-frontend-auth；401 时清除本地密码并抛出 */
export async function adminFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      'Content-Type': 'application/json',
      'x-frontend-auth': getAdminPassword(),
    },
  })
  if (res.status === 401) setAdminPassword('')
  return res
}

async function adminFetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await adminFetch(url, init)
  if (!res.ok) throw new Error(`${url} -> ${res.status}`)
  return res.json() as Promise<T>
}

export const api = {
  adminLogin: async (password: string): Promise<boolean> => {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    return res.ok
  },
  config: () => adminFetchJson<Record<string, unknown>>('/api/config'),
  status: () => adminFetchJson<Record<string, unknown>>('/api/status'),
  stats: () => adminFetchJson<Record<string, unknown>>('/api/stats'),
  users: () =>
    adminFetchJson<
      Array<{
        name: string
        enableCustomMusicDir?: boolean
        customMusicDir?: string
        allowOperateCustomMusicDir?: boolean
        allowWriteCustomMusicDir?: boolean
        enableAutoDownload?: boolean
      }>
    >('/api/users'),
  backups: () =>
    adminFetchJson<Array<{ name: string; size: number; time: number; type: 'auto' | 'manual' }>>(
      '/api/config/backups',
    ),
  userVerify: async (): Promise<{ ok: boolean; username: string | null }> => {
    const token = getUserToken()
    if (!token) return { ok: false, username: null }
    const res = await fetch('/api/user/auth/verify', { headers: { 'x-user-token': token } })
    if (!res.ok) return { ok: false, username: null }
    const data = (await res.json()) as { valid?: boolean; username?: string }
    return { ok: !!data.valid, username: data.valid ? (data.username ?? null) : null }
  },
  playerVerify: async (): Promise<boolean> => {
    // 播放器认证未开启时服务端恒放行（checkPlayerAuth 直接 true），
    // 那是"公开播放器"而不是"已登录"，不得据此跳过登录页
    try {
      const pub = await fetch('/app/config.json', { cache: 'no-store' }).then((r) => r.json())
      if (!pub?.['player.enableAuth']) return false
    } catch {
      return false
    }
    const res = await fetch('/api/music/auth/verify')
    if (!res.ok) return false
    const data = (await res.json()) as { valid?: boolean }
    return !!data.valid
  },
  playerEnabled: async (): Promise<boolean> => {
    try {
      const pub = await fetch('/app/config.json', { cache: 'no-store' }).then((r) => r.json())
      return !!pub?.['player.enableAuth']
    } catch {
      return false
    }
  },
  playerLogin: async (password: string): Promise<boolean> => {
    const res = await fetch('/api/music/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    return res.ok
  },
  userLogin: async (username: string, password: string): Promise<boolean> => {
    const res = await fetch('/api/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) return false
    const data = (await res.json()) as { token?: string }
    if (data.token) {
      setUserToken(data.token)
      return true
    }
    return false
  },
  logoutAll: async () => {
    const token = getUserToken()
    if (token) {
      await fetch('/api/user/logout', { method: 'POST', headers: { 'x-user-token': token } }).catch(() => {})
    }
    setUserToken('')
    setAdminPassword('')
  },
}

const AuthContext = React.createContext<{
  auth: AuthState
  refresh: () => Promise<void>
}>({ auth: { loading: true, admin: { ok: false, checked: false }, user: { ok: false, username: null, checked: false }, player: { ok: false, checked: false } }, refresh: async () => {} })

export function useAuth() {
  return React.useContext(AuthContext)
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = React.useState<AuthState>({
    loading: true,
    admin: { ok: false, checked: false },
    user: { ok: false, username: null, checked: false },
    player: { ok: false, checked: false },
  })

  const refresh = React.useCallback(async () => {
    // 三态并发探测；管理态只有本地存有密码时才需要校验（否则必然未登录）
    const hasAdminPassword = !!getAdminPassword()
    const [userRes, playerRes] = await Promise.all([api.userVerify(), api.playerVerify()])
    let adminOk = false
    if (hasAdminPassword) {
      // 校验一个轻量管理端点；401/失败都视为未登录
      try {
        const res = await adminFetch('/api/stats')
        adminOk = res.ok
      } catch {
        adminOk = false
      }
    }
    setAuth({
      loading: false,
      admin: { ok: adminOk, checked: true },
      user: { ok: userRes.ok, username: userRes.username, checked: true },
      player: { ok: playerRes, checked: true },
    })
  }, [])

  React.useEffect(() => {
    // 挂载时的一次性探测：refresh 内的 setAuth 都在 await 之后（非同步），
    // 不构成 set-state-in-effect 关心的级联渲染路径
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  return <AuthContext.Provider value={{ auth, refresh }}>{children}</AuthContext.Provider>
}

/** 角色排序：管理员 > 用户 > 播放器，供 UI 显示当前身份 */
export function primaryRole(auth: AuthState): 'admin' | 'user' | 'player' | 'none' {
  if (auth.admin.ok) return 'admin'
  if (auth.user.ok) return 'user'
  if (auth.player.ok) return 'player'
  return 'none'
}
