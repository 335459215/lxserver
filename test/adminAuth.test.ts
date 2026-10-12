import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  isAdminUser,
  adminExistsAfterChange,
  hasExplicitAdmin,
  registerUserTokenVerifier,
  extractTokens,
  getRequestUser,
  isAdminRequest,
} from '@/server/adminAuth'

// 管理员判定是 v2.24.0「统一登录」的安全核心：它决定谁能进设置中心。
// 规则（顺序即优先级）：
//   1. isAdmin === true  → 是
//   2. isAdmin === false → 不是
//   3. 未标记           → 只有**首个账号**才是（老配置兜底，防把自己锁在门外）
//
// 这组用例的重点是规则 3 的边界：它曾写成「只要存在显式管理员，兜底就整体失效」，
// 结果是「把 bob 提为管理员」会**顺手把 admin 踢出设置页**（用户只是想多给一个人权限）。
// 故这里把「多管理员共存」「显式取消首个账号」「不许降级最后一人」都钉死。

const setUsers = (users: Array<{ name: string; isAdmin?: boolean }>) => {
  ;(global as any).lx = { config: { users } }
}

beforeEach(() => {
  setUsers([])
})

test('规则 3：无任何标记时，首个账号兜底为管理员', () => {
  setUsers([{ name: 'admin' }, { name: 'bob' }])
  assert.equal(isAdminUser('admin'), true, '首个账号应为管理员（老配置升级后不能锁死）')
  assert.equal(isAdminUser('bob'), false, '非首个账号不应兜底')
  assert.equal(isAdminUser('nobody'), false, '不存在的账号不是管理员')
  assert.equal(isAdminUser(null), false)
  assert.equal(isAdminUser(undefined), false)
  assert.equal(isAdminUser(''), false)
})

test('规则 1：显式 isAdmin: true 直接成立（无论位置）', () => {
  setUsers([{ name: 'admin', isAdmin: false }, { name: 'bob', isAdmin: true }])
  assert.equal(isAdminUser('bob'), true)
  assert.equal(isAdminUser('admin'), false)
})

test('规则 2：显式 isAdmin: false 覆盖首个账号兜底', () => {
  setUsers([{ name: 'admin', isAdmin: false }, { name: 'bob', isAdmin: true }])
  assert.equal(isAdminUser('admin'), false, '显式取消后不应再被兜底成管理员')
})

test('回归：把第二个账号提为管理员，不应踢掉首个账号的权限', () => {
  // 曾经的错误实现：存在显式管理员时兜底整体失效 → admin 当场失去权限
  setUsers([{ name: 'admin' }, { name: 'bob', isAdmin: true }])
  assert.equal(isAdminUser('admin'), true, 'admin 未标记且是首个账号，应仍是管理员')
  assert.equal(isAdminUser('bob'), true, 'bob 是显式管理员')
})

test('首个账号被移到列表后面时，兜底跟着列表首项走', () => {
  setUsers([{ name: 'bob' }, { name: 'admin' }])
  assert.equal(isAdminUser('bob'), true, '兜底看的是列表首项')
  assert.equal(isAdminUser('admin'), false)
})

test('空用户表：谁都不是管理员（不抛异常）', () => {
  setUsers([])
  assert.equal(isAdminUser('admin'), false)
  assert.equal(hasExplicitAdmin(), false)
})

test('hasExplicitAdmin：只看有没有标记，不看真假', () => {
  setUsers([{ name: 'a' }, { name: 'b' }])
  assert.equal(hasExplicitAdmin(), false, '无标记时应为 false')
  setUsers([{ name: 'a', isAdmin: false }])
  assert.equal(hasExplicitAdmin(), true, '显式 false 也算「已做过选择」')
  setUsers([{ name: 'a', isAdmin: true }])
  assert.equal(hasExplicitAdmin(), true)
})

test('adminExistsAfterChange：拒绝降级最后一个管理员', () => {
  setUsers([{ name: 'admin' }, { name: 'bob' }])
  // admin 是兜底管理员，降级后没人管了 → 必须拒绝
  assert.equal(adminExistsAfterChange('admin', false), false)
  // 提权 bob 后，admin 仍可保留（多管理员共存）
  assert.equal(adminExistsAfterChange('bob', true), true)
})

test('adminExistsAfterChange：有第二个管理员时允许降级第一个', () => {
  setUsers([{ name: 'admin' }, { name: 'bob', isAdmin: true }])
  assert.equal(adminExistsAfterChange('admin', false), true, 'bob 仍是管理员，可以降级 admin')
})

test('adminExistsAfterChange：不许把所有人都降级', () => {
  setUsers([{ name: 'admin', isAdmin: true }, { name: 'bob' }])
  assert.equal(adminExistsAfterChange('admin', false), false, '降级唯一的显式管理员应被拒')
  assert.equal(adminExistsAfterChange('bob', true), true)
})

test('adminExistsAfterChange：纯函数，不改动原配置', () => {
  const users = [{ name: 'admin' }, { name: 'bob' }]
  setUsers(users)
  adminExistsAfterChange('admin', false)
  assert.equal(users[0].isAdmin, undefined, '模拟不应写回原对象')
  assert.equal(isAdminUser('admin'), true, '模拟后 admin 应仍是管理员')
})

test('adminExistsAfterChange：空表返回 false', () => {
  setUsers([])
  assert.equal(adminExistsAfterChange('admin', false), false)
  assert.equal(adminExistsAfterChange('admin', true), false)
})

test('用户对象缺失 isAdmin 字段与显式 undefined 等价（都走兜底）', () => {
  setUsers([{ name: 'admin' }, { name: 'bob', isAdmin: undefined }])
  assert.equal(isAdminUser('admin'), true)
  assert.equal(isAdminUser('bob'), false)
})

