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
