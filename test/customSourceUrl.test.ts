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
  addChunkSize,
  basenameFromUrl,
  buildFetchPlan,
  checkDeclaredLength,
  isBlockedHost,
  normalizeSourceContent,
  resolveRedirectUrl,
  validateSourceUrl,
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
