import type { IncomingMessage } from 'http'

// ===== 统一鉴权：管理员身份（v2.25.0）=====
//
// 【模型】与 Emby / Jellyfin 同一套：
//   - 网页登录：只有「账号 + 密码」一种方式 → 换取 token；
//   - 那个 token 既是网页会话凭据，也是**外部工具**的凭据（长期令牌由用户在
//     「设置 → 令牌」里生成，供 MCP / 脚本等使用）。
//   没有任何「与账号无关的独立密码」。
//
// 【v2.25.0 删掉了什么】
//   - `frontend.password`（部署管理密码）：整条链路删除，config 里不再有这个键；
//   - `x-frontend-auth` 请求头：整条链路删除，管理接口一律认 `x-user-token`。
//   删之前它们是「管理员钥匙」的两条老路径，与账号体系并行 —— 用户要记两套凭据，
//   且 `frontend.password` 是**明文存 localStorage** 的，本身就是个隐患。
//
// 【为什么是独立文件而不是写在 server.ts 里】
// customSourceHandlers.ts 也要做同样的判断，而它**被 server.ts 导入**。
// 若它反过来 import server.ts 就构成循环依赖：TS 编译成 CJS 后
// `require('./server')` 在模块加载期拿到的是半成品 exports，函数可能是 undefined，
// 表现为「验证音源时随机 403」。故判断逻辑放在这个不依赖 server.ts 的模块里，
// 「token → 用户名」的校验能力由 server.ts 在启动时**注入**（registerUserTokenVerifier）。

/** token → 用户名 的校验器；由 server.ts 注入（它持有 userSessions / persistentTokens） */
type UserTokenVerifier = (token: string, req?: IncomingMessage) => string | null
let verifyUserToken: UserTokenVerifier | null = null

/** server.ts 在模块初始化时调用一次 */
export const registerUserTokenVerifier = (fn: UserTokenVerifier): void => {
  verifyUserToken = fn
}

/**
 * 判断某个账号名是否具备管理员身份。
 *
 * 规则（三条，顺序即优先级）：
 *   1. `isAdmin === true`  → 是管理员；
 *   2. `isAdmin === false` → 不是管理员；
 *   3. **没被标过** → 是「首个账号」才算管理员（兜底）。
 *
 * 第 3 条是防「把自己锁在门外」：老配置里根本没有 isAdmin 字段，
 * 若严格按「没标记就不是管理员」处理，升级后设置中心会直接打不开，
 * 而唯一的自救路径（手改 config.js）对普通用户不友好。
 *
 * 【为什么兜底是按账号算，而不是「没有任何显式管理员时首个账号才是」】
 * 后者踩过坑：一旦把 bob 提为管理员，`显式管理员` 集合就非空了，
 * 于是**首个账号 admin 当场失去权限**——用户只是想「多给一个人权限」，
 * 结果自己被踢出设置页，且界面上没有任何提示。改成按账号算之后：
 *   - 把 bob 设为管理员 → admin（未标记、是首个）与 bob 都是管理员；
 *   - 想取消 admin → 显式给它 isAdmin: false 即可（规则 2 覆盖规则 3）。
 * 语义变成「首个账号默认是管理员，可显式取消」，与用户的直觉一致。
 */
export const isAdminUser = (username: string | null | undefined): boolean => {
  if (!username) return false
  const users: any[] = global.lx?.config?.users ?? []
  if (!Array.isArray(users) || users.length === 0) return false
  const user = users.find((u) => u && u.name === username)
  if (!user) return false
  if (user.isAdmin === true) return true
  if (user.isAdmin === false) return false
  // 未标记：只有首个账号兜底
  return users[0]?.name === username
}

/** 是否有账号被显式标过 isAdmin（前端据此说明「首个账号默认为管理员」） */
export const hasExplicitAdmin = (): boolean => {
  const users: any[] = global.lx?.config?.users ?? []
  return Array.isArray(users) && users.some((u) => u && u.isAdmin !== undefined)
}

