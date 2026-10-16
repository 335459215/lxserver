/**
 * probeBounds.test.ts — 证明链接探测是**有界**的：只读响应头，不下载整个 body。
 *
 * 【为什么必须有这个测试】
 * 旧实现 `await needle('get', …)` 要等 body 读完才返回。我们发的是
 * `Range: bytes=0-1`，但很多网关**忽略 Range** 直接回 200 + 完整音频 ——
 * 于是一次「可用性探测」把整首歌下载完。这不是理论问题：每个候选源都要探一次。
 *
 * 测试用一个「忽略 Range、无限吐数据」的本地服务器：如果实现是读完 body 才返回，
 * 它会一直读到超时（并收到远多于几字节的数据）；有界实现则应在响应头到达后
 * 立刻断开，收到的字节数极少。
 *
 * 运行：npx tsx --test test/probeBounds.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { probeUrlBounded } from '../src/server/probeBounded'

/** 起一个忽略 Range、持续吐数据的服务器，返回收到的总字节数与端口 */
function startFirehose(): Promise<{ port: number, bytesSent: () => number, close: () => Promise<void> }> {
  let sent = 0
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'audio/mpeg' })   // 故意不带 Content-Length
    const chunk = Buffer.alloc(64 * 1024, 1)
    const timer = setInterval(() => {
      // 一直吐，直到对端断开
      if (!res.writableEnded) {
        sent += chunk.length
        res.write(chunk)
      }
    }, 1)
    res.on('close', () => clearInterval(timer))
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as any).port
      resolve({
        port,
        bytesSent: () => sent,
        close: () => new Promise<void>((r) => server.close(() => r())),
      })
    })
  })
}

test('忽略 Range 的 200 响应：只读响应头，不下载 body', async () => {
  const srv = await startFirehose()
  try {
    const t0 = Date.now()
    const r = await probeUrlBounded(`http://127.0.0.1:${srv.port}/song.mp3`, { timeoutMs: 2000 })
    const elapsed = Date.now() - t0

    assert.ok(r, '应拿到探测结果')
    assert.equal(r!.status, 200, '应读到 200 状态码')
    // 服务器按 1ms/64KB 吐数据；若实现读完 body，2s 内会收到几十 MB。
    const sent = srv.bytesSent()
    assert.ok(sent < 2 * 1024 * 1024,
      `不应把 body 读完：服务器只应吐出极少数据，实际 ${(sent / 1024 / 1024).toFixed(1)} MiB`)
    assert.ok(elapsed < 1500,
      `拿到响应头就应返回，不该等到超时（实际 ${elapsed}ms）`)
  } finally {
    await srv.close()
  }
})

test('302 重定向：能读到 location', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(302, { Location: 'http://example.test/real.mp3' })
    res.end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const port = (server.address() as any).port
  try {
    const r = await probeUrlBounded(`http://127.0.0.1:${port}/a`, { timeoutMs: 1500 })
    assert.ok(r)
    assert.equal(r!.status, 302)
    assert.equal(r!.location, 'http://example.test/real.mp3')
  } finally {
    await new Promise<void>((r) => server.close(() => r()))
  }
})

test('明确错误码（404）能被读到', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const port = (server.address() as any).port
  try {
    const r = await probeUrlBounded(`http://127.0.0.1:${port}/missing`, { timeoutMs: 1500 })
    assert.ok(r)
    assert.equal(r!.status, 404)
  } finally {
    await new Promise<void>((r) => server.close(() => r()))
  }
})

test('连不上的地址返回 null（交由上层判为「探针拿不到真相」）', async () => {
  // 127.0.0.1 上一个几乎不可能被占用的端口
  const r = await probeUrlBounded('http://127.0.0.1:9/never', { timeoutMs: 800 })
  assert.equal(r, null)
})

test('响应头迟迟不来时按超时返回 null', async () => {
  // 接受连接但永不回响应头
  const server = http.createServer(() => { /* 故意不响应 */ })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const port = (server.address() as any).port
  try {
    const t0 = Date.now()
    const r = await probeUrlBounded(`http://127.0.0.1:${port}/hang`, { timeoutMs: 500 })
    const elapsed = Date.now() - t0
    assert.equal(r, null, '超时应返回 null')
    assert.ok(elapsed < 2000, `应在超时附近返回（实际 ${elapsed}ms）`)
  } finally {
    await new Promise<void>((r) => server.close(() => r()))
  }
})
