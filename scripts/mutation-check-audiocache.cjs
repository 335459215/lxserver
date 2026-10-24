/** 变异测试：把 audioCache 的 LRU/容量语义退回错误实现，确认单测会失败。
 *
 * 【为什么这几条值得做变异】缓存的错误全是「悄悄发生」型：
 *   ① 淘汰方向反了 → 刚听的歌被挤掉、半年没听的还占着几个 GB
 *   ② 命中不续命 → 「用得最多」的歌反而最先被淘汰
 *   ③ 巨文件照收 → 一首超大 flac 挤掉全部缓存还没存成
 *   ④ 同键覆盖重复计数 → 占用越滚越大、提前误淘汰
 */
const fs = require('fs')
const { execSync } = require('child_process')

const P = 'web/src/lib/audioCache.ts'
const original = fs.readFileSync(P, 'utf8')

const mutations = [
  {
    name: '淘汰方向反了（留最旧、挤最新）',
    from: `.sort((a, b) => a[1].lastUsed - b[1].lastUsed)`,
    to: `.sort((a, b) => b[1].lastUsed - a[1].lastUsed)`,
    expectFail: ['超容量：淘汰最久未用的，保住刚写入的'],
  },
  {
    name: '命中不续命（用得最多的反而先被淘汰）',
    from: `    info.lastUsed = this.now()
    await this.saveMeta()
    return { blob, tier: info.tier, name: info.name }`,
    to: `    await this.saveMeta()
    return { blob, tier: info.tier, name: info.name }`,
    expectFail: ['命中会续命：最久没「用」而不是最久没「写」'],
  },
  {
    name: '巨文件照收（一次注定失败的写入毁掉全部缓存）',
    from: `    if (blob.size > this.cap) return // 单条超过总上限：存了也立刻挤掉别人，不存`,
    to: `    // 变异：不放弃超大文件`,
    expectFail: ['单条超过总容量：放弃写入而不是挤掉全部'],
  },
  {
    name: '同键覆盖重复计数（占用虚增、提前误淘汰）',
    from: `    const prev = this.meta.entries[key]
    let total = this.totalSize() - (prev?.size ?? 0) + blob.size`,
    to: `    let total = this.totalSize() + blob.size`,
    expectFail: ['同键覆盖：当次覆盖不得按旧+新双份计容量（否则误杀别的歌）'],
  },
]

let failed = 0
for (const m of mutations) {
  if (!original.includes(m.from)) {
    console.error(`✗ 变异点已失效（实现改了？请同步更新脚本）: ${m.name}`)
    failed++
    continue
  }
  fs.writeFileSync(P, original.replace(m.from, m.to))
  let out = ''
  try {
    out = execSync('npx tsx --test test/audioCache.test.ts', { encoding: 'utf8' })
  } catch (e) {
    out = e.stdout + e.stderr
  }
  const misses = m.expectFail.filter((name) => !out.includes(`✖ ${name}`) && !out.includes(`✗ ${name}`))
  if (misses.length) {
    failed++
    console.log(`✗ ${m.name} → 预期失败的用例没红: ${misses.join('、')}`)
  } else {
    console.log(`  ✓ ${m.name} → fail=${m.expectFail.length}（命中预期用例）`)
  }
}

fs.writeFileSync(P, original)
if (failed) {
  console.error(`\n${failed} 个变异未被单测捕获，请补测试`)
  process.exit(1)
}
console.log('恢复原文件完成。变异测试全部通过 —— 测试有真实验证力')
