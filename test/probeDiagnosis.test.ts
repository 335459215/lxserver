/** 音源检测失败原因分类（v2.50.0）。
 *
 *  这些断言守的是「**别把三类问题混成一句『不可用』**」：
 *  作者停服（该删）、本机/线路问题（该重试）、配置问题（该改设置）——
 *  用户看到标签后要做的事完全不同，归错类会直接误导人。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyProbeError } from '../web/src/lib/probeDiagnosis.ts'

test('classifyProbeError：域名解析不到 → 域名失效，且不建议重试', () => {
  for (const raw of [
    'getaddrinfo ENOTFOUND yediemusic.tempmusics.tk',
    'EAI_AGAIN xxx.tempmusics.tk',
    'queryA NXDOMAIN',
  ]) {
    const f = classifyProbeError(raw)
    assert.equal(f.kind, 'dns', raw)
    assert.equal(f.retryable, false, raw)
    assert.ok(f.label.length <= 6, `标签要短: ${f.label}`)
  }
})

test('classifyProbeError：拒连 / 断连 → 无法连接，可重试', () => {
  for (const raw of ['ECONNREFUSED 1.2.3.4:443', 'socket hang up', 'read ECONNRESET']) {
    const f = classifyProbeError(raw)
    assert.equal(f.kind, 'connect', raw)
    assert.equal(f.retryable, true, raw)
  }
})

test('classifyProbeError：超时（中英文都要认）', () => {
  assert.equal(classifyProbeError('检测超时（20 秒）').kind, 'timeout')
  assert.equal(classifyProbeError('request timed out').kind, 'timeout')
  assert.equal(classifyProbeError('ETIMEDOUT').kind, 'timeout')
  assert.equal(classifyProbeError('检测超时（20 秒）').retryable, true)
})

test('classifyProbeError：429/限流 → 被限流（不是「接口报错」）', () => {
  const f = classifyProbeError('upstream responded 429 Too Many Requests')
  assert.equal(f.kind, 'upstream')
  assert.equal(f.retryable, true)
  // 中文限流说法同样要归到这一类
  assert.equal(classifyProbeError('请求过于频繁').kind, 'upstream')
})

test('classifyProbeError：卡密 / 授权失效 → auth，且不标「可重试」', () => {
  for (const raw of ['卡密已过期', '授权失败：密钥无效', 'HTTP 401 unauthorized']) {
    const f = classifyProbeError(raw)
    assert.equal(f.kind, 'auth', raw)
    assert.equal(f.retryable, false, raw)
  }
})

test('classifyProbeError：脚本没加载 / VM 被禁用 → 脚本未运行', () => {
  for (const raw of [
    '该源未加载（启动时加载失败，或已停用）',
    'VM_DISABLED',
    '已禁用VM。该脚本需要原生 VM 模式运行',
  ]) {
    assert.equal(classifyProbeError(raw).kind, 'notLoaded', raw)
  }
})

test('classifyProbeError：跑通但没给链接 → 取链失败', () => {
  assert.equal(classifyProbeError('源没有返回可用的 http(s) 链接').kind, 'badUrl')
})

test('classifyProbeError：普通 5xx → 接口报错', () => {
  assert.equal(classifyProbeError('HTTP 500 Internal Server Error').kind, 'http')
})

test('classifyProbeError：空 / 未知识别 → unknown，但给得出可读建议', () => {
  for (const raw of ['', null, undefined, 'something totally weird happened']) {
    const f = classifyProbeError(raw as string)
    assert.equal(f.kind, 'unknown', String(raw))
    assert.ok(f.reason.length > 0 && f.action.length > 0)
  }
})

test('classifyProbeError：每类都必须给「原因 + 该做什么」', () => {
  const samples = [
    'ENOTFOUND',
    'ECONNREFUSED',
    'timeout',
    '429',
    '卡密过期',
    'VM_DISABLED',
    '没有返回可用',
    'HTTP 500',
    '???',
  ]
  for (const s of samples) {
    const f = classifyProbeError(s)
    assert.ok(f.reason.trim().length >= 8, `原因太短: ${s}`)
    assert.ok(f.action.trim().length >= 6, `建议太短: ${s}`)
    assert.ok(f.label.trim().length > 0 && f.label.length <= 6, `标签不合规: ${f.label}`)
  }
})

test('classifyProbeError：真实线上报错样本（2026-11-10 实测）', () => {
  // 这两条是**真的**从 NAS 上 19 个音源检测里抓到的，不是编的
  const live = {
    '野花🌷': 'getaddrinfo ENOTFOUND flower.tempmusics.tk',
    '野草🌾': 'getaddrinfo ENOTFOUND grass.tempmusics.tk',
    '聚合API接口 (CF)': 'get url failed',
  }
  const got = Object.fromEntries(
    Object.entries(live).map(([name, raw]) => [name, classifyProbeError(raw).kind]),
  )
  assert.deepEqual(got, {
    '野花🌷': 'dns',
    '野草🌾': 'dns',
    '聚合API接口 (CF)': 'badUrl',
  })
})
