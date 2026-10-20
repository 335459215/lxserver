/** 变异测试：把 historyStats 的关键边界逐个退回错误实现，确认单测会失败。
 *
 * 【为什么这几条值得做变异】
 * 「今天/昨天」的三种错误写法都**不报错**，只在特定时刻错：
 *   ① 用「距今 <24h」当今天   → 凌晨看昨晚的歌会被算成今天
 *   ② 用 UTC 日期            → 东八区 08:00 前「今天」显示成昨天
 *   ③ 用 getDate() 相减      → 跨月/跨年时 1 号与 31 号判等
 * 单测已覆盖；这里证明单测**真的会因这些错误而红**（不是摆设）。
 */
const fs = require('fs')
const { execSync } = require('child_process')

const P = 'web/src/lib/historyStats.ts'
const original = fs.readFileSync(P, 'utf8')

const mutations = [
  {
    name: '用「距今 24 小时」当今天（凌晨看昨晚的歌会算成今天）',
    from: `  const a = startOfLocalDay(ts)
  const b = startOfLocalDay(now)
  // 用 Math.round 吸收夏令时导致的 ±1 小时偏移：
  // 有的时区一天是 23 或 25 小时，直接相除会得到 0.958/1.042 这种值。
  return Math.round((b - a) / 86_400_000)`,
    to: `  return Math.floor((now - ts) / 86_400_000)`,
    expectFail: ['跨零点必错'],
  },
  {
    name: '用 UTC 日界（东八区 08:00 前「今天」会变成昨天）',
    from: `  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()`,
    to: `  return Math.floor(ts / 86_400_000) * 86_400_000`,
    expectFail: ['本地 0 点'],
  },
  {
    name: '用 getDate() 相减判日（跨月/跨年时判等）',
    from: `  const a = startOfLocalDay(ts)
  const b = startOfLocalDay(now)
  // 用 Math.round 吸收夏令时导致的 ±1 小时偏移：
  // 有的时区一天是 23 或 25 小时，直接相除会得到 0.958/1.042 这种值。
  return Math.round((b - a) / 86_400_000)`,
    to: `  return new Date(now).getDate() - new Date(ts).getDate()`,
    expectFail: ['跨月与跨年'],
  },
  {
    name: '未来时间直接丢弃（列表最前面会凭空少一条）',
    from: `    if (diff <= 0) {
      // diff < 0 是未来时间，归到今天
      if (diff < 0) future.push(it)
      else today.push(it)
    } else if (diff === 1) yesterday.push(it)`,
    to: `    if (diff < 0) {
      continue
    } else if (diff === 0) today.push(it)
    else if (diff === 1) yesterday.push(it)`,
    expectFail: ['未来时间归入'],
  },
  {
    // 【注意】最初我把变异点选在 `if (diff < 0) return '刚刚'` 这一行，
    // 结果 fail=0 —— 因为删掉它之后 `min` 是负数，紧接着的
    // `if (min < 1) return '刚刚'` 仍然返回「刚刚」，**行为完全等价**。
    // 那不是测试没覆盖，是这个变异本身没有区分力。
    // 换成「负数也照样往下算」，才真正改变行为（会显示"-1 分钟前"之类）。
    name: '未来时间不特判（会显示负的「N 分钟前」）',
    from: `  if (diff < 0) return '刚刚' // 未来时间：时钟偏差，不显示"负几分钟前"
  const min = Math.floor(diff / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return \`\${min} 分钟前\``,
    to: `  const min = Math.floor(diff / 60_000)
  if (min < 60) return \`\${min} 分钟前\``,
    expectFail: ['不出现负数'],
  },
  {
    name: 'playCount 缺失时按 0 计（累计播放会偏小甚至为 NaN）',
    from: `    const n = Number.isFinite(it.playCount) ? Math.max(1, Number(it.playCount)) : 1`,
    to: `    const n = Number(it.playCount) || 0`,
    expectFail: ['playCount 缺失'],
  },
  {
    name: '多歌手串不拆（「周杰伦、费玉清」整串算一个）',
    from: `    for (const name of splitSingers(it.singer)) {
      singerCount.set(name, (singerCount.get(name) ?? 0) + n)
    }`,
    to: `    const name = (it.singer ?? '').trim()
    if (name) singerCount.set(name, (singerCount.get(name) ?? 0) + n)`,
    expectFail: ['多歌手串按每个歌手'],
  },
  {
    name: 'topSinger 并列时取最后一个（结果不稳定）',
    from: `    if (!topSinger || count > topSinger.count) topSinger = { name, count }`,
    to: `    if (!topSinger || count >= topSinger.count) topSinger = { name, count }`,
    expectFail: ['并列取先出现'],
  },
  {
    name: 'days 不去重（覆盖天数会等于条目数）',
    from: `  const days = new Set<number>()`,
    to: `  const days = { size: 0, add() { this.size++ } }`,
    expectFail: ['去重后的自然日数'],
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
    out = execSync('npx tsx --test test/historyStats.test.ts 2>&1', {
      encoding: 'utf8',
      timeout: 180000,
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
