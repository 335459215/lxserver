/**
 * 自定义音源「按链接导入」的纯逻辑（v2.44.0 ⑥）。
 *
 * 重点钉住四件事：
 *  1. 只允许 http/https（file:/javascript: 等必须被拒）
 *  2. 回环 / 云元数据地址必须被拒（SSRF），但**私网允许**（自部署场景要能拉局域网脚本）
 *  3. 默认直连；勾选「使用代理」才给 proxyCategory
 *  4. 抓回来的内容不能是空/HTML（链接填成网页时给出能自己修好的提示）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SOURCE_MAX_BYTES,
  SOURCE_BATCH_TOTAL_TIMEOUT_MS,
  SOURCE_IMPORT_ITEM_TIMEOUT_MS,
  addChunkSize,
  basenameFromUrl,
  buildFetchPlan,
  checkDeclaredLength,
  describeTimeout,
  isBlockedHost,
  normalizeSourceContent,
  resolveRedirectUrl,
  validateSourceUrl,
  withTimeout,
} from '../src/server/customSourceUrl.ts'

test('validateSourceUrl 只放行 http/https', () => {
  assert.equal(validateSourceUrl('https://example.com/source.js').ok, true)
  assert.equal(validateSourceUrl('  http://example.com/source.js  ').ok, true)
  for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://x/y.js', 'data:text/html,x', '', '   ']) {
    const r = validateSourceUrl(bad)
    assert.equal(r.ok, false, `应拒绝 ${bad}`)
  }
  assert.equal(validateSourceUrl('not a url').ok, false)
})

test('回环与云元数据地址被拒，普通私网允许', () => {
  for (const host of ['localhost', '127.0.0.1', '169.254.169.254', '::1', 'metadata', 'x.internal']) {
    assert.equal(isBlockedHost(host), true, `应拦截 ${host}`)
  }
  for (const host of ['192.168.1.28', '10.0.0.5', 'example.com', 'raw.githubusercontent.com']) {
    assert.equal(isBlockedHost(host), false, `不应拦截 ${host}`)
  }
  const blocked = validateSourceUrl('http://127.0.0.1:8080/source.js')
  assert.equal(blocked.ok, false)
})

test('默认直连，勾选使用代理才带 customSource 分类', () => {
  assert.equal(buildFetchPlan({ url: 'https://example.com/a.js' }).proxyCategory, null)
  assert.equal(buildFetchPlan({ url: 'https://example.com/a.js', useProxy: false }).proxyCategory, null)
  assert.equal(buildFetchPlan({ url: 'https://example.com/a.js', useProxy: true }).proxyCategory, 'customSource')
  assert.throws(() => buildFetchPlan({ url: 'file:///a.js' }), /http/)
})

test('重定向目标要重新过校验（防止一次跳转绕过协议限制）', () => {
  assert.equal(resolveRedirectUrl('https://example.com/a.js', '/b.js').ok, true)
  assert.equal(resolveRedirectUrl('https://example.com/a.js', 'file:///etc/passwd').ok, false)
  assert.equal(resolveRedirectUrl('https://example.com/a.js', '').ok, false)
})

test('大小上限：Content-Length 提前拦 + 传输中累计拦', () => {
  assert.ok(checkDeclaredLength(String(SOURCE_MAX_BYTES + 1))) // 声明的体量超限 → 直接拒绝
  assert.equal(checkDeclaredLength(String(100), 100), null)
  assert.equal(checkDeclaredLength('', 100), null) // 没有 Content-Length 不算超限
  assert.equal(addChunkSize(0, 50, 100).error, null)
  assert.ok(addChunkSize(90, 20, 100).error)
})

test('内容归一化：拒绝空内容 / HTML 页面，去 BOM', () => {
  assert.equal(normalizeSourceContent('').ok, false)
  assert.equal(normalizeSourceContent('   ').ok, false)
  assert.equal(normalizeSourceContent('<!doctype html><html></html>').ok, false)
  assert.equal(normalizeSourceContent('<html><body>x</body></html>').ok, false)
  const bom = normalizeSourceContent('\ufeff/*! @name test */ lx.send()')
  assert.equal(bom.ok, true)
  assert.equal(bom.ok && bom.content.startsWith('/*!'), true)
})

test('basenameFromUrl 给出可读回退文件名', () => {
  assert.equal(basenameFromUrl('https://example.com/a/b/my-source.js?x=1'), 'my-source.js')
  assert.equal(basenameFromUrl('not-a-url'), '')
})

// ===== v2.49.2 超时（绝对截止时间）=====

test('withTimeout 到点必定 reject，即使内部 Promise 永不 resolve', async () => {
  const started = Date.now()
  await assert.rejects(
    () => withTimeout(new Promise<never>(() => {}), 60),
    /超时/,
  )
  const elapsed = Date.now() - started
  // 必须真的在预算附近返回，不能拖到几百毫秒以上（covers DNS-hang 场景）
  assert.ok(elapsed < 1000, `应在 60ms 级别返回，实际 ${elapsed}ms`)
})

test('withTimeout 内部先完成时正常返回，不受超时影响', async () => {
  const value = await withTimeout(Promise.resolve('ok'), 500)
  assert.equal(value, 'ok')
})

test('withTimeout 透传内部错误（不把真实失败伪装成超时）', async () => {
  await assert.rejects(
    () => withTimeout(Promise.reject(new Error('ECONNREFUSED')), 500),
    /ECONNREFUSED/,
  )
})

test('withTimeout 支持自定义超时文案', async () => {
  await assert.rejects(
    () => withTimeout(new Promise<never>(() => {}), 30, '解析脚本超时（测试）'),
    /解析脚本超时（测试）/,
  )
})

test('超时预算常量：单条 < 整批，且都在可接受范围内', () => {
  assert.ok(SOURCE_IMPORT_ITEM_TIMEOUT_MS > 0)
  assert.ok(SOURCE_BATCH_TOTAL_TIMEOUT_MS > SOURCE_IMPORT_ITEM_TIMEOUT_MS,
    '整批预算必须大于单条，否则第一条就会吃掉全部预算')
  // 90 秒：用户可接受的等待上限；再长就该判超时
  assert.equal(SOURCE_BATCH_TOTAL_TIMEOUT_MS, 90_000)
  assert.equal(SOURCE_IMPORT_ITEM_TIMEOUT_MS, 25_000)
})

test('describeTimeout 文案带上秒数，且能被 describeFetchError 识别为超时', async () => {
  const text = describeTimeout(20_000)
  assert.match(text, /20 秒/)
  assert.match(text, /超时/)
  // 服务端 read ETIMEDOUT / connect ETIMEDOUT 也要映射成「超时」而不是「抓取失败」
  const { describeFetchError } = await import('../src/server/customSourceUrl.ts')
  assert.match(describeFetchError(new Error('read ETIMEDOUT')), /超时/)
  assert.match(describeFetchError(Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' })), /超时/)
  assert.match(describeFetchError(new Error('TIMEOUT: 抓取超时')), /超时/)
})
