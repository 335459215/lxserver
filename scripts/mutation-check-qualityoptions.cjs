/** 变异测试：把 v2.28.0「每曲可用档位 / 自动最高档」的关键保护逐个退回错误实现，
 * 确认 test/qualityOptions.test.ts 会失败。
 *
 * 【为什么要做变异测试】
 * 一个在旧代码上也全绿的测试没有验证力。下面每条变异都对应一个**真实会发生**的
 * 错误写法（不是随便改个符号），跑完必须看到「对应用例变红」才算数。
 */
const fs = require('fs')
const { execSync } = require('child_process')

const P = 'web/src/lib/qualityOptions.ts'
const original = fs.readFileSync(P, 'utf8')

const mutations = [
  {
    name: '只认 types，不认歌单的 meta.qualitys（一半曲目看不出可用档位）',
    from: `  const candidates = [
    song.types,
    song.meta?.qualitys,
    song._types,
    song.meta?._qualitys,
  ]`,
    to: `  const candidates = [
    song.types,
  ]`,
    expectFail: ['歌单曲目'],
  },
  {
    name: 'types 是空数组时不回落 meta.qualitys（歌单曲目全部失效）',
    from: `    raw = Array.isArray(c) ? asTierList(c) : asTierMap(c)
    if (raw.length > 0) break`,
    to: `    raw = Array.isArray(c) ? asTierList(c) : asTierMap(c)
    break`,
    expectFail: ['空数组'],
  },
  {
    name: '去掉档位排序（菜单顺序随平台返回漂移）',
    from: `  return [...byType.values()].sort((a, b) => {`,
    to: `  return [...byType.values()].sort((a, b) => 0) || [...byType.values()].sort((a, b) => {`,
    expectFail: ['由低到高'],
  },
  {
    name: '未知档位参与「最高可用」判定（给出选不了的目标）',
    from: `  for (const t of tiers) {
    const r = tierRank(t.type)
    if (r > rank) {`,
    to: `  for (const t of tiers) {
    const r = tierRank(t.type) >= 0 ? tierRank(t.type) : 99
    if (r > rank) {`,
    expectFail: ['冒充最高档'],
  },
  {
    name: '自动最高档**无条件**抬升（本曲只有低档时把首选降下来）',
    from: `  if (rb < 0 || rp < 0) return preferred
  return rb > rp ? best : preferred`,
    to: `  if (rb < 0 || rp < 0) return preferred
  return best`,
    expectFail: ['低于'],
  },
  {
    name: '降级判定用「不等」而非「更低」（升级被误标成降级）',
    from: `  const r = tierRank(resolved)
  const p = tierRank(preferred)
  if (r < 0 || p < 0) return true
  return r < p`,
    to: `  return true`,
    expectFail: ['升级'],
  },
  {
    name: '体积串不做归一（菜单里一行一个样）',
    from: `  const m = /^\\s*([0-9]+(?:\\.[0-9]+)?)\\s*([kKmMgG]?[bB])\\s*$/.exec(size)`,
    to: `  const m = /^\\s*([0-9]+(?:\\.[0-9]+)?)\\s*(MB)\\s*$/.exec(size)`,
    expectFail: ['Mb'],
  },
  {
    name: '扩展名只看档位、不看直链（flac 声明的 mp3 被命名成 .flac）',
    from: `  // 无扩展名的流（多数解析直链）只能按档位推断
  if (!urlSays) {
    return q.includes('flac') || q.includes('hires') || q.includes('24bit') ? 'flac' : 'mp3'
  }
  return urlSays`,
    to: `  return q.includes('flac') || q.includes('hires') || q.includes('24bit') ? 'flac' : 'mp3'`,
    expectFail: ['矛盾'],
  },
  {
    // 这条对应 v2.28.0 开发中真的犯过的错：重写时把 .wav 分支写丢了，
    // 下载的 wav 会被命名成 .mp3。变异后必须有用例变红。
    name: '.wav 分支丢失（重写时漏掉的真实回归）',
    from: `          : path.endsWith('.wav')
            ? 'wav'
            : null`,
    to: `          : null`,
    expectFail: ['wav'],
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
    out = execSync('npx tsx --test test/qualityOptions.test.ts 2>&1', {
      encoding: 'utf8',
      timeout: 120000,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })
  } catch (e) {
    out = String(e.stdout || '') + String(e.stderr || '')
  }
  const failed = /ℹ fail (\d+)/.exec(out)
  const nFail = failed ? Number(failed[1]) : -1
  const caught = m.expectFail.some((k) => out.includes(k))
  console.log(
    `  ${nFail > 0 && caught ? '✓' : '✗'} ${m.name} → fail=${nFail}${caught ? '（命中预期用例）' : '（未命中！）'}`,
  )
  if (!(nFail > 0 && caught)) allGood = false
}

fs.writeFileSync(P, original)
console.log(`\n恢复原文件完成。变异测试${allGood ? '全部通过 —— 测试有真实验证力' : '存在问题'}`)
process.exit(allGood ? 0 : 1)
