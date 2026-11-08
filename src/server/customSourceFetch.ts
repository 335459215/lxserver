/**
 * 自定义音源「按链接导入」的抓取实现（v2.44.0 ⑥，v2.49.2 加绝对截止时间）。
 *
 * 【为什么不直接用 fetch / needle】
 * 1. 要**按块累计**判断大小：等下载完再判断，一个误填的大文件链接就能把内存吃满。
 * 2. 要**逐跳校验重定向**：只校验首个 URL，一次 302 就能绕过协议/主机限制。
 * 3. 要**默认强制直连**：NAS 上 customSource 经代理会 ECONNRESET（needle+tunnel），
 *    现网直连可用。只有用户勾选「使用代理」时才挂 agent。
 *
 * 【v2.49.2 关键修复：`req.setTimeout` 不是截止时间】
 * 原实现只写了 `req.setTimeout(20s)`。Node 的这个 API **只在 socket 分配之后**才开始计时：
 *  - DNS 解析阶段（`EAI_AGAIN` / 无响应的 DNS 服务器）**完全不触发**；
 *  - 连接建立后如果每 20 秒内有 1 字节活动，也会被**反复重置**，可以永远等下去；
 *  - 多跳重定向是「每跳一次 requestOnce」，每跳都有自己的 20 秒 —— 10 跳就能拖到 200 秒。
 * 实测线上：NAS 容器访问 `raw.githubusercontent.com` 时请求卡了 34s 才返回
 * `read ETIMEDOUT`（系统级），而 UI 那边一直是「导入中…」。
 *
 * 现在改成**两层硬截止**：
 *  1. `requestOnce` 里 `setTimeout(deadline - now)` 到点直接 `destroy()`，
 *     与 socket 是否建立、有没有数据流都无关；
 *  2. `fetchSourceScript` 在进入任何一跳之前先算好**整次抓取**的截止时间戳，
 *     逐跳把剩余预算传下去 —— 重定向再多也不会累加。
 *
 * 纯判断（URL 白名单、大小上限、内容归一化）在 customSourceUrl.ts，本文件只负责 I/O。
 */
import http from 'node:http'
import https from 'node:https'
import {
    addChunkSize,
    checkDeclaredLength,
    describeTimeout,
    normalizeSourceContent,
    resolveRedirectUrl,
    SourceImportError,
    type SourceFetchPlan,
} from './customSourceUrl'

export interface FetchSourceOptions {
    /** 由 getProxyAgent 返回的 tunnel agent；不传 = 强制直连 */
    agent?: unknown
}

interface OnceResult {
    redirect?: string
    body?: string
    bytes?: number
}

/** 与 describeFetchError 的文案保持一致；超时统一用这个错误码，便于上层识别。 */
const TIMEOUT_CODE = 'ETIMEDOUT'

function timeoutError(ms: number): Error {
    return Object.assign(
        new Error(`TIMEOUT: 抓取超时（超过 ${Math.round(ms / 1000)} 秒没有完成）`),
        { code: TIMEOUT_CODE },
    )
}

/**
 * 单跳请求。`budgetMs` 是**调用方算好的剩余预算**，不是「多久没数据」。
 *
 * 计时器在 `mod.get()` **之前**就挂上，覆盖 DNS + TCP + TLS + 首字节 + 读完整个 body。
 */
