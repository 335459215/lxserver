/**
 * d003SelfHeal2.test.ts — D-003 端到端：真实跑 initUserApis，断言 sources.json 不被清空。
 *
 * 前一个测试验证的是「前提与标记」；这个测试验证**最终结果**：
 * 磁盘上的 `sources.json` 里 supportedSources 有没有被覆写成 `[]`。
 *
 * 复现步骤（与用户遇到的完全一致）：
 *  1. 写一个 sources.json，某源声明 supportedSources: ['kw','tx']
 *  2. 放入一个**漏带 sources** 的同名脚本（模拟三参写法 / 写漏）
 *  3. 跑 initUserApis(owner) —— 旧逻辑会在这里把列表清空
 *  4. 读回 sources.json 断言列表还在
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { initUserApis, resetAllSourceBreakers, stopSourceWatcher } from '../src/server/userApi'

function setup(t: any) {
  const oldLx = (global as any).lx
  const oldDataPath = process.env.DATA_PATH
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-d003e2e-'))
  process.env.DATA_PATH = root
  ;(global as any).lx = { config: { 'system.allowUnsafeVM': true, 'debug.enabled': false } }
  t.after(() => {
    // initUserApis 会启动 fs.watch —— 不关掉进程永不退出（测试挂起而非失败）
    stopSourceWatcher()
    resetAllSourceBreakers()
    ;(global as any).lx = oldLx
    if (oldDataPath === undefined) delete process.env.DATA_PATH
    else process.env.DATA_PATH = oldDataPath
    fs.rmSync(root, { recursive: true, force: true })
  })
  return root
}

/** 写一个自定义源（脚本 + sources.json 声明），返回读取 sources.json 的函数 */
function seedSource(root: string, owner: string, id: string, script: string, declared: string[]) {
  const dir = path.join(root, 'users', 'source', owner)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, id), script)
  fs.writeFileSync(
    path.join(dir, 'sources.json'),
    JSON.stringify([
      { id, name: id, version: 1, author: '', description: '', homepage: '', supportedSources: declared, enabled: true },
    ], null, 2),
  )
  return () => {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'sources.json'), 'utf-8'))
    const s = meta.find((x: any) => x.id === id)
    return s?.supportedSources
  }
}

test('D-003 端到端：脚本漏带 sources 时，sources.json 里的声明必须原样保留', { timeout: 25_000 }, async (t) => {
  const root = setup(t)
  const owner = `e2e-${randomUUID()}`
  // 脚本只发 inited、不带 sources（等价于三参写法丢参数）
  const read = seedSource(root, owner, 'silent.js', `lx.send('inited', {});`, ['kw', 'tx'])

  await initUserApis(owner)

  assert.deepEqual(
    read(),
    ['kw', 'tx'],
    '漏带 sources 时绝不能把已保存的支持平台列表清空（这正是 D-003 的危害）',
  )
})

test('D-003 端到端：脚本正常声明时，自愈仍要能更新列表', { timeout: 25_000 }, async (t) => {
  const root = setup(t)
  const owner = `e2e-${randomUUID()}`
  // 声明与实际不符（存的是 kw/tx，脚本实际注册 kw/tx/mg）→ 应被自愈修正
  const read = seedSource(
    root, owner, 'grow.js',
    `lx.send('inited', { sources: { kw: {}, tx: {}, mg: {} } });`,
    ['kw', 'tx'],
  )

  await initUserApis(owner)

  assert.deepEqual(
    read()?.slice().sort(),
    ['kg', 'kw', 'mg', 'tx'].filter((x) => x !== 'kg'),
    '声明与实际不符时自愈应更新为真实列表（别把自愈功能一起关掉）',
  )
})
