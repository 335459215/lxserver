import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { isAdminUser, adminExistsAfterChange, hasExplicitAdmin } from '@/server/adminAuth'

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
