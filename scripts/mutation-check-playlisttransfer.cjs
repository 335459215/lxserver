/** 变异测试：把 playlistTransfer 的关键语义退回错误实现，确认单测会失败。
 *
 * 【为什么这几条值得做变异】导入走的是「全量恢复」接口，错了就是删用户数据：
 *   ① 合并丢掉现有歌单 → 用户的自建歌单被导入操作清空
 *   ② 判重键用 id 优先 → 落雪桌面条目与本站条目永远判不了重，歌单越长越臃肿
 *   ③ 同 id 歌单长出新副本而不是并入 → 歌单列表被同名项刷屏
 *   ④ 解析对缺字段的文件静默返回空 → 「导入成功」实际什么都没进来
 */
const fs = require('fs')
const { execSync } = require('child_process')

const P = 'web/src/lib/playlistTransfer.ts'
const original = fs.readFileSync(P, 'utf8')

const mutations = [
  {
    name: '合并丢掉现有歌单（导入操作清空用户数据）',
    from: `  const userList: RawUserList[] = (current.userList ?? []).map((l) => ({ ...l, list: l.list ?? [] }))`,
    to: `  const userList: RawUserList[] = []`,
    expectFail: ['合并：不同 id 追加为新歌单，现有歌单一字不动'],
  },
  {
    name: '判重键 id 优先（落雪条目与本站条目永远判不了重）',
    from: `  const mid = s.songmid ?? s.meta?.songId
  if (mid != null && String(mid) !== '') return \`s:\${s.source}_\${mid}\`
  if (s.id != null && String(s.id) !== '') return \`id:\${s.id}\`
  return \`n:\${s.source}_\${s.name}_\${s.singer ?? ''}\``,
    to: `  if (s.id != null && String(s.id) !== '') return \`id:\${s.id}\`
  const mid = s.songmid ?? s.meta?.songId
  if (mid != null && String(mid) !== '') return \`s:\${s.source}_\${mid}\`
  return \`n:\${s.source}_\${s.name}_\${s.singer ?? ''}\``,
    expectFail: ['合并：无 id 的歌曲回落 自然键（source+songmid+名+歌手）判重'],
  },
  {
    name: '同 id 歌单长出新副本而不是并入',
    from: `    const existing = userList.find((l) => l.id === inc.id)
    if (existing) {`,
    to: `    const existing = undefined
    if (existing) {`,
    expectFail: ['合并：同 id 歌单并入歌曲且按自然键去重（不产生重复）'],
  },
  {
    name: '解析对缺字段的文件静默返回空（导入成功但什么都没进来）',
    from: `  if (!isArr(o.defaultList) || !isArr(o.loveList) || !Array.isArray(o.userList)) {
    throw new PlaylistImportError(\`\${where}缺少 defaultList / loveList / userList 数组字段\`)
  }`,
    to: `  if (!isArr(o.defaultList) || !isArr(o.loveList) || !Array.isArray(o.userList)) {
    return { defaultList: [], loveList: [], userList: [] }
  }`,
    expectFail: ['不是 JSON / 缺字段 / 未知格式 → 抛可读的错误'],
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
    out = execSync('npx tsx --test test/playlistTransfer.test.ts', { encoding: 'utf8' })
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
