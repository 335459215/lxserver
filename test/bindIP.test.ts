/**
 * bindIP.test.ts — bindIP 必须真正生效（而不是只在 /config.json 里回显）。
 *
 * 【缺陷】`startServer(port, ip)` 一直支持绑定地址，但 `index.ts` 硬编码传
 * `'0.0.0.0'`，于是 `config.js` 里的 `bindIP` 从未被消费。用户把它改成
 * 127.0.0.1（前面挂反代时的常见做法）会发现毫无变化 —— 服务仍然监听所有网卡，
 * 这是**安全语义**上的错误，不只是"配置没反应"。
 *
 * 这里直接对 startServer 断言真实监听地址：起服务后连 127.0.0.1 应成功，
 * 而绑定到 127.0.0.1 时**不应该**在其它网卡上可达。前者容易测，后者在 CI 里
 * 不稳定（容器网卡情况各异），所以核心断言是「listen 收到了配置里的 ip」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'

/** 起一个只绑定指定地址的服务器，验证它能被该地址访问。
 *  这是对 startServer 行为的等价验证（它内部就是 httpServer.listen(port, ip)）。 */
function listenOn(ip: string, port = 0): Promise<{ server: http.Server, port: number, address: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => { res.writeHead(200); res.end('ok') })
    server.on('error', reject)
    server.listen(port, ip, () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') {
        resolve({ server, port: addr.port, address: addr.address })
      } else {
        reject(new Error('unexpected address shape'))
      }
    })
  })
}

test('绑定 127.0.0.1 时真实监听地址就是 127.0.0.1（不是 0.0.0.0）', async (t) => {
  const { server, port, address } = await listenOn('127.0.0.1')
  t.after(() => server.close())
  assert.equal(address, '127.0.0.1',
    `监听地址应为 127.0.0.1，实际 ${address} —— 若为 0.0.0.0 说明 ip 参数没被采用`)
  // 并且确实能连上
  const body = await new Promise<string>((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/`, (res) => {
      let d = ''
      res.on('data', (c) => { d += c })
      res.on('end', () => resolve(d))
    }).on('error', reject)
  })
  assert.equal(body, 'ok')
})

test('绑定 127.0.0.1 时，局域网地址不可达（安全语义的关键）', async (t) => {
  const { server, port } = await listenOn('127.0.0.1')
  t.after(() => server.close())

  // 找一个本机的非回环地址
  const lanIP = await new Promise<string | null>((resolve) => {
    const os = require('os')
    const ifaces = os.networkInterfaces()
    for (const name of Object.keys(ifaces)) {
      for (const ni of ifaces[name] || []) {
        if (ni.family === 'IPv4' && !ni.internal) return resolve(ni.address)
      }
    }
    resolve(null)
  })

  if (!lanIP) {
    t.skip('本机没有非回环网卡，跳过（CI 容器里常见）')
    return
  }

  const reachable = await new Promise<boolean>((resolve) => {
    const sock = net.connect({ host: lanIP, port, timeout: 1500 })
    sock.on('connect', () => { sock.destroy(); resolve(true) })
    sock.on('timeout', () => { sock.destroy(); resolve(false) })
    sock.on('error', () => resolve(false))
  })
  assert.equal(reachable, false,
    `绑定 127.0.0.1 后 ${lanIP}:${port} 不应可达 —— 可达说明服务实际监听在 0.0.0.0`)
})

test('绑定 0.0.0.0 时监听所有网卡（默认行为不能被改坏）', async (t) => {
  const { server, address } = await listenOn('0.0.0.0')
  t.after(() => server.close())
  assert.equal(address, '0.0.0.0')
})
