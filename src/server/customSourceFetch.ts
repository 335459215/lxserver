/**
 * 自定义音源「按链接导入」的抓取实现（v2.44.0 ⑥）。
 *
 * 【为什么不直接用 fetch / needle】
 * 1. 要**按块累计**判断大小：等下载完再判断，一个误填的大文件链接就能把内存吃满。
 * 2. 要**逐跳校验重定向**：只校验首个 URL，一次 302 就能绕过协议/主机限制。
 * 3. 要**默认强制直连**：NAS 上 customSource 经代理会 ECONNRESET（needle+tunnel），
 *    现网直连可用。只有用户勾选「使用代理」时才挂 agent。
 * 4. 超时必须是**整次抓取**的硬上限，而不是「多久没数据」。
 *
 * 纯判断（URL 白名单、大小上限、内容归一化）在 customSourceUrl.ts，本文件只负责 I/O。
 */
import http from 'node:http'
import https from 'node:https'
import {
    addChunkSize,
    checkDeclaredLength,
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

function requestOnce(target: string, plan: SourceFetchPlan, agent?: unknown): Promise<OnceResult> {
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
        const finish = (fn: () => void) => {
            if (settled) return
            settled = true
            fn()
        }

        const req = mod.get(
            parsed,
            {
                agent: (agent as http.Agent | undefined) ?? undefined,
                headers: {
                    // 不请求压缩：脚本要按 utf-8 原文落盘，解压交给上层反而容易出编码问题
                    'accept-encoding': 'identity',
                    'user-agent': 'lxserver-custom-source/1.0',
                },
                timeout: plan.timeoutMs,
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

        // 整体超时：连接+读取都算在内，超时即销毁（避免对话框一直转圈）
        req.setTimeout(plan.timeoutMs, () => {
            req.destroy(Object.assign(new Error('TIMEOUT: 抓取超时'), { code: 'ETIMEDOUT' }))
        })
        req.on('error', (err) => finish(() => reject(err)))
    })
}

/** 按 plan 抓取脚本内容：逐跳校验重定向、流式限制大小、整体超时。 */
export async function fetchSourceScript(
    plan: SourceFetchPlan,
    options: FetchSourceOptions = {},
): Promise<{ content: string; finalUrl: string; bytes: number }> {
    const seen = new Set<string>()
    let current = plan.url

    for (let hop = 0; hop <= plan.maxRedirects; hop++) {
        if (seen.has(current)) throw new SourceImportError('链接发生重定向循环。')
        seen.add(current)

        const result = await requestOnce(current, plan, options.agent)
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
