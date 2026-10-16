/**
 * d003SelfHeal.test.ts — D-003：自定义源「自愈」会把 sources.json 覆写成空。
 *
 * 【缺陷链条】（台账 D-003，高危）
 * 1. 音源脚本若把 `lx.send` 写成**三参** `lx.send('inited', {sources}, something)`，
 *    或只是忘了在 inited 里带 sources，`registeredSources` 就是空对象。
 * 2. `initResolve()` 仍然会 resolve（它只看有没有收到 'inited' 事件），
 *    于是加载被判定为 `success`。
 * 3. 自愈逻辑比较 `runtimeSources=[]` 与 `storedSources=['kw','tx']`，
 *    发现「不一致」→ 把 `source.supportedSources = []` 并 `needsSave = true`。
 * 4. 落盘：`sources.json` 里该源的 supportedSources 被改写成 `[]`。
 *
 * 用户什么都没做错，源却"坏掉"了，再上传也一样 —— 而且**全程没有任何提示**。
 *
 * 本测试直接跑真实的 loadUserApi，断言：
 *  - 脚本未注册任何源时，**不能**把已存的 supportedSources 覆写成空
 *  - 而正常注册的源，自愈仍要能正确更新（别把功能一起关掉）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { loadUserApi, resetAllSourceBreakers } from '../src/server/userApi'

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

test('D-003：未注册任何源的脚本不得清空已存的 supportedSources', { timeout: 20_000 }, async (t) => {
  const oldLx = (global as any).lx
  const oldDataPath = process.env.DATA_PATH
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-d003-'))
  process.env.DATA_PATH = root
  ;(global as any).lx = { config: { 'system.allowUnsafeVM': true, 'debug.enabled': false } }
  t.after(() => {
    resetAllSourceBreakers()
    ;(global as any).lx = oldLx
    if (oldDataPath === undefined) delete process.env.DATA_PATH
    else process.env.DATA_PATH = oldDataPath
    fs.rmSync(root, { recursive: true, force: true })
  })

  const owner = `d003-${randomUUID()}`

  // 直接调 loadUserApi 观察返回的 info.sources —— 自愈写入 sources.json 的逻辑
  // 在 initUserApis 里，这里先确认「没注册源也算 success 且 info.sources 为空」
  // 这个前提成立（它正是缺陷链条的第 1、2 环）。
  const loaded = await loadUserApi({
    id: 'silent.js',
    owner,
    name: 'silent',
    description: '',
    version: 1,
    author: '',
    homepage: '',
    enabled: true,
    sources: {},
    allowUnsafeVM: false,
    // 只发 inited 事件、不带 sources —— 模拟三参写法或漏带
    script: `lx.send('inited', {});`,
  } as any)

  assert.equal(loaded.success, true, `加载应被判成功（缺陷第 2 环）：${loaded.error}`)
  assert.deepEqual(
    Object.keys(loaded.apiInstance?.info?.sources || {}),
    [],
    '确实注册了 0 个源（缺陷第 1 环）',
  )

  // 关键断言：这种「0 源」结果**不能**被当成权威的 supportedSources。
  // 修复后应有一个显式信号告诉调用方「本次没拿到有效声明」。
  assert.equal(
    (loaded as any).sourcesDeclared,
    false,
    '必须显式标记「本次没有拿到有效 sources 声明」，自愈逻辑据此跳过覆写',
  )
})

test('D-003：正常注册的源仍要标记为已声明（别把自愈功能一起关掉）', { timeout: 20_000 }, async (t) => {
  const oldLx = (global as any).lx
  const oldDataPath = process.env.DATA_PATH
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-d003b-'))
  process.env.DATA_PATH = root
  ;(global as any).lx = { config: { 'system.allowUnsafeVM': true, 'debug.enabled': false } }
  t.after(() => {
    resetAllSourceBreakers()
    ;(global as any).lx = oldLx
    if (oldDataPath === undefined) delete process.env.DATA_PATH
    else process.env.DATA_PATH = oldDataPath
    fs.rmSync(root, { recursive: true, force: true })
  })

  const loaded = await loadUserApi({
    id: 'good.js',
    owner: `d003b-${randomUUID()}`,
    name: 'good',
    description: '',
    version: 1,
    author: '',
    homepage: '',
    enabled: true,
    sources: {},
    allowUnsafeVM: false,
    script: `lx.send('inited', { sources: { kw: {}, tx: {} } });`,
  } as any)

  assert.equal(loaded.success, true, loaded.error)
  assert.deepEqual(
    Object.keys(loaded.apiInstance?.info?.sources || {}).sort(),
    ['kw', 'tx'],
  )
  assert.equal(
    (loaded as any).sourcesDeclared,
    true,
    '正常声明了源时必须标记为已声明，自愈才能继续工作',
  )
})

test('D-003：三参写法要给出可见警告（而不是静默丢配置）', { timeout: 20_000 }, async (t) => {
  const oldLx = (global as any).lx
  const oldDataPath = process.env.DATA_PATH
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-d003c-'))
  process.env.DATA_PATH = root
  ;(global as any).lx = { config: { 'system.allowUnsafeVM': true, 'debug.enabled': false } }
  const warnings: string[] = []
  const origWarn = console.warn
  console.warn = (...args: any[]) => { warnings.push(args.map(String).join(' ')) }
  t.after(() => {
    console.warn = origWarn
    resetAllSourceBreakers()
    ;(global as any).lx = oldLx
    if (oldDataPath === undefined) delete process.env.DATA_PATH
    else process.env.DATA_PATH = oldDataPath
    fs.rmSync(root, { recursive: true, force: true })
  })

  await loadUserApi({
    id: 'three-arg.js',
    owner: `d003c-${randomUUID()}`,
    name: 'three-arg',
    description: '',
    version: 1,
    author: '',
    homepage: '',
    enabled: true,
    sources: {},
    allowUnsafeVM: false,
    // 三参写法：第三参被忽略，sources 拿不到
    script: `lx.send('inited', { sources: { kw: {} } }, { extra: true });`,
  } as any)

  await delay(50)
  const hit = warnings.some((w) => w.includes('send') || w.includes('参数'))
  assert.ok(hit, `三参写法应产生可见警告，实际警告：${JSON.stringify(warnings)}`)
})
