/** 变异测试：把 D-007 缓存的关键保护逐个退回错误实现，确认测试会失败。 */
const fs = require('fs')
const { execSync } = require('child_process')

const P = 'src/server/staticCache.ts'
const original = fs.readFileSync(P, 'utf8')

const mutations = [
  {
    name: '失效判断只看 key 存在（发版后永远发旧内容）',
    from: `    if (e.mtimeMs !== stat.mtimeMs || e.size !== stat.size) {`,
    to: `    if (false) {`,
    expectFail: ['发版'],
  },
  {
    name: '失效判断只看 size（内容同长时漏掉变更）',
    from: `    if (e.mtimeMs !== stat.mtimeMs || e.size !== stat.size) {`,
    to: `    if (e.size !== stat.size) {`,
    expectFail: ['仅 mtime 变'],
  },
  {
    name: '命中不更新 LRU 顺序（热点被误淘汰）',
    from: `    hits++
    touch(key, e)`,
    to: `    hits++`,
    expectFail: ['最近使用'],
  },
  {
    name: '去掉字节上限（路径穿透可撑爆内存）',
    from: `    while (bytes + incoming > maxBytes && entries.size > 0) {`,
    to: `    while (false) {`,
    expectFail: ['字节上限'],
  },
  {
    name: '去掉 in-flight 去重（并发冷读重复读盘）',
    from: `    const pending = inflight.get(key)
    if (pending) return pending`,
    to: ``,
    expectFail: ['并发冷读'],
  },
  {
    name: '失败也写缓存（一次 IO 错误永久污染）',
    from: `        if (body == null) return null
        return set(key, body, stat)`,
    to: `        if (body == null) return set(key, Buffer.alloc(0), stat)
        return set(key, body, stat)`,
    expectFail: ['读盘失败'],
  },
]

let allGood = true
for (const m of mutations) {
  if (!original.includes(m.from)) {
    console.log(`  ✗ 变异点未找到: ${m.name}`)
    allGood = false
    continue
  }
  fs.writeFileSync(P, original.replace(m.from, m.to))
  let out = ''
  try {
    out = execSync('npx tsx --test test/staticCache.test.ts 2>&1', { encoding: 'utf8', timeout: 120000 })
  } catch (e) {
    out = String(e.stdout || '') + String(e.stderr || '')
  }
  const failed = /ℹ fail (\d+)/.exec(out)
  const nFail = failed ? Number(failed[1]) : -1
  const caught = m.expectFail.some((k) => out.includes(k))
  console.log(`  ${nFail > 0 && caught ? '✓' : '✗'} ${m.name} → fail=${nFail}${caught ? '（命中预期用例）' : '（未命中！）'}`)
  if (!(nFail > 0 && caught)) allGood = false
}

fs.writeFileSync(P, original)
console.log(`\n恢复原文件完成。变异测试${allGood ? '全部通过 —— 测试有真实验证力' : '存在问题'}`)
process.exit(allGood ? 0 : 1)
