import type { IncomingMessage } from 'http'

// ===== 统一鉴权：管理员身份（v2.24.0）=====
//
// 【为什么要有这个模块】
// 此前「管理员」是一把与账号无关的独立钥匙：前端存 frontend.password 明文，
// 每个管理接口拿 `x-frontend-auth === config['frontend.password']` 做比较。
// 于是用户要记两套凭据（部署管理密码 + 同步账号密码），登录页也因此有三个页签
// （管理员 / 用户 / 播放器）。现在统一成「一个账号 + 一个密码」：
//   账号在 config.users 里，其中带 `isAdmin: true` 的账号即管理员。
//
// 【为什么是独立文件而不是写在 server.ts 里】
// customSourceHandlers.ts 也要做同样的判断，而它**被 server.ts 导入**。
// 若它反过来 import server.ts 就构成循环依赖：TS 编译成 CJS 后
// `require('./server')` 在模块加载期拿到的是半成品 exports，函数可能是 undefined，
// 表现为「验证音源时随机 403」。故判断逻辑放在这个不依赖 server.ts 的模块里，
// 「token → 用户名」的校验能力由 server.ts 在启动时**注入**（registerUserTokenVerifier）。
//
// 【向后兼容是刻意保留的，不要删】
// `frontend.password` 仍然有效：外部工具、既有验证脚本（注入 localStorage 的
// `lx.admin.password`）、以及 `<a download>` / SSE 这类只能走 `?auth=` 查询参数的
// 场景都在用它。删掉会让 `verify-*.py` 全线 401。
// 所以判定是「或」关系：老密码 **或** 管理员账号的 token，任一成立即放行。

/** token → 用户名 的校验器；由 server.ts 注入（它持有 userSessions / persistentTokens） */
type UserTokenVerifier = (token: string, req?: IncomingMessage) => string | null
let verifyUserToken: UserTokenVerifier | null = null

/** server.ts 在模块初始化时调用一次 */
export const registerUserTokenVerifier = (fn: UserTokenVerifier): void => {
  verifyUserToken = fn
}

/**
 * 判断某个账号名是否具备管理员身份（v2.24.0 统一登录的核心规则）。
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
 * 管理凭据判定。**签名刻意收成 (credential, req)**，好让全文件 60 多处调用点
 * 只替换右侧表达式（`auth === config['frontend.password']` → `isAdminCredential(auth, req)`），
 * 不必重排每个分支的局部变量——改动越小越不容易漏掉某一处。
 *
 * @param credential `x-frontend-auth` 头的值（部分场景是 `?auth=` 查询参数的值）
 * @param req        当前请求；用于读 `x-user-token`
 */
export const isAdminCredential = (credential: unknown, req: IncomingMessage): boolean => {
  // 1) 旧部署密码（向后兼容，见文件头注释）
  const legacyPassword = global.lx?.config?.['frontend.password']
  if (legacyPassword && typeof credential === 'string' && credential === legacyPassword) return true

  // 2) 管理员账号的 token（新路径：与普通登录同一个凭据）
  if (!verifyUserToken) return false
  const tokens: string[] = []
  const headerToken = req?.headers?.['x-user-token']
  if (typeof headerToken === 'string' && headerToken) tokens.push(headerToken)
  // `?auth=<token>`：给没法自定义请求头的场景（下载直链 / SSE / elFinder）
  if (typeof credential === 'string' && credential) tokens.push(credential)
  for (const token of tokens) {
    const name = verifyUserToken(token, req)
    if (name && isAdminUser(name)) return true
  }
  return false
}
