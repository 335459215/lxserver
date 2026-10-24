/** 变异测试：把 searchHistory 的关键语义逐个退回错误实现，确认单测会失败。
 *
 * 【为什么这几条值得做变异】
 * 最近搜索的三个语义错误都「不报错、只是用起来别扭」，Code Review 极易放过：
 *   ① 重复搜索不挪到最前 → 刚搜过的词沉底，要再点得找半天
 *   ② 超上限从头截断 → 把最新的挤掉、留下最旧的（方向反了）
 *   ③ 损坏 JSON 直接抛错 → 一条坏数据让整个搜索页挂掉
 * 单测已覆盖；这里证明单测**真的会因这些错误而红**（不是摆设）。
 */
const fs = require('fs')
const { execSync } = require('child_process')

const P = 'web/src/lib/searchHistory.ts'
const original = fs.readFileSync(P, 'utf8')

const mutations = [
  {
    name: '重复搜索不挪到最前（旧词沉底）',
    from: `  const rest = list.filter((x) => x !== word)
  return [word, ...rest].slice(0, LIMIT)`,
    to: `  if (list.includes(word)) return [...list].slice(0, LIMIT)
  const rest = list.filter((x) => x !== word)
  return [word, ...rest].slice(0, LIMIT)`,
    expectFail: ['重复搜索把旧条目挪到最前（不是保留原位置）'],
  },
  {
    name: '超上限从头截断（挤掉最新的、留下最旧的，方向反了）',
    from: `  return [word, ...rest].slice(0, LIMIT)`,
    to: `  return [word, ...rest].slice(-LIMIT)`,
    expectFail: ['超过上限丢弃最旧的'],
  },
  {
    name: '损坏 JSON 直接抛错（一条坏数据挂掉整个搜索页）',
    from: `  } catch {
    // 损坏的历史不值得报错 —— 清掉重来即可
    return []
  }`,
    to: `  } catch (e) {
    throw new Error('搜索历史损坏: ' + (e && e.message))
  }`,
    expectFail: ['存储里是损坏 JSON 时当作空历史（不抛错）'],
  },
  {
    name: '非字符串项不过滤（渲染时混出 undefined 按钮）',
    from: `    return data.filter((x): x is string => typeof x === 'string').slice(0, LIMIT)`,
    to: `    return data.slice(0, LIMIT).map((x) => String(x))`,
    expectFail: ['存储里被塞了非字符串时只保留字符串项'],
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
    out = execSync('npx tsx --test test/searchHistory.test.ts', { encoding: 'utf8' })
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
