/** 变异测试：把 shareCard 纯逻辑的关键语义退回错误实现，确认单测会失败。
 *
 * 【为什么这几条值得做变异】卡片是「给人看的图」，错了不报错、只是难看/难懂：
 *   ① 截断不加省略号 → 歌名被无声截掉，用户看不出被截
 *   ② 空白歌词照样上卡 → 一张只有一对空引号的卡片
 *   ③ 非法主色不回落 → canvas 渐变吃到坏色值直接抛错，卡片整个生成不了
 */
const fs = require('fs')
const { execSync } = require('child_process')

const P = 'web/src/lib/shareCard.ts'
const original = fs.readFileSync(P, 'utf8')

const mutations = [
  {
    name: '截断不加省略号（歌名被无声截掉）',
    from: `        lines.pop()
        let tail = ''
        for (let j = 0; j < chars.length; j++) {
          const candidate = tail + chars[j] + '…'
          if (measure(candidate) > maxWidth) break
          tail += chars[j]
        }
        lines.push(tail + '…')
        return lines`,
    to: `        lines.push(cur)
        return lines`,
    expectFail: ['wrapText：超出最大行数 → 末行加省略号'],
  },
  {
    name: '空白歌词照样上卡（一对空引号）',
    from: `  const lyric = (lyricLine ?? '').trim()`,
    to: `  const lyric = lyricLine ?? ''`,
    expectFail: ['buildShareCardData：字段兜底（歌手空/歌名空/歌词空白不上卡）'],
  },
  {
    name: '非法主色不回落（canvas 渐变吃到坏色值抛错）',
    from: `    accent: /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : '#6366f1',`,
    to: `    accent,`,
    expectFail: ['buildShareCardData：非法主色回落默认靛蓝（画布渐变不吃坏色值）'],
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
    out = execSync('npx tsx --test test/shareCard.test.ts', { encoding: 'utf8' })
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