// ===== v2.25.0：token 提取与请求身份 =====
//
// 这一段钉的是「删掉 x-frontend-auth 之后，token 从哪来」。
// 关键约束：**所有接口必须共用同一套提取逻辑**。
// 曾经踩过：管理接口认 `Authorization: Bearer`，而 verifyUserAuth 只看
// `x-user-token` —— 结果 MCP 客户端能读服务器状态，却一搜索就 401。

/** 造一个最小可用的请求对象（只带 headers 与 url） */
const req = (headers: Record<string, string> = {}, url = '/') =>
  ({ headers, url }) as any

/** 用一个「认识固定几个 token」的假校验器，避免依赖真实的 session/token 存储 */
const FAKE = { tok_admin: 'admin', tok_bob: 'bob' }
const installFakeVerifier = () => {
  registerUserTokenVerifier((token) => FAKE[token as keyof typeof FAKE] ?? null)
}

test('extractTokens：按 x-user-token → Bearer → ?auth= 的顺序收集', () => {
  installFakeVerifier()
  assert.deepEqual(extractTokens(req({ 'x-user-token': 'a' })), ['a'])
  assert.deepEqual(extractTokens(req({ authorization: 'Bearer b' })), ['b'])
  assert.deepEqual(extractTokens(req({}, '/api/x?auth=c')), ['c'])
  // 大小写不敏感（HTTP 头名本身就不区分大小写，值里的 Bearer 也常被写成 bearer）
  assert.deepEqual(extractTokens(req({ authorization: 'bearer d' })), ['d'])
})

test('extractTokens：多种来源同时存在时全部收集且去重', () => {
  installFakeVerifier()
  const t = extractTokens(req({ 'x-user-token': 'a', authorization: 'Bearer b' }, '/x?auth=c'))
  assert.deepEqual(t, ['a', 'b', 'c'])
  // 同一个值出现在两处时只留一份
  const dup = extractTokens(req({ 'x-user-token': 'same', authorization: 'Bearer same' }))
  assert.deepEqual(dup, ['same'])
})

test('extractTokens：畸形/空输入不抛异常', () => {
  installFakeVerifier()
  assert.deepEqual(extractTokens(req({})), [])
  assert.deepEqual(extractTokens(req({ authorization: 'Basic abc' })), [], '非 Bearer 不认')
  assert.deepEqual(extractTokens(req({ authorization: 'Bearer ' })), [], '空 token 不认')
  assert.deepEqual(extractTokens(req({}, '/x?auth=')), [], '空 auth 不认')
  assert.deepEqual(extractTokens({ headers: {}, url: '' } as any), [])
})

test('getRequestUser：三种来源都能认出身份', () => {
  installFakeVerifier()
  assert.equal(getRequestUser(req({ 'x-user-token': 'tok_admin' })), 'admin')
  assert.equal(getRequestUser(req({ authorization: 'Bearer tok_bob' })), 'bob')
  assert.equal(getRequestUser(req({}, '/x?auth=tok_admin')), 'admin')
  assert.equal(getRequestUser(req({ 'x-user-token': 'bogus' })), null)
  assert.equal(getRequestUser(req({})), null)
})

test('getRequestUser：先命中的来源生效（顺序即优先级）', () => {
  installFakeVerifier()
  // 头里是 bob，查询串里是 admin → 应该认 bob（头优先，避免查询串被用来提权）
  assert.equal(getRequestUser(req({ 'x-user-token': 'tok_bob' }, '/x?auth=tok_admin')), 'bob')
})

test('isAdminRequest：只有管理员账号的 token 才算管理员', () => {
  setUsers([{ name: 'admin', isAdmin: true }, { name: 'bob', isAdmin: false }])
  installFakeVerifier()
  assert.equal(isAdminRequest(req({ 'x-user-token': 'tok_admin' })), true)
  assert.equal(isAdminRequest(req({ 'x-user-token': 'tok_bob' })), false, '普通账号不是管理员')
  assert.equal(isAdminRequest(req({ 'x-user-token': 'bogus' })), false)
  assert.equal(isAdminRequest(req({})), false, '无凭据不是管理员')
})

test('isAdminRequest：extraCredential 作为兜底来源（?auth= 的显式传参）', () => {
  setUsers([{ name: 'admin', isAdmin: true }, { name: 'bob', isAdmin: false }])
  installFakeVerifier()
  // 头里没有，靠显式传进来的凭据
  assert.equal(isAdminRequest(req({}), 'tok_admin'), true)
  assert.equal(isAdminRequest(req({}), 'tok_bob'), false)
  assert.equal(isAdminRequest(req({}), ''), false)
  assert.equal(isAdminRequest(req({}), undefined), false)
  // 显式凭据不能覆盖「头里已经是别人」的事实 —— 头优先
  assert.equal(isAdminRequest(req({ 'x-user-token': 'tok_bob' }), 'tok_admin'), true,
    'extraCredential 是「或」关系，任一为管理员即通过')
})

test('isAdminRequest：未注入校验器时一律拒绝（不误放行）', () => {
  setUsers([{ name: 'admin', isAdmin: true }])
  // 直接注入一个「永远认不出」的校验器，模拟「server.ts 尚未 register」的启动早期
  registerUserTokenVerifier(() => null)
  assert.equal(isAdminRequest(req({ 'x-user-token': 'tok_admin' })), false)
  assert.equal(getRequestUser(req({ 'x-user-token': 'tok_admin' })), null)
  installFakeVerifier() // 复原，避免影响后续用例
})
