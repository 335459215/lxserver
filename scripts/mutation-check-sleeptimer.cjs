/** 变异测试：把 sleepTimer 状态机的关键语义退回错误实现，确认单测会失败。
 *
 * 【为什么这几条值得做变异】
 * 睡眠定时器的错误全都是「悄悄失效 / 悄悄显示错」型，不报错：
 *   ① 播完一首把 after 模式也清掉 → 定了 30 分钟听第 3 首就失效，用户被吵醒
 *   ② remainingMs 允许负数 → 到期后按钮显示 -00:01
 *   ③ 重设 endOfSong 时残留旧 endsAt → 「播完即停」显示不存在的倒计时
 *   ④ 非法分钟数静默当 off → 调用方传错时定时悄悄失效
 *   ⑤ formatRemaining 向下取整 → 59.4s 显示 00:59，看着比实际少一秒
 */
const fs = require('fs')
const { execSync } = require('child_process')

const P = 'web/src/lib/sleepTimer.ts'
const original = fs.readFileSync(P, 'utf8')

const mutations = [
  {
    name: '播完一首把 after 也清掉（跨歌计时失效，用户被吵醒）',
    from: `    case 'songEnded':
      return state.mode === 'endOfSong' ? SLEEP_OFF : state`,
    to: `    case 'songEnded':
      return SLEEP_OFF`,
    expectFail: ['播完一首：after 模式继续计时（跨歌不重置）'],
  },
  {
    name: 'remainingMs 允许负数（到期后显示 -00:01）',
    from: `  return Math.max(0, state.endsAt - now)`,
    to: `  return state.endsAt - now`,
    expectFail: ['remainingMs：正常递减；到期夹到 0（不出负数）'],
  },
  {
    name: '重设 endOfSong 时残留旧 endsAt（显示不存在的倒计时）',
    from: `      return { mode: 'endOfSong', endsAt: null, minutes: 0 }`,
    to: `      return { mode: 'endOfSong', endsAt: state.endsAt, minutes: state.minutes }`,
    expectFail: ['设定「播完当前这首」：endsAt 必须为空（不能残留上一个定时）'],
  },
  {
    name: '非法分钟数静默当 off（定时悄悄失效）',
    from: `        const minutes = Math.max(1, Math.round(action.minutes ?? 1))
        return { mode: 'after', endsAt: action.now + minutes * 60_000, minutes }`,
    to: `        const minutes = Math.round(action.minutes ?? 0)
        if (!(minutes > 0)) return SLEEP_OFF
        return { mode: 'after', endsAt: action.now + minutes * 60_000, minutes }`,
    expectFail: ['非法分钟数按 1 分钟兜底（不能静默当 off）'],
  },
  {
    name: 'formatRemaining 向下取整（59.4s 显示 00:59）',
    from: `  const total = Math.max(0, Math.ceil(ms / 1000))`,
    to: `  const total = Math.max(0, Math.floor(ms / 1000))`,
    expectFail: ['formatRemaining：MM:SS，向上取整秒'],
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
    out = execSync('npx tsx --test test/sleepTimer.test.ts', { encoding: 'utf8' })
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