function requestOnce(
    target: string,
    plan: SourceFetchPlan,
    budgetMs: number,
    agent?: unknown,
): Promise<OnceResult> {
    return new Promise((resolve, reject) => {
        let parsed: URL
        try {
            parsed = new URL(target)
        } catch {
            reject(new SourceImportError('链接格式不正确。'))
            return
        }
        const mod = parsed.protocol === 'https:' ? https : http
        let settled = false
        let req: http.ClientRequest | undefined

        // 【为什么 kill 里要同时 destroy(req) 与 cancel 定时器】
        // destroy() 会触发 'error' 事件，finish 里已经 settled 会把它吞掉；
        // 但若不 cancel 定时器，Node 会一直把它挂在事件循环上（进程退出前都在）。
        const kill = () => {
            finish(() => reject(timeoutError(plan.timeoutMs)))
            req?.destroy()
        }
        const deadlineTimer = setTimeout(kill, Math.max(1, budgetMs))
        // 不让这个定时器单独把进程吊住（服务端长跑场景）
        if (typeof (deadlineTimer as any).unref === 'function') (deadlineTimer as any).unref()

        const finish = (fn: () => void) => {
            if (settled) return
            settled = true
            clearTimeout(deadlineTimer)
            fn()
        }

        try {
            req = mod.get(
                parsed,
                {
                    agent: (agent as http.Agent | undefined) ?? undefined,
                    headers: {
                        // 不请求压缩：脚本要按 utf-8 原文落盘，解压交给上层反而容易出编码问题
                        'accept-encoding': 'identity',
                        'user-agent': 'lxserver-custom-source/1.0',
                    },
                    // 仍然保留 socket 级超时：它是「连接后长时间零字节」的第一道闸，
                    // 比绝对截止更早触发时能给出更贴近网络的错误。
                    timeout: Math.max(1, budgetMs),
                },
                (res) => {
                    const status = res.statusCode ?? 0
                    if (status >= 300 && status < 400 && res.headers.location) {
                        res.resume()
                        finish(() => resolve({ redirect: String(res.headers.location) }))
                        return
                    }
                    if (status !== 200) {
                        res.resume()
                        finish(() =>
                            reject(
                                new SourceImportError(
                                    `抓取失败：服务器返回 HTTP ${status}，请确认链接指向的是音源脚本本身。`,
                                    400,
                                ),
                            ),
                        )
                        return
                    }
                    const declared = checkDeclaredLength(res.headers['content-length'], plan.maxBytes)
                    if (declared) {
                        res.resume()
                        finish(() => reject(new SourceImportError(declared, 400)))
                        return
                    }

                    const chunks: Buffer[] = []
                    let total = 0
                    res.on('data', (chunk: Buffer) => {
                        const size = addChunkSize(total, chunk.length, plan.maxBytes)
                        if (size.error) {
                            finish(() => reject(new SourceImportError(size.error as string, 400)))
                            res.destroy()
                            return
                        }
                        total = size.total
                        chunks.push(chunk)
                    })
                    res.on('end', () => {
                        finish(() => resolve({ body: Buffer.concat(chunks).toString('utf-8'), bytes: total }))
                    })
                    res.on('error', (err) => finish(() => reject(err)))
                },
            )
        } catch (err) {
            finish(() => reject(err))
            return
        }

        req.on('error', (err) => finish(() => reject(err)))
    })
}

/** 按 plan 抓取脚本内容：逐跳校验重定向、流式限制大小、**整次抓取共用一个截止时间**。 */
export async function fetchSourceScript(
    plan: SourceFetchPlan,
    options: FetchSourceOptions = {},
): Promise<{ content: string; finalUrl: string; bytes: number }> {
    const seen = new Set<string>()
    let current = plan.url
    // 整次抓取的绝对截止时间：重定向跳数**不再**各自拥有独立的超时预算。
    const deadline = Date.now() + plan.timeoutMs

    for (let hop = 0; hop <= plan.maxRedirects; hop++) {
        if (seen.has(current)) throw new SourceImportError('链接发生重定向循环。')
        seen.add(current)

        const remaining = deadline - Date.now()
        if (remaining <= 0) throw new SourceImportError(describeTimeout(plan.timeoutMs))

        const result = await requestOnce(current, plan, remaining, options.agent)
        if (result.redirect) {
            const checked = resolveRedirectUrl(current, result.redirect)
            if (!checked.ok) throw new SourceImportError(checked.error)
            current = checked.url
            continue
        }

        const checked = normalizeSourceContent(result.body)
        if (!checked.ok) throw new SourceImportError(checked.error)
        return { content: checked.content, finalUrl: current, bytes: result.bytes ?? 0 }
    }

    throw new SourceImportError(`重定向次数过多（超过 ${plan.maxRedirects} 次）。`)
}
