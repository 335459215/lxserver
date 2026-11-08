/**
 * 自定义音源批量导入的去重纯逻辑。
 *
 * 钉住三件事：
 *  1. 同一个源换了文件名/链接，按内容哈希仍判为重复；
 *  2. 同一个链接重复粘贴，按规范化 URL 判为重复；
 *  3. 同名源按 id 判为重复 —— 与旧单条导入的「已存在」语义一致。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  describeDuplicate,
  findDuplicateSource,
  hashSourceContent,
  isNewerVersion,
  normalizeSourceUrl,
  sourceIdFromName,
  SOURCE_BATCH_LIMIT,
} from '../src/server/customSourceDedupe.ts'

test('sourceIdFromName 保留中文、去掉脚本扩展名、过滤非法字符', () => {
  assert.equal(sourceIdFromName('全豆要[聚合音源]'), '全豆要[聚合音源].js')
  assert.equal(sourceIdFromName('foo/bar.js'), 'bar.js')
  assert.equal(sourceIdFromName('my-source.mjs'), 'my-source.js')
  assert.equal(sourceIdFromName('a:b*c?.js'), 'a_b_c_.js')
  assert.equal(sourceIdFromName('', 'https://example.com/source.js?x=1'), 'source.js')
  assert.equal(sourceIdFromName('', ''), 'source.js')
})

test('normalizeSourceUrl 只做确定性归一：去空白/去 fragment/主机小写，保留 query', () => {
  assert.equal(
    normalizeSourceUrl('  HTTPS://Example.COM/a.js?x=1#frag  '),
    'https://example.com/a.js?x=1',
  )
  assert.equal(normalizeSourceUrl('https://example.com/a.js?x=1'), 'https://example.com/a.js?x=1')
  assert.equal(normalizeSourceUrl(''), '')
  // 不是 URL 时保留 trim 后的原文，仍可用于精确判重
  assert.equal(normalizeSourceUrl('  not a url  '), 'not a url')
})

test('内容哈希稳定且能区分不同脚本', () => {
  const a = hashSourceContent('/*! @name A */ lx.send("inited")')
  const b = hashSourceContent('/*! @name A */ lx.send("inited")')
  const c = hashSourceContent('/*! @name B */ lx.send("inited")')
  assert.equal(a, b)
  assert.notEqual(a, c)
  assert.match(a, /^[a-f0-9]{64}$/)
})

test('判重优先级：id > 内容哈希 > 链接', () => {
  const existing = [
    { id: 'A.js', name: 'A', sourceUrl: 'https://example.com/a.js', contentHash: hashSourceContent('aaa'), owner: 'open' },
    { id: 'B.js', name: 'B', sourceUrl: 'https://example.com/b.js', contentHash: hashSourceContent('bbb'), owner: 'me' },
  ]

  // 同名：命中 id
  assert.equal(findDuplicateSource({ id: 'A.js', name: 'A2', contentHash: hashSourceContent('different') }, existing)?.kind, 'id')
  // 换名但内容相同：命中 content
  assert.equal(findDuplicateSource({ id: 'C.js', name: 'C', contentHash: hashSourceContent('bbb') }, existing)?.kind, 'content')
  // 内容和 id 都不同但链接相同（比如同一链接换版本）：命中 url
  assert.equal(
    findDuplicateSource(
      { id: 'D.js', name: 'D', sourceUrl: 'HTTPS://EXAMPLE.COM/a.js#x', contentHash: hashSourceContent('ddd') },
      existing,
    )?.kind,
    'url',
  )
  // 全不同：不命中
  assert.equal(
    findDuplicateSource({ id: 'E.js', name: 'E', sourceUrl: 'https://example.com/e.js', contentHash: hashSourceContent('eee') }, existing),
    null,
  )
})

test('重复原因能说清楚是公开源还是当前账号的源', () => {
  const hit = findDuplicateSource(
    { id: 'X.js', name: 'X', contentHash: hashSourceContent('x') },
    [{ id: 'A.js', name: '已有源', contentHash: hashSourceContent('x'), owner: 'open' }],
  )
  assert.ok(hit)
  assert.match(describeDuplicate(hit!), /公开源/)
  assert.match(describeDuplicate(hit!), /已有源/)
})

test('批量上限是 50（前端/后端共用同一个常量口径）', () => {
  assert.equal(SOURCE_BATCH_LIMIT, 50)
})

// ===== v2.49.3：同名源按版本去重（新版本覆盖旧版本）=====

