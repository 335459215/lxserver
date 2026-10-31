/**
 * 封面混合内容护栏（2026-10-31）
 *
 * 背景：线上 HTTPS 页面里，网易云/咪咕/酷狗的 `picUrl` 是明文 http://，
 * 前端直接把 `picUrl` 塞进 `<img src>` → Chrome 大片 Mixed Content 警告 →
 * 地址栏显示「不安全」。反代与证书都没问题，锅在容器自己的封面地址。
 *
 * 两条不可回退的承诺：
 *   1. 已知图床的 http 一律升级成 https（客户端直连 CDN，不走服务端代理）；
 *   2. 未知域名**原样返回** —— 乱升级会把只支持 http 的图床弄成裂图。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coverUrl, secureImageUrl } from '../web/src/lib/coverUrl.ts'

test('网易云 http 封面升级为 https', () => {
  assert.equal(
    secureImageUrl('http://p2.music.126.net/yD9vbpuILH-tqNRIaP640g==/1.jpg'),
    'https://p2.music.126.net/yD9vbpuILH-tqNRIaP640g==/1.jpg',
  )
})

test('酷狗 / 咪咕 / 酷我 / QQ 的 http 封面都升级', () => {
  for (const [input, expected] of [
    ['http://imge.kugou.com/stdmusic/1.jpg', 'https://imge.kugou.com/stdmusic/1.jpg'],
    ['http://singerimg.kugou.com/uploadpic/1.jpg', 'https://singerimg.kugou.com/uploadpic/1.jpg'],
    ['http://d.musicapp.migu.cn/data/oss/1.webp', 'https://d.musicapp.migu.cn/data/oss/1.webp'],
    ['http://img4.kuwo.cn/star/albumcover/1.jpg', 'https://img4.kuwo.cn/star/albumcover/1.jpg'],
    ['http://y.gtimg.cn/music/photo_new/1.jpg', 'https://y.gtimg.cn/music/photo_new/1.jpg'],
  ]) {
    assert.equal(secureImageUrl(input), expected, input)
  }
})

test('已经是 https 的不动', () => {
  const u = 'https://p1.music.126.net/a/b.jpg'
  assert.equal(secureImageUrl(u), u)
})

test('未知域名保持原样（不擅自升级，避免把只支持 http 的图床弄裂）', () => {
  const u = 'http://weird-cover-host.example.com/x.jpg'
  assert.equal(secureImageUrl(u), u)
})

test('相对路径 / data: / blob: 原样通过', () => {
  for (const u of ['/app/icons/icon-192.png', 'data:image/png;base64,AAA', 'blob:https://x/y']) {
    assert.equal(secureImageUrl(u), u)
  }
})

test('空值一律返回 undefined', () => {
  for (const u of [undefined, null, '', '   ']) {
    assert.equal(secureImageUrl(u as string | undefined | null), undefined)
  }
})

test('coverUrl 会依次兜底 img / picUrl / meta.picUrl，且结果已升级', () => {
  assert.equal(
    coverUrl({ source: 'wy', name: 'x', singer: 'y', meta: { picUrl: 'http://p2.music.126.net/a.jpg' } }),
    'https://p2.music.126.net/a.jpg',
  )
  assert.equal(
    coverUrl({ source: 'wy', name: 'x', singer: 'y', img: 'http://p1.music.126.net/b.jpg' }),
    'https://p1.music.126.net/b.jpg',
  )
  // 第一个候选是空的就继续往下找
  assert.equal(
    coverUrl({ source: 'kg', name: 'x', singer: 'y', img: '', picUrl: 'http://imge.kugou.com/c.jpg' }),
    'https://imge.kugou.com/c.jpg',
  )
})

test('完全没有封面时 coverUrl 返回 undefined（调用方据此画占位图）', () => {
  assert.equal(coverUrl({ source: 'wy', name: 'x', singer: 'y' }), undefined)
  assert.equal(coverUrl(null), undefined)
  assert.equal(coverUrl(undefined), undefined)
})

test('coverUrl 的输出永远不含 http://（本文件存在的全部意义）', () => {
  const urls = [
    { source: 'wy', name: 'a', singer: 's', img: 'http://p2.music.126.net/1.jpg' },
    { source: 'kg', name: 'b', singer: 's', img: 'http://imge.kugou.com/2.jpg' },
    { source: 'mg', name: 'c', singer: 's', meta: { picUrl: 'http://d.musicapp.migu.cn/3.webp' } },
    { source: 'kw', name: 'd', singer: 's', picUrl: 'http://img4.kuwo.cn/4.jpg' },
  ]
  for (const s of urls) {
    const out = coverUrl(s)
    assert.ok(out, `应该有封面：${s.name}`)
    assert.ok(!out.startsWith('http://'), `不得是明文 http：${out}`)
  }
})
