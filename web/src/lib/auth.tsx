import * as React from 'react'

// ===== 鉴权状态（v2.25.0：只有「账号 + 密码」）=====
//
// 【模型】与 Emby / Jellyfin 同一套：
//   - 网页登录只有一种方式：账号 + 密码 → 换取 token；
//   - 那个 token 既是网页会话凭据，也是**外部工具**的凭据
//     （长期令牌在「设置 → 令牌」里生成，供 MCP / 脚本等使用）。
//   没有任何「与账号无关的独立密码」。
//
// 【v2.25.0 删掉了什么（改前必读）】
//   1. `frontend.password`（部署管理密码）：整条链路删除。它明文存 localStorage，
//      与账号体系并行，用户要记两套凭据 —— 正是用户点名要删的东西。
//   2. `x-frontend-auth` 请求头：整条链路删除。管理接口现在一律认 `x-user-token`，
//      与听歌接口用同一个头、同一份凭据。
//   （此前为了「60 多处管理接口一行不用改」，曾把 x-frontend-auth 的值换成用户 token
//    来做过渡；v2.25.0 把这个过渡层也去掉了，头名本身不再存在。）
//
// 【播放器那套为什么删掉（v2.24.0 已做）】
// `player.enableAuth` 是给**旧版播放器**（挂在 `/` 的静态页）做的门禁：
// 它给整个站点发 HttpOnly Cookie，与账号体系完全并行。旧版已于 v2.23.0 删除，
// 新版前端本来就由「登录门」守着（未登录不露任何导航），再加一层播放器密码
// 只会让用户登录两次。故 playerLogin/playerVerify 及其配置项一并移除。
// 服务端 `/api/music/auth*` 端点保留（外部工具可能仍在用），只是前端不再调用。

const USER_TOKEN_KEY = 'lx.user.token'
const USER_NAME_KEY = 'lx.user.name'
/**
 * 旧版遗留的部署密码键名。**只用于删除**（见 clearLegacyAdminPassword）。
 *
 * 为什么删掉逻辑还要留着：v2.25.0 之前登录过的人浏览器里存着 `lx.admin.password`。
 * 虽然服务端已经完全不认它了（认了也没用），但它毕竟是明文密码躺在 localStorage 里，
 * 能抹掉就抹掉 —— 保留一个几十字节的清理函数换「用户浏览器里不再有明文密码」，划算。
 */
const LEGACY_ADMIN_KEY = 'lx.admin.password'

export interface AuthState {
  loading: boolean
  /** 已登录的账号；isAdmin 决定「设置」入口是否可见 */
  user: { ok: boolean; username: string | null; isAdmin: boolean; checked: boolean }
}

export function getUserToken(): string {
  return localStorage.getItem(USER_TOKEN_KEY) ?? ''
}

export function setUserToken(token: string) {
  if (token) localStorage.setItem(USER_TOKEN_KEY, token)
  else localStorage.removeItem(USER_TOKEN_KEY)
}

export function getUserName(): string {
  return localStorage.getItem(USER_NAME_KEY) ?? ''
}

export function setUserName(name: string) {
  if (name) localStorage.setItem(USER_NAME_KEY, name)
  else localStorage.removeItem(USER_NAME_KEY)
}

/** 自定义音源管理接口的归属用户（见下面 `api.sources` 的说明）。
 *  未登录时退回 `'default'` —— 服务端对 `default` 的处理是「只返回 _open 共享源」，
 *  是一个安全的降级：宁可少显示，也不会把别的用户的私有源暴露出来。 */
function sourceOwner(): string {
  return getUserName() || 'default'
}

/**
 * 清除旧版遗留的部署密码（迁移用，登录成功与退出登录时各调一次）。
 *
 * 服务端已不再认这个凭据，所以它**不再是权限残留**；这里清它是为了
 * 不在用户浏览器里留一份明文密码。
 */
export function clearLegacyAdminPassword() {
  try {
    localStorage.removeItem(LEGACY_ADMIN_KEY)
  } catch {
    /* 隐私模式 */
  }
}

/**
 * 播放接口（/api/music/url）的用户鉴权头。
 *
 * 为什么必须有：自定义音源按用户名归属落盘（data/users/source/<user>/），服务端在该
 * 接口上做「具名用户必须带有效 token」的校验，再把 verifiedUsername 交给解析器去挑
 * 这个人自己的源。不带这个头就退化成公开用户 `open`，而 `_open` 目录通常没有源——
 * 表现为搜索一切正常、点歌却一律「未找到支持 X 平台的自定义源」。
 */
export function userAuthHeaders(): Record<string, string> {
  const token = getUserToken()
  const name = getUserName()
  if (!token || !name) return {}
  return { 'x-user-name': name, 'x-user-token': token }
}

