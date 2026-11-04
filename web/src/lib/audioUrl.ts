/** 播放地址混合内容修复（2026-11-04）。
 *
 * 【要解决的问题｜线上实测】
 * 线上页面 `https://lx.131452188.xyz:51739` 证书与反代都没问题，但各音源
 * 解析出的**播放直链是明文 `http://`**：
 *     http://m801.music.126.net/...            （网易云）
 *     http://car-er.kuwo.cn/...                  （酷我 CDN，tx/mg/kg/kw 都会落到它）
 *     http://kw-er.kuwo.cn / kw-bj / kw-lv ...   （酷我其他 CDN 节点）
 *     http://fsandroid.tx.kugou.com/...          （酷狗）
 * 前端把这种地址直接塞进 `<audio src>`，HTTPS 页面里产生 Mixed Content，
 * 地址栏显示「不安全」。**登录页不报警、一点歌就报警**，正是因为登录页
 * 只有本站资源，而播放链接是外部明文直链。
 *
 * 【为什么是「升级地址」而不是「服务端代理」】
 * 与 v2.43.0 修封面（coverUrl.ts）同一套路，且实测结论一致：
 * 这些 CDN **同时支持 https**（同一 path 只换 scheme 仍 200、Content-Type
 * 与字节数完全一致，见 docs/v245-deploy 的探测记录）。所以客户端直连
 * CDN 的 https 地址即可：
 *    - 不走服务端代理 → 音频不吃 NAS 上行带宽（外网远程听尤其关键）；
 *    - 与既有设计一致 → 音频本就客户端直连，服务端代理只作缓存下载兜底。
 *
 * 【已实测支持 https 的主机（2026-11-04，15 个全部双协议 200）】
 *   126.net / kuwo.cn 全系 / kugou.com 全系 / music.163.com /
 *   migu.cn / haitangw.cc / liuyunidc.cn / zddyr.top
 * ⚠️ 只升级**已确认支持 https 的主机**，其余原样返回。
 * 乱升级会让「只支持 http 的直链」直接播放失败，那比一条警告更糟 ——
 * 真遇到这种主机，宁可保持明文（浏览器自动升级/提示）也不该弄成不能播。 */

/** 已确认支持 https 的音频 CDN 主机（与封面白名单互相独立：
 *  音频主机和图片主机是不同的域，覆盖面要宽得多）。 */
const HTTPS_AUDIO_HOSTS = [
  'music.126.net', // 网易云（m7/m8/m701/m801…）
  'kuwo.cn', // 酷我（car-er / kw-er / kw-bj / kw-lv / bd-* …）
  'kugou.com', // 酷狗（fs / fsandroid / youthandroid2 …）
  'music.163.com', // 网易云外链
  'migu.cn', // 咪咕（freetyst.nf.migu.cn …）
  'gtimg.cn', // QQ 音乐（y. / p. / q.）
  'y.qq.com',
  'haitangw.cc', // 海棠（kg 常见）
  'liuyunidc.cn', // 流云 IDC（kw 常见）
  'zddyr.top', // 自定义源常见
]

/** 把已知音频 CDN 的 http 地址升级成 https（其余一律原样返回，见文件头）。
 *
 *  与 `secureImageUrl` 的差别只在白名单：音频主机域更多、变更更频繁，
 *  所以刻意分成两个模块，改音频白名单不会连带影响封面缓存键的语义。 */
export function secureAudioUrl(url?: string | null): string | undefined {
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
  const known = HTTPS_AUDIO_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
  if (!known) return trimmed
  // 顺手把主机名归一成小写：CDN 偶见大写主机名，留着虽然也能解析，
  // 但「同一条歌两次拿到不同大小写地址」会让缓存/日志里出现两条记录。
  return trimmed.replace(/^http:\/\//i, 'https://').replace(/^https:\/\/[^/]+/i, (m) => m.toLowerCase())
}
