/** 有界链接探测（零业务依赖，便于单测直接 import）。
 *
 *  【要解决的问题】
 *  `await needle('get', …)` 的 Promise 形态要**等 body 读完**才 resolve。
 *  我们发的是 `Range: bytes=0-1`，但大量网关/CDN **忽略 Range** 直接回
 *  200 + 完整音频 —— 于是一次「链接可用性探测」把整首歌下载完
 *  （实测本地 fixture 收满 1 MiB 才返回，真实歌曲可达几十 MB）。
 *  每个候选源都要探一次，一次播放可能探十几次，带宽与延迟被白白吃掉。
 *
 *  【做法】
 *  用 needle 的事件式 API 监听 `headers` 事件 —— 它在解析出状态码之后、
 *  读取 body 之前触发。拿到状态码立刻 destroy 请求，body 一个字节都不读。
 *
 *  【返回语义】
 *  - 拿到响应头 → `{ status, location }`
 *  - 超时/连接被重置/其他网络错误 → `null`
 *    注意 `null` 是「**探针拿不到真相**」，不是「链接死了」。调用方必须区分：
 *    很多自定义源返回的 PHP 网关地址对服务端探测直接 RST，对浏览器却完全可播，
 *    把 `null` 判成死链会把能播的歌全部误杀。
 */
import needle from 'needle'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export interface ProbeResult {
  status?: number
  location?: string
}

export async function probeUrlBounded(
  url: string,
  options: { timeoutMs?: number, agent?: unknown } = {},
): Promise<ProbeResult | null> {
  const timeoutMs = options.timeoutMs ?? 1200
  return new Promise((resolve) => {
    let settled = false
    let req: any
    const done = (value: ProbeResult | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // 先 resolve 再断连接，且把 destroy 推到下一个 tick。
      //
      // 【为什么不能同步 destroy】
      // `headers` 事件是在 needle 内部**同一次回调里**触发的，紧接着它就要
      // 建立 body 的 pipe 管线（needle.js 里 emit('headers') 之后立刻
      // pump_streams）。同步 destroy 会让那次 pipe 撞上已销毁的流，
      // 抛 ERR_STREAM_UNABLE_TO_PIPE 把整个请求变成未捕获异常
      // （实测 302 与 404 两个用例都因此崩掉）。
      // 推到下一个 tick 后，needle 已把管线接好，我们再断 —— 此时 body
      // 一个字节都还没被消费。
      setImmediate(() => {
        try { req?.destroy?.() } catch { /* 已经结束 */ }
      })
      resolve(value)
    }
    const timer = setTimeout(() => done(null), timeoutMs)
    try {
      req = needle.get(url, {
        open_timeout: timeoutMs,
        response_timeout: timeoutMs,
        follow_max: 0,
        agent: options.agent as any,
        headers: {
          'User-Agent': UA,
          Referer: new URL(url).origin,
          Range: 'bytes=0-1',
        },
      })
      // 【为什么状态码取自事件参数，不读 req.res.statusCode】
      // `headers` 事件触发时 needle 还没把响应对象挂到 req.res 上（实测读到
      // undefined，导致 302/404 全被判成「拿不到真相」）。needle 在触发前
      // 先 emit('header', statusCode, headers)，这里直接监听它拿状态码。
      req.on('header', (statusCode: number, headers: any) => {
        done({ status: statusCode, location: headers?.location })
      })
      req.on('headers', (headers: any) => {
        // 兜底：万一某些版本不发 'header'，至少把 location 拿到
        if (!settled) done({ status: req.res?.statusCode, location: headers?.location })
      })
      req.on('error', () => done(null))
      req.on('done', () => done(null))
    } catch {
      done(null)
    }
  })
}