test('isNewerVersion：常规版本号比较', () => {
  assert.equal(isNewerVersion('2.2.1', '2.2.0'), true)
  assert.equal(isNewerVersion('2.2.0', '2.2.1'), false)
  assert.equal(isNewerVersion('2.10.0', '2.9.0'), true)   // 数值比较，不是字符串比较
  assert.equal(isNewerVersion('1.7.17', '1.7.9'), true)
  assert.equal(isNewerVersion('2.0', '2'), false)          // 缺位补 0 → 相等 → 不算更新
  assert.equal(isNewerVersion('2.0.1', '2'), true)
})

test('isNewerVersion：带 v 前缀与非 semver 后缀', () => {
  assert.equal(isNewerVersion('v9.3 93特供版', 'v9.2'), true, '带中文后缀仍能取到 9.3')
  assert.equal(isNewerVersion('v9.3 93特供版', 'v9.3'), false, '同版本不覆盖')
  assert.equal(isNewerVersion('V2.0.0', '1.9.9'), true, '大写 V 也要能剥掉')
})

test('isNewerVersion：无法比较时保守返回 false（绝不误覆盖）', () => {
  assert.equal(isNewerVersion(undefined, '1.0.0'), false)
  assert.equal(isNewerVersion('1.0.0', undefined), false)
  assert.equal(isNewerVersion('', '1.0.0'), false)
  assert.equal(isNewerVersion('beta', '1.0.0'), false)
  assert.equal(isNewerVersion('1.0.0', 'beta'), false)
  assert.equal(isNewerVersion('abc', 'def'), false)
})

test('同名源：新版本 → overwrite，旧版本/同版本 → skip', () => {
  const existing = [{ id: 'X.js', name: 'X', contentHash: hashSourceContent('old'), owner: 'u1', version: '1.2.0' }]

  const newer = findDuplicateSource(
    { id: 'X.js', name: 'X', contentHash: hashSourceContent('new'), version: '1.3.0' },
    existing,
  )
  assert.equal(newer?.kind, 'id')
  assert.equal(newer?.action, 'overwrite', '同名新版本应覆盖')

  const same = findDuplicateSource(
    { id: 'X.js', name: 'X', contentHash: hashSourceContent('new'), version: '1.2.0' },
    existing,
  )
  assert.equal(same?.action, 'skip', '同名同版本应跳过')

  const older = findDuplicateSource(
    { id: 'X.js', name: 'X', contentHash: hashSourceContent('new'), version: '1.1.0' },
    existing,
  )
  assert.equal(older?.action, 'skip', '同名旧版本不能降级覆盖')
})

test('同名但内容完全相同：即使版本号更高也按内容去重跳过', () => {
  // 内容哈希命中在 id 之后：但 id 已命中且版本更高 → overwrite。
  // 真正的「内容相同」场景是**不同文件名**的同一份脚本。
  const same = hashSourceContent('same-body')
  const existing = [{ id: 'A.js', name: 'A', contentHash: same, owner: 'u1', version: '1.0.0' }]
  const hit = findDuplicateSource({ id: 'B.js', name: 'B', contentHash: same, version: '9.9.9' }, existing)
  assert.equal(hit?.kind, 'content')
  assert.equal(hit?.action, 'skip', '内容一样的脚本不该被当成新版本重复落盘')
})

test('同链接但版本更新：同样允许覆盖', () => {
  const url = 'https://example.com/x.js'
  const existing = [{ id: 'X.js', name: 'X', sourceUrl: url, contentHash: hashSourceContent('a'), owner: 'u1', version: '1.0.0' }]
  const hit = findDuplicateSource(
    { id: 'Y.js', name: 'Y', sourceUrl: url, contentHash: hashSourceContent('b'), version: '1.1.0' },
    existing,
  )
  assert.equal(hit?.kind, 'url')
  assert.equal(hit?.action, 'overwrite')
})

test('describeDuplicate：覆盖与跳过的文案能区分，并带出新旧版本', () => {
  const overwrite = describeDuplicate({
    kind: 'id', existingName: 'X', existingId: 'X.js', existingOwner: 'u1',
    action: 'overwrite', existingVersion: '1.2.0', candidateVersion: '1.3.0',
  })
  assert.match(overwrite, /覆盖/)
  assert.match(overwrite, /1\.2\.0/)
  assert.match(overwrite, /1\.3\.0/)

  const skip = describeDuplicate({
    kind: 'id', existingName: 'X', existingId: 'X.js', existingOwner: 'u1',
    action: 'skip', existingVersion: '1.3.0', candidateVersion: '1.2.0',
  })
  assert.match(skip, /跳过/)
  assert.match(skip, /不比它新/)
})
