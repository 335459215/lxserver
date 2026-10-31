/** 封面地址归一化（HTTPS 混合内容修复，2026-10-31）。
 *
 *  【为什么单独成模块｜零 import】
 *  本文件被 `test/coverHttps.test.ts` 直接 import，跑在裸 node 上。
 *  仓库约定：单测引用的模块不能有 `@/` 别名依赖（tsx 解析不到 web 的 alias），
 *  所以这里**刻意不 import 任何东西**，与 `songIdentity.ts` / `shareCard.ts` 同一套路。
 *  `music.ts` 只做转发，既有调用方（SongList / PlayerBar / 播放内核…）不受影响。
 *
 *  【要解决的问题｜线上实测】
 *  五个平台里 wy / mg / kg 的 `picUrl` 是明文 `http://`：
 *      http://p2.music.126.net/...      （网易云 p1/p2/p3/m8…）
 *      http://d.musicapp.migu.cn/...    （咪咕，.webp）
 *      http://imge.kugou.com/...        （酷狗 imge/singerimg…）
 *  前端把 `picUrl` 直接塞进 `<img src>`，在 HTTPS 页面里产生大片
 *  **Mixed Content** 警告 —— 这才是 Chrome 地址栏「不安全」的真正原因
 *  （反代配置与证书都没问题：Let's Encrypt 通配符、ssl_forced、2027-01 到期）。
 *
 *  【为什么是「升级地址」而不是「服务端代理」】
 *  实测这些 CDN 同时支持 https（同一 path 只换 scheme 仍 200、Content-Type 仍是图片），
 *  所以客户端**直连 CDN 的 https 地址**即可：
 *    - 不走服务端代理 → 每张封面都不吃服务器上行带宽；
 *    - 与既有设计一致 → 音频同样客户端直连，服务端代理（proxy.music）只作兜底。
 *
 *  ⚠️ 只升级**已确认支持 https 的图床域名**，其余原样返回。
 *  乱升级会让「只支持 http 的图床」直接裂图，那比一条警告更糟。 */

const HTTPS_IMAGE_HOSTS = [
  'music.126.net', // 网易云
  'musicapp.migu.cn', // 咪咕
  'kugou.com', // 酷狗（imge / singerimg …）
  'kuwo.cn', // 酷我
  'gtimg.cn', // QQ 音乐（y. / p. / q.）
  'y.qq.com',
]

/** 封面字段的最小形状（`Song` 结构上兼容它，故调用方无需改类型）。 */
export interface CoverSource {
  img?: string
  picUrl?: string
  meta?: { picUrl?: string | null } | null
  album?: { cover?: string } | null
  [key: string]: unknown
}

/** 把已知图床的 http 地址升级成 https（其余一律原样返回，见文件头）。 */
export function secureImageUrl(url?: string | null): string | undefined {
  if (typeof url !== 'string') return undefined
  const trimmed = url.trim()
  if (!trimmed) return undefined
  // 已是 https / 相对路径 / data: / blob: —— 都没问题
  if (!/^http:\/\//i.test(trimmed)) return trimmed
  let host: string
  try {
    host = new URL(trimmed).hostname.toLowerCase()
  } catch {
    return trimmed
  }
  const known = HTTPS_IMAGE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
  return known ? trimmed.replace(/^http:\/\//i, 'https://') : trimmed
}

/** 封面地址：各平台字段名不统一，统一兜底（歌单曲目把封面放在 meta.picUrl）。
 *  产出**一定是 https 或相对路径**，不会把明文 http 漏进 HTTPS 页面。 */
export function coverUrl(song?: CoverSource | null): string | undefined {
  if (!song) return undefined
  const candidates = [song.img, song.picUrl, song.meta?.picUrl, song.album?.cover]
  for (const c of candidates) {
    const safe = secureImageUrl(typeof c === 'string' ? c : undefined)
    if (safe) return safe
  }
  return undefined
}