/**
 * 管理 API 包装：自动带用户 token；401 时清除本地登录态并抛出。
 *
 * 【v2.25.0】头名从 `x-frontend-auth` 换成 `x-user-token` —— 与听歌接口同一个头。
 * 服务端 60 多处管理校验也同步改成只认这个头，两边是一套东西。
 */
export async function adminFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      'Content-Type': 'application/json',
      'x-user-token': getUserToken(),
    },
  })
  if (res.status === 401) {
    setUserToken('')
    setUserName('')
  }
  return res
}

async function adminFetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await adminFetch(url, init)
  if (!res.ok) throw new Error(`${url} -> ${res.status}`)
  return res.json() as Promise<T>
}

export const api = {
  /**
   * 统一登录：账号 + 密码。成功后落盘 token 与用户名。
   *
   * 返回 `error` 区分两种失败，界面据此给不同提示：
   *   'network' —— 连不上服务器（断网/服务端没起）。这时说「账号或密码不正确」是误导，
   *                用户会反复重输密码；必须让他去查网络。
   *   'auth'    —— 服务器明确拒绝了凭据。
   * 原先只返回 ok:false，且**没有 try/catch** —— 断网时 fetch 抛异常会让
   * 「登录中…」永远停住（按钮 disabled），用户只能刷新页面。
   */
  login: async (
    username: string,
    password: string,
  ): Promise<{ ok: boolean; isAdmin: boolean; error?: 'network' | 'auth' }> => {
    let res: Response
    try {
      res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
    } catch {
      return { ok: false, isAdmin: false, error: 'network' }
    }
    if (!res.ok) return { ok: false, isAdmin: false, error: 'auth' }
    const data = (await res.json().catch(() => ({}))) as { token?: string; isAdmin?: boolean }
    if (!data.token) return { ok: false, isAdmin: false, error: 'auth' }
    setUserToken(data.token)
    setUserName(username)
    // 迁移：老版本留下的部署密码不再需要，清掉避免它继续作为管理凭据生效
    clearLegacyAdminPassword()
    return { ok: true, isAdmin: !!data.isAdmin }
  },
  config: () => adminFetchJson<Record<string, unknown>>('/api/config'),
  status: () => adminFetchJson<Record<string, unknown>>('/api/status'),
  stats: () => adminFetchJson<Record<string, unknown>>('/api/stats'),
  users: () =>
    adminFetchJson<
      Array<{
        name: string
        isAdmin?: boolean
        enableCustomMusicDir?: boolean
        customMusicDir?: string
        allowOperateCustomMusicDir?: boolean
        allowWriteCustomMusicDir?: boolean
        enableAutoDownload?: boolean
      }>
    >('/api/users'),
  /**
   * 配置备份列表。
   *
   * 【为什么这里必须解包 `.list`，不能直接把响应当数组返回】
   * 服务端 `GET /api/config/backups` 返回的是**信封对象**：
   *   `{ success, backupDir, autoBackupEnabled, retentionDays, list: [...] }`
   * 而这里原先声明的返回类型是 `Array<...>`，等于对一个对象撒谎。调用方
   * （DataGroup）按声明去 `(backups ?? []).map(...)`，拿到对象后 `.map` 不存在，
   * 渲染期抛 `is not a function` → 整棵 React 树被卸载 → 全站白屏。
   * 修在 API 层而不是调用方：类型声明与运行时形状必须一致，否则每个调用方
   * 都要各自防一手，漏一个就再炸一次。
   */
  backups: async (): Promise<
    Array<{ name: string; size: number; time: number; type: 'auto' | 'manual' }>
  > => {
    const data = await adminFetchJson<{
      list?: Array<{ name: string; size: number; time: number; type: 'auto' | 'manual' }>
    }>('/api/config/backups')
    return Array.isArray(data?.list) ? data.list : []
  },
  /**
   * 自定义音源管理。**所有操作都必须带当前登录用户名**。
   *
   * 【为什么不能写死 `default` / `open`（这是一次真实事故）】
   * 服务端把音源按用户名归属落盘：`data/users/source/<user>/`。而 `handleList`
   * 里有一句 `(username && username !== 'default')` —— 也就是说：
   *   - 传 `username=default` → **只返回 `_open` 共享源，用户自己的源一个都不返回**；
   *   - 传真实用户名      → 返回 `_open` + 该用户的源（合并去重）。
   * 这里原先固定传 `default`（list）与 `'open'`（增删改），于是拥有 14 个音源的账号
   * 在「设置 → 音源」里看到的是「暂无音源，点右上角导入」，而同一个账号的歌
   * 却能正常播放 —— 因为播放链路走的是 `userAuthHeaders()`（带真实用户名），
   * 只有这个管理页漏了。`userAuthHeaders()` 上面那段注释记的是同一类坑。
   *
   * 附带修掉的一个更隐蔽的问题：写操作原先固定发 `username: 'open'`，
   * 而 `handleToggle` 在 `open` 目录里找不到用户私有源时会直接抛「源不存在」
   * （它只在 targetOwner !== 'open' 时才回退去查 `_open`）。所以就算列表显示出来了，
   * 用户也点不动自己那些源的开关。统一传真实用户名后两条路径才自洽。
   */
  sources: {
    list: () =>
      adminFetchJson<
        Array<{
          id: string
          name: string
          enabled: boolean
          isPublic?: boolean
          owner?: string
          version?: string
          platforms?: string[]
          url?: string
        }>
      >(`/api/custom-source/list?username=${encodeURIComponent(sourceOwner())}`),
    validate: (script: string, allowUnsafeVM = false) =>
      adminFetch('/api/custom-source/validate', {
        method: 'POST',
        body: JSON.stringify({ script, username: sourceOwner(), allowUnsafeVM }),
      }),
    import: (script: string, allowUnsafeVM = false) =>
      adminFetch('/api/custom-source/import', {
        method: 'POST',
        body: JSON.stringify({ script, username: sourceOwner(), allowUnsafeVM }),
      }),
    toggle: (id: string, enabled: boolean) =>
      adminFetch('/api/custom-source/toggle', {
        method: 'POST',
        body: JSON.stringify({ id, enabled, username: sourceOwner() }),
      }),
    delete: (id: string) =>
      adminFetch('/api/custom-source/delete', {
        method: 'POST',
        body: JSON.stringify({ id, username: sourceOwner() }),
      }),
    reorder: (sourceIds: string[]) =>
      adminFetch('/api/custom-source/reorder', {
        method: 'POST',
        body: JSON.stringify({ sourceIds, username: sourceOwner() }),
      }),
  },
  /**
   * 校验本地 token 是否仍有效；顺带拿回 isAdmin 与用户名。
   *
   * 【为什么必须 try/catch，而不是只看 res.ok】
   * 断网（或服务端挂了）时 `fetch` 是**抛异常**（TypeError: Failed to fetch），
   * 不是返回一个 !ok 的响应。原先没包 catch，异常会让这个 promise 永远不 resolve，
   * 于是 `AuthProvider` 的 `loading` 停在 true —— 页面永久卡在「正在连接服务器…」，
   * 既没有错误提示也没有重试入口。PWA 离线场景下这是必然触发的。
   * 这里把「网络不可达」与「token 失效」都归为「未登录」，让界面落到登录页
   * （登录页本身有网络错误提示），而不是无限转圈。
   */
  userVerify: async (): Promise<{ ok: boolean; username: string | null; isAdmin: boolean }> => {
    const token = getUserToken()
    if (!token) return { ok: false, username: null, isAdmin: false }
    try {
      const res = await fetch('/api/user/auth/verify', { headers: { 'x-user-token': token } })
      if (!res.ok) return { ok: false, username: null, isAdmin: false }
      const data = (await res.json()) as { valid?: boolean; username?: string; isAdmin?: boolean }
      if (!data.valid) {
        setUserName('')
        return { ok: false, username: null, isAdmin: false }
      }
      // 用户名要落盘：/api/music/url 的用户鉴权头需要它（见 userAuthHeaders）
      const username = data.username ?? null
      setUserName(username ?? '')
      return { ok: true, username, isAdmin: !!data.isAdmin }
    } catch {
      // 网络不可达：保留本地 token 与用户名（网络恢复后 refresh() 还能救回来），
      // 但本次判定为未登录。
      return { ok: false, username: null, isAdmin: false }
    }
  },
  logoutAll: async () => {
    const token = getUserToken()
    if (token) {
      await fetch('/api/user/logout', { method: 'POST', headers: { 'x-user-token': token } }).catch(() => {})
    }
    setUserToken('')
    setUserName('')
    clearLegacyAdminPassword()
  },
}

const AuthContext = React.createContext<{
  auth: AuthState
  refresh: () => Promise<void>
}>({
  auth: { loading: true, user: { ok: false, username: null, isAdmin: false, checked: false } },
  refresh: async () => {},
})

export function useAuth() {
  return React.useContext(AuthContext)
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = React.useState<AuthState>({
    loading: true,
    user: { ok: false, username: null, isAdmin: false, checked: false },
  })

  const refresh = React.useCallback(async () => {
    const userRes = await api.userVerify()
    setAuth({
      loading: false,
      user: { ok: userRes.ok, username: userRes.username, isAdmin: userRes.isAdmin, checked: true },
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

/** 是否已登录（唯一身份：账号） */
export function isLoggedIn(auth: AuthState): boolean {
  return auth.user.ok
}

/** 是否管理员（决定「设置」入口是否可见） */
export function isAdmin(auth: AuthState): boolean {
  return auth.user.ok && auth.user.isAdmin
}
