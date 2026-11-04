/**
 * 播放地址混合内容护栏（2026-11-04）
 *
 * 背景：线上 HTTPS 页面里，各音源解析出的**播放直链**是明文 http://
 * （网易云 m801.music.126.net、酷我 car-er.kuwo.cn、酷狗 fsandroid.tx.kugou.com …）。
 * 前端把直链塞进 `<audio src>` → Chrome Mixed Content → 地址栏显示「不安全」。
 * 反代与证书都没问题，锅在播放地址本身。
 *
 * 实测结论（2026-11-04，15 个 CDN 主机全部双协议 200、Content-Type 一致）：
 *   126.net / kuwo.cn 全系 / kugou.com 全系 / music.163.com / migu.cn /
 *   haitangw.cc / liuyunidc.cn / zddyr.top 都同时支持 https。
 * 所以「升级已知主机」即可，**不做服务端代理兜底**（那会让音频全量走 NAS 上行）。
 *
 * 两条不可回退的承诺（与封面护栏 coverHttps.test.ts 对应）：
 *   1. 已知 CDN 的 http 直链一律升级成 https（客户端直连 CDN，不走服务端代理）；
 *   2. 未知域名**原样返回** —— 乱升级会把只支持 http 的直链弄成不能播。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { secureAudioUrl } from '../web/src/lib/audioUrl.ts'

test('网易云 http 播放直链升级为 https', () => {
  assert.equal(
    secureAudioUrl('http://m801.music.126.net/2f2d/1a2b/3c4d/abc123.mp3'),
    'https://m801.music.126.net/2f2d/1a2b/3c4d/abc123.mp3',
  )
  assert.equal(
    secureAudioUrl('http://m7.music.126.net/2024/01/01/x.mp3'),
    'https://m7.music.126.net/2024/01/01/x.mp3',
  )
})

test('酷我全系 CDN 节点的 http 直链都升级（tx/mg/kg/kw 都会落到 kuwo）', () => {
  for (const [input, expected] of [
    ['http://car-er.kuwo.cn/6362/6aeb/resource/30106/trackmedia/F000.mp3',
     'https://car-er.kuwo.cn/6362/6aeb/resource/30106/trackmedia/F000.mp3'],
    ['http://kw-er.kuwo.cn/5f94/6aeb/resource/1307/trackmedia/F002.f',
     'https://kw-er.kuwo.cn/5f94/6aeb/resource/1307/trackmedia/F002.f'],
    ['http://kw-bj.kuwo.cn/x/y/z.m', 'https://kw-bj.kuwo.cn/x/y/z.m'],
    ['http://bd-lw.kuwo.cn/a/b.c', 'https://bd-lw.kuwo.cn/a/b.c'],
  ]) {
    assert.equal(secureAudioUrl(input), expected, input)
  }
})

test('酷狗 / 咪咕 / QQ 音乐 / 其他已知主机的 http 直链都升级', () => {
  for (const [input, expected] of [
    ['http://fsandroid.tx.kugou.com/1/2.mp3', 'https://fsandroid.tx.kugou.com/1/2.mp3'],
    ['http://fs.youthandroid2.kugou.com/a/b.flac', 'https://fs.youthandroid2.kugou.com/a/b.flac'],
    ['http://freetyst.nf.migu.cn/x.mp3', 'https://freetyst.nf.migu.cn/x.mp3'],
    ['http://y.qq.com/1/2.m4a', 'https://y.qq.com/1/2.m4a'],
    ['http://music.haitangw.cc/song.mp3', 'https://music.haitangw.cc/song.mp3'],
    ['http://api.liuyunidc.cn/a.mp3', 'https://api.liuyunidc.cn/a.mp3'],
    ['http://yy.zddyr.top/b.flac', 'https://yy.zddyr.top/b.flac'],
  ]) {
    assert.equal(secureAudioUrl(input), expected, input)
  }
})

test('主机名大小写/前后空格都归一化（CDN 偶见大写主机名）', () => {
  assert.equal(
    secureAudioUrl('  http://M801.Music.126.NET/a.mp3  '),
    'https://m801.music.126.net/a.mp3',
  )
})

test('已经是 https 的不动', () => {
  const u = 'https://m801.music.126.net/a/b.mp3'
  assert.equal(secureAudioUrl(u), u)
})

test('未知域名保持原样（不擅自升级，避免把只支持 http 的直链弄成不能播）', () => {
  const u = 'http://weird-audio-host.example.com/x.mp3'
  assert.equal(secureAudioUrl(u), u)
})

test('相对路径 / data: / blob: 原样通过', () => {
  for (const u of ['/music/local.mp3', 'data:audio/mp3;base64,AAA', 'blob:https://x/y']) {
    assert.equal(secureAudioUrl(u), u)
  }
})

test('空值一律返回 undefined', () => {
  for (const u of [undefined, null, '', '   ']) {
    assert.equal(secureAudioUrl(u as string | undefined | null), undefined)
  }
})

test('畸形 URL 原样返回（不抛异常）', () => {
  const u = 'http://[bad-url/x.mp3'
  assert.equal(secureAudioUrl(u), u)
})