/**
 * 在「某个账号的 isAdmin 改成 next」之后，是否仍然存在至少一个管理员。
 *
 * 刻意做成**纯函数式模拟**（不真的改配置再回滚）：回滚路径一旦因为异常没走到，
 * 就会把配置改坏且没人发现。这里只读不写，安全。
 *
 * 供 server.ts 的 PUT /api/users 守卫使用 —— 没有它，用户可以把所有人
 * 降级成普通账号，之后设置中心再也进不去，只能手改 config.js 自救。
 */
export const adminExistsAfterChange = (targetName: string, next: boolean): boolean => {
  const users: any[] = global.lx?.config?.users ?? []
  if (!Array.isArray(users) || users.length === 0) return false
  const after = users.map((u) => (u && u.name === targetName ? { ...u, isAdmin: next } : u))
  return after.some((u) => {
    if (!u) return false
    if (u.isAdmin === true) return true
    if (u.isAdmin === false) return false
    return after[0]?.name === u.name
  })
}

/**
 * 从请求里取「调用者身份」。这是全服务唯一的身份来源。
 *
 * 只认 token，且按**固定顺序**尝试三个位置（顺序有意义：先便宜后昂贵，
 * 且要让「显式传了 token 但无效」与「压根没传」都能正确落到下一种）：
 *   1. `x-user-token` 头 —— 网页与绝大多数 API 调用走这里；
 *   2. `Authorization: Bearer <token>` —— 外部工具/MCP 的标准做法；
 *   3. `?auth=<token>` 查询参数 —— 给没法自定义请求头的场景
 *      （`<a download>` 下载直链、EventSource SSE、elFinder 连接器）。
 *
 * @returns 已验证的账号名；未认证返回 null
 */
export const getRequestUser = (req: IncomingMessage): string | null => {
  if (!verifyUserToken) return null
  for (const token of extractTokens(req)) {
    const name = verifyUserToken(token, req)
    if (name) return name
  }
  return null
}
/**
 * 请求是否来自管理员。
 *
 * `extraCredential` 供少数「token 不在标准位置」的调用点显式传入
 * （历史上是 `?auth=` 的取值；现在多数场景已被 getRequestUser 覆盖，
 * 保留该参数是为了让那些调用点的 diff 最小、不必重排局部变量）。
 */
export const isAdminRequest = (req: IncomingMessage, extraCredential?: unknown): boolean => {
  const name = getRequestUser(req)
  if (name && isAdminUser(name)) return true
  if (typeof extraCredential === 'string' && extraCredential && verifyUserToken) {
    const extraName = verifyUserToken(extraCredential, req)
    if (extraName && isAdminUser(extraName)) return true
  }
  return false
}

/**
 * 按固定顺序收集请求里可能携带的 token（去重、跳过空值）。
 *
 * 导出给 server.ts 的 `verifyUserAuth` 复用 —— 两处必须用**同一套**提取逻辑，
 * 否则会出现「管理接口认 Bearer、听歌接口不认」这种半吊子状态：
 * MCP 客户端能读服务器状态，却一搜索就 401。
 */
export const extractTokens = (req: IncomingMessage): string[] => {
  const out: string[] = []
  const push = (v: unknown) => {
    if (typeof v === 'string' && v && !out.includes(v)) out.push(v)
  }

  push(req?.headers?.['x-user-token'])

  const authz = req?.headers?.['authorization']
  if (typeof authz === 'string') {
    const m = /^Bearer\s+(.+)$/i.exec(authz.trim())
    if (m) push(m[1].trim())
  }

  // ?auth=<token>：req.url 是原始请求行，可能带查询串
  const url = req?.url || ''
  const q = url.indexOf('?')
  if (q >= 0) {
    try {
      const params = new URLSearchParams(url.slice(q + 1))
      push(params.get('auth'))
    } catch {
      /* 畸形查询串：忽略 */
    }
  }

  return out
}
