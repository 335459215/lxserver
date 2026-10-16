/** 变异测试：把 searchPaging 的修复逐个退回旧行为，确认测试会失败。 */
const fs = require('fs')
const { execSync } = require('child_process')

const P = 'web/src/lib/searchPaging.ts'
const original = fs.readFileSync(P, 'utf8')

const mutations = [
  {
    name: '去掉代次核对（旧翻页可覆盖新查询）',
    from: `        if (mine !== epoch) return
        // 合并策略：整体重跑去重，而不是按旧长度切「新增部分」。`,
    to: `        // 合并策略：整体重跑去重，而不是按旧长度切「新增部分」。`,
    expectFail: ['旧查询的翻页结果不能覆盖新查询'],
  },
  {
    // 两处赋值的缩进不同（loadFirst 4 空格、loadMore 8 空格），
    // 必须用正则同时替换，否则只改一处、另一处仍然正确 → 测不出东西。
    name: '用去重后条数判断到底（第一页误判 / 整页重复即停）',
    regex: /hasMore = r\.rawHasMore/g,
    to: 'hasMore = r.items.length >= pageSize',
    expectFail: ['整页都是重复', '去重缩页'],
  },
  {
    name: '失败时关闭 hasMore（一次抖动永久停止翻页）',
    from: `        // 失败：不推进页码、不关掉 hasMore（否则一次抖动就永久停止翻页）
        if (mine !== epoch) return
        void e`,
    to: `        if (mine !== epoch) return
        hasMore = false
        void e`,
    expectFail: ['网络错误不当作到底'],
  },
  {
    // single-flight 由两道守卫共同保证（loadingMore 与 inflight），
    // 只拆一道另一道仍然拦住 —— 必须同时拆掉才算真的退回旧行为。
    name: '去掉 single-flight（并发滚动重复请求）',
    from: `    if (loadingMore || !hasMore || !loadedPage) return
    if (inflight) return inflight`,
    to: `    if (!hasMore || !loadedPage) return`,
    expectFail: ['single flight'],
  },
]

let allGood = true
for (const m of mutations) {
  const mutated = m.regex ? original.replace(m.regex, m.to) : original.replace(m.from, m.to)
  if (mutated === original) {
    console.log(`  ✗ 变异点未找到: ${m.name}`)
    allGood = false
    continue
  }
  fs.writeFileSync(P, mutated)
  let out = ''
  try {
    out = execSync('npx tsx --test test/searchPaging.test.ts 2>&1', { encoding: 'utf8' })
  } catch (e) {
    out = String(e.stdout || '') + String(e.stderr || '')
  }
  const failed = /ℹ fail (\d+)/.exec(out)
  const nFail = failed ? Number(failed[1]) : -1
  const caught = m.expectFail.some((k) => out.includes(k))
  console.log(`  ${nFail > 0 && caught ? '✓' : '✗'} ${m.name} → fail=${nFail}${caught ? '（命中预期用例）' : '（未命中预期用例！）'}`)
  if (!(nFail > 0 && caught)) allGood = false
}

fs.writeFileSync(P, original)
console.log(`\n恢复原文件完成。变异测试${allGood ? '全部通过 —— 测试有真实验证力' : '存在问题'}`)
process.exit(allGood ? 0 : 1)
