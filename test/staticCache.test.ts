/**
 * staticCache.test.ts — D-007 静态资源缓存。
 *
 * 这类缓存翻车几乎都在三处，测试就针对这三点：
 *  1. 无界 → 路径来自 HTTP 请求，攻击者能撑爆内存（穿透）
 *  2. 发版后不失效 → 同名文件内容变了却永远发旧内容
 *  3. 压缩表示混淆 → 把 .gz 字节当原文发出去（白屏/乱码，只在特定 Accept-Encoding 复现）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStaticCache } from '../src/server/staticCache'

const stat = (mtimeMs = 1000, size = 10) => ({ mtimeMs, size })

test('D-007：同一文件第二次直接命中缓存，不再读盘', () => {
  const c = createStaticCache()
  let loads = 0
  const loader = async () => { loads++; return Buffer.from('hello') }

  return (async () => {
    const a = await c.load('/x.js', stat(), loader)
    const b = await c.load('/x.js', stat(), loader)
    assert.equal(loads, 1, '只应读盘一次')
    assert.equal(a?.body.toString(), 'hello')
    assert.equal(b?.body.toString(), 'hello')
    assert.equal(c.stats().hits, 1)
    assert.equal(c.stats().misses, 1)
  })()
})

test('D-007：文件变了（发版）必须失效，不能继续发旧内容', () => {
  const c = createStaticCache()
  let version = 'v1'
  const loader = async () => Buffer.from(version)

  return (async () => {
    assert.equal((await c.load('/app.js', stat(1000, 2), loader))?.body.toString(), 'v1')
    // 模拟镜像更新：同名文件，内容与 mtime/size 都变了
    version = 'v2'
    const second = await c.load('/app.js', stat(2000, 2), loader)
    assert.equal(second?.body.toString(), 'v2', '内容变了必须重新读，否则永远发旧版本')
    assert.equal(c.stats().invalidations, 1, '应记录一次失效')
  })()
})

test('D-007：仅 mtime 变（内容碰巧同长）也要失效', () => {
  const c = createStaticCache()
  let version = 'aa'
  const loader = async () => Buffer.from(version)
  return (async () => {
    await c.load('/a.js', stat(1000, 2), loader)
    version = 'bb'
    // size 相同、只有 mtime 变 —— 只看 size 的实现会漏掉这种情况
    const r = await c.load('/a.js', stat(1500, 2), loader)
    assert.equal(r?.body.toString(), 'bb')
  })()
})

test('D-007：压缩表示与原文必须分开缓存（键要带编码变体）', () => {
  const c = createStaticCache()
  return (async () => {
    // 用不同 key 模拟调用方的编码变体约定
    const raw = await c.load('/app.js', stat(), async () => Buffer.from('PLAIN'))
    const gz = await c.load('/app.js::gzip', stat(), async () => Buffer.from('GZIPPED'))
    assert.equal(raw?.body.toString(), 'PLAIN')
    assert.equal(gz?.body.toString(), 'GZIPPED')
    assert.equal(c.stats().entries, 2, '两份表示必须是两个条目')
  })()
})

test('D-007：条目数上限会淘汰最久未用的', () => {
  const c = createStaticCache({ maxEntries: 2 })
  const mk = (n: number) => async () => Buffer.from(String(n))
  return (async () => {
    await c.load('/a', stat(), mk(1))
    await c.load('/b', stat(), mk(2))
    await c.load('/c', stat(), mk(3)) // 触发淘汰 /a
    assert.equal(c.has('/a'), false, '/a 应被淘汰')
    assert.equal(c.has('/b'), true)
    assert.equal(c.has('/c'), true)
    assert.ok(c.stats().evictions >= 1)
  })()
})

test('D-007：命中会把条目移到最近使用，不被优先淘汰', () => {
  const c = createStaticCache({ maxEntries: 2 })
  const mk = (n: number) => async () => Buffer.from(String(n))
  return (async () => {
    await c.load('/a', stat(), mk(1))
    await c.load('/b', stat(), mk(2))
    await c.load('/a', stat(), mk(1)) // 命中 /a → /a 变成最近使用
    await c.load('/c', stat(), mk(3)) // 应淘汰 /b 而不是 /a
    assert.equal(c.has('/a'), true, '刚命中过的 /a 不该被淘汰')
    assert.equal(c.has('/b'), false, '/b 才是最久未用')
  })()
})

test('D-007：字节上限会淘汰（防路径穿透撑爆内存）', () => {
  const c = createStaticCache({ maxBytes: 500, maxEntries: 1000 })
  return (async () => {
    // 每个约 200B 内容 + 键开销 → 只放得下两个左右
    for (let i = 0; i < 20; i++) {
      await c.load(`/f${i}`, stat(), async () => Buffer.alloc(200, i))
    }
    const s = c.stats()
    assert.ok(s.bytes <= 500, `占用必须受上限约束，实际 ${s.bytes}`)
    assert.ok(s.entries < 20, '必须发生过淘汰')
  })()
})

test('D-007：超大单文件不进缓存（别把热点挤掉）', () => {
  const c = createStaticCache({ maxEntryBytes: 100 })
  return (async () => {
    const r = await c.load('/big.exe', stat(), async () => Buffer.alloc(500))
    assert.equal(r, null, '超过单条目上限应返回 null（调用方直接发字节，不缓存）')
    assert.equal(c.stats().entries, 0, '不应留下条目')
  })()
})

test('D-007：并发冷读同一文件只读盘一次（in-flight 去重）', () => {
  const c = createStaticCache()
  let loads = 0
  const loader = async () => {
    loads++
    await new Promise((r) => setTimeout(r, 30))
    return Buffer.from('shared')
  }
  return (async () => {
    const results = await Promise.all([
      c.load('/hot.js', stat(), loader),
      c.load('/hot.js', stat(), loader),
      c.load('/hot.js', stat(), loader),
      c.load('/hot.js', stat(), loader),
    ])
    assert.equal(loads, 1, '4 个并发冷请求只应读盘 1 次')
    assert.ok(results.every((r) => r?.body.toString() === 'shared'))
  })()
})

test('D-007：读盘失败不写缓存，下次仍会重试', () => {
  const c = createStaticCache()
  let attempt = 0
  const loader = async () => {
    attempt++
    if (attempt === 1) throw new Error('EIO')
    return Buffer.from('ok')
  }
  return (async () => {
    await assert.rejects(() => c.load('/flaky', stat(), loader))
    assert.equal(c.stats().entries, 0, '失败不应留下条目')
    const r = await c.load('/flaky', stat(), loader)
    assert.equal(r?.body.toString(), 'ok', '第二次应能成功')
  })()
})

test('D-007：loader 返回 null 时不缓存（文件不存在，防穿透）', () => {
  const c = createStaticCache()
  let calls = 0
  const loader = async () => { calls++; return null }
  return (async () => {
    await c.load('/missing', stat(), loader)
    await c.load('/missing', stat(), loader)
    assert.equal(c.stats().entries, 0, '不存在的文件不能进缓存')
    assert.equal(calls, 2, '每次都要重新判断（不存在的东西不该被记住）')
  })()
})

test('D-007：clear() 清空并归零占用', () => {
  const c = createStaticCache()
  return (async () => {
    await c.load('/a', stat(), async () => Buffer.from('x'))
    assert.ok(c.stats().entries > 0)
    c.clear()
    const s = c.stats()
    assert.equal(s.entries, 0)
    assert.equal(s.bytes, 0)
  })()
})
