/**
 * 自定义音源「按链接导入」的纯逻辑层。
 *
 * 【为什么单独抽一个文件】
 * 「按链接导入」这条链路上真正会出错、也真正会被人改坏的判断只有几类：
 * URL 合不合法、抓回来的东西超没超体量、超没超时、走不走代理、内容是不是空的。
 * 把它们和 http 请求分开，就能直接对拍单测，不必起服务器、也不必碰真网络。
 * 请求本身在 customSourceFetch.ts，本文件不 import 任何 http/fs —— 保持可测。
 */

/** 抓取超时（毫秒）。音源脚本都很小，20 秒足够；再久只会让对话框干等。
 *
 *  v2.49.2 起这个值同时是**整次抓取的绝对上限**（含所有重定向跳数），
 *  不再按跳累加 —— 见 customSourceFetch.ts 的 deadline 实现。 */
export const SOURCE_FETCH_TIMEOUT_MS = 20_000

/**
 * 单条链接导入的**端到端**上限（毫秒）。
 *
 * 【为什么比抓取超时更长】
 * 一条链接要经过「抓取 → 解析元数据 → 试运行脚本（VM 初始化最多 3s）」三段，
 * 抓取的 20s 只是第一段。这个值给整条链路兜底：任何一段卡住，到点都按超时收口，
 * 不会让界面停在「导入中…」。
 */
export const SOURCE_IMPORT_ITEM_TIMEOUT_MS = 25_000

/**
 * 一次批量导入的**总预算**（毫秒）。
 *
 * 【为什么要单独设】
 * 批量最多 50 条、逐条串行。若每条都吃满 25s，最坏要等 20 分钟 ——
 * 界面会一直转圈，用户以为卡死。这里给整批一个硬上限：到点后**剩余条目**
 * 直接标记为超时未处理，已完成的条目结果照常返回。
 * 取 90s：正常源（每条 1~3s）能跑完 30 条以上，异常批也不会无限等。
 */
export const SOURCE_BATCH_TOTAL_TIMEOUT_MS = 90_000

/**
 * 响应体上限 2MB。
 *
 * 音源脚本正常在几十 KB 量级。设上限是为了挡住「链接填错、指向一个大文件」
 * 的情况 —— 脚本内容最终会被写进服务端 sources 目录，没有上限等于让一个
 * 误填的链接决定服务端的内存占用和磁盘写入量。
 */
export const SOURCE_MAX_BYTES = 2 * 1024 * 1024

/** 重定向跳数上限，与 userApi 里 lx.request 的 follow_max=5 保持一致 */
export const SOURCE_MAX_REDIRECTS = 5

/**
 * 导入类错误：带 HTTP 状态。
 * handler 直接用它决定回 400（用户可修正）还是 500（服务端异常）。
 */
export class SourceImportError extends Error {
    readonly status: number
    constructor(message: string, status = 400) {
        super(message)
        this.name = 'SourceImportError'
        this.status = status
    }
}

export type UrlCheck = { ok: true; url: string } | { ok: false; error: string }
export type ContentCheck = { ok: true; content: string } | { ok: false; error: string }

/** 错误文案里带上原始输入时截断，避免把超长 URL 灌进界面 */
function clip(value: unknown, max = 80): string {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim()
    return text.length > max ? `${text.slice(0, max)}…` : text
}

export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * 是否禁止抓取该主机。
 *
 * 【为什么封回环/链路本地，却**不**封私网（192.168./10./172.16-31.）】
 * 这是自部署的音乐服务，用户完全可能把音源脚本放在自己局域网的另一台机器上
 * （NAS、路由器、开发机）——一刀切封私网会把这种正常用法打死。
 * SSRF 真正危险的是「让服务端去请求它自己」和「去读云厂商元数据」：
 * 前者能绕过防火墙摸到只监听 127.0.0.1 的内部接口，后者能直接拿到实例凭据。
 * 所以这里只封这两类（外加 .internal 这类内部域名）。
 *
 * 这仍然不是完整的 SSRF 防护：域名解析到回环地址（DNS rebinding / 内网域名）
 * 不会被这里拦住 —— 已知残余风险，见交接说明。
 */
export function isBlockedHost(hostname: string): boolean {
    const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '')
    if (!host) return true
    if (host === 'localhost' || host.endsWith('.localhost')) return true
    if (host === 'metadata' || host.endsWith('.internal')) return true
    if (host === '0.0.0.0' || host === '::') return true
    if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true
    if (/^127\./.test(host)) return true
    // 169.254.0.0/16 链路本地，含云元数据地址 169.254.169.254
    if (/^169\.254\./.test(host)) return true
    // IPv4-mapped IPv6，如 ::ffff:127.0.0.1
    const mapped = /^::ffff:(.+)$/.exec(host)
    if (mapped) return isBlockedHost(mapped[1])
    // fe80::/10 链路本地
    if (/^fe[89ab][0-9a-f]:/.test(host)) return true
    return false
}

/**
 * 校验用户填的链接。
 * 只放行 http/https；返回规范化后的 URL（去掉首尾空格、补默认路径）。
 */
export function validateSourceUrl(input: unknown): UrlCheck {
    if (typeof input !== 'string' || !input.trim()) {
        return { ok: false, error: '请先填写音源链接，或选择本地脚本文件。' }
    }
    const raw = input.trim()

    let parsed: URL
    try {
        parsed = new URL(raw)
    } catch {
        return { ok: false, error: `链接格式不正确：${clip(raw)}` }
    }

    const protocol = parsed.protocol.toLowerCase()
    if (protocol !== 'http:' && protocol !== 'https:') {
        const shown = protocol ? protocol.replace(/:$/, '') : '未知'
        return { ok: false, error: `只支持 http/https 链接，当前是「${shown}」协议。` }
    }

    if (!parsed.hostname) {
        return { ok: false, error: '链接缺少主机名。' }
    }

    if (isBlockedHost(parsed.hostname)) {
        return { ok: false, error: `出于安全考虑，不允许抓取本机或元数据地址（${clip(parsed.hostname)}）。` }
    }

    return { ok: true, url: parsed.toString() }
}

/** 重定向目标同样要过一遍白名单校验（否则可以用一次跳转绕过协议/主机限制） */
export function resolveRedirectUrl(base: string, location: unknown): UrlCheck {
    if (typeof location !== 'string' || !location.trim()) {
        return { ok: false, error: '服务器返回了空的重定向地址。' }
    }
    try {
        return validateSourceUrl(new URL(location.trim(), base).toString())
    } catch {
        return { ok: false, error: `重定向地址无效：${clip(location)}` }
    }
}

export function sizeLimitError(maxBytes: number = SOURCE_MAX_BYTES): string {
    return `音源脚本超过大小上限（${formatBytes(maxBytes)}），请确认链接指向的是音源脚本本身。`
}

/**
 * 检查响应头里的 Content-Length。
 * 返回错误文案或 null（null = 没超限 / 头部不可信 / 未提供）。
 * 注意：Content-Length 只是提前拦截，权威判断仍靠累计字节（见 addChunkSize）。
 */
export function checkDeclaredLength(value: unknown, maxBytes: number = SOURCE_MAX_BYTES): string | null {
    if (value === undefined || value === null || value === '') return null
    const n = Number(Array.isArray(value) ? value[0] : value)
    if (!Number.isFinite(n) || n < 0) return null
    if (n > maxBytes) return sizeLimitError(maxBytes)
    return null
}

/** 流式累计响应体，超过上限立即返回错误（不能等下载完再判断） */
export function addChunkSize(
    current: number,
    next: number,
    maxBytes: number = SOURCE_MAX_BYTES,
): { total: number; error: string | null } {
    const total = (Number.isFinite(current) ? current : 0) + (Number.isFinite(next) ? next : 0)
    if (total > maxBytes) return { total, error: sizeLimitError(maxBytes) }
    return { total, error: null }
}

/**
 * 归一化抓取/粘贴来的脚本内容。
 * 三条真实会遇到的失败：拿到的是二进制、内容是空的、拿到的是 HTML 页面
 * （链接填成了仓库网页或 404 页）—— 都要给出能让人自己修好的提示。
 */
export function normalizeSourceContent(raw: unknown): ContentCheck {
    if (typeof raw !== 'string') {
        return { ok: false, error: '抓取到的内容不是文本，无法作为音源脚本导入。' }
    }
    // 去 BOM：脚本管理器下载的 .js 常带 BOM，留着会让 metadata 解析/VM 加载出怪问题
    const content = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
    if (!content.trim()) {
        return { ok: false, error: '获取到的内容是空的，请检查链接是否正确。' }
    }
    const head = content.trimStart().slice(0, 200).toLowerCase()
    if (head.startsWith('<!doctype html') || head.startsWith('<html')) {
        return { ok: false, error: '链接返回的是 HTML 页面而不是音源脚本，请改用脚本的直链地址（raw 链接）。' }
    }
    return { ok: true, content }
}

export interface SourceFetchPlan {
    url: string
    /** 'customSource' = 勾选使用代理；null = 强制直连（不查代理配置、也不看环境变量） */
    proxyCategory: 'customSource' | null
    timeoutMs: number
    maxBytes: number
    maxRedirects: number
}

function positiveOr(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * 由「URL + 是否使用代理」算出这次抓取的全部参数。
 *
 * 【默认直连是硬要求】
 * NAS 上自定义源相关链路经代理会 ECONNRESET（needle+tunnel），现网直连是可用的。
 * 所以只有用户显式勾选才给请求挂 agent；不勾选时连 getProxyAgent 都不调用，
 * 环境变量 HTTPS_PROXY 兜底也不会把这个开关「偷偷打开」。
 */
export function buildFetchPlan(input: {
    url: unknown
    useProxy?: boolean
    timeoutMs?: number
    maxBytes?: number
}): SourceFetchPlan {
    const checked = validateSourceUrl(input.url)
    if (!checked.ok) throw new SourceImportError(checked.error)

    return {
        url: checked.url,
        proxyCategory: input.useProxy ? 'customSource' : null,
        timeoutMs: positiveOr(input.timeoutMs, SOURCE_FETCH_TIMEOUT_MS),
        maxBytes: positiveOr(input.maxBytes, SOURCE_MAX_BYTES),
        maxRedirects: SOURCE_MAX_REDIRECTS,
    }
}

/** 把底层网络错误翻译成用户能照着做的中文提示 */
export function describeFetchError(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err ?? '')
    const code = String((err as { code?: unknown } | null)?.code ?? '')
    const text = `${code} ${raw}`

    if (/TIMEOUT|ETIMEDOUT|TimeoutError|timed?\s?out|响应超时|read\s*ETIMEDOUT|connect\s*ETIMEDOUT/i.test(text)) {
        return `抓取超时（${Math.round(SOURCE_FETCH_TIMEOUT_MS / 1000)} 秒内没有拿到脚本），请检查链接是否可访问，或勾选「使用代理」后重试。`
    }
    if (/ENOTFOUND|EAI_AGAIN/i.test(text)) {
        return '域名解析失败，请检查链接地址是否正确。'
    }
    if (/ECONNRESET|ECONNREFUSED|EPIPE|socket hang up/i.test(text)) {
        return '连接被对方重置或拒绝，可尝试勾选「使用代理」后重试。'
    }
    if (/certificate|EPROTO|SSL|TLS/i.test(text)) {
        return 'HTTPS 证书校验失败，无法安全抓取该链接。'
    }
    if (/proxy|ERR_HTTP_PROXY/i.test(text)) {
        return `代理请求失败：${clip(raw)}`
    }
    return raw ? `抓取失败：${clip(raw)}` : '抓取失败：未知错误。'
}

/** 超时文案统一从这里出，避免三处各写一份、措辞与秒数不一致。 */
export function describeTimeout(timeoutMs: number): string {
    const seconds = Math.round(timeoutMs / 1000)
    return `抓取超时（${seconds} 秒内没有拿到脚本），请检查链接是否可访问，或勾选「使用代理」后重试。`
}

/**
 * 单条预算被整批预算压缩时的文案。
 *
 * 【为什么需要单独一条】批量导入里每条的可等时间 = min(单条 25s, 整批剩余)。
 * 若直接复述那个被压缩后的秒数，用户会看到「10 秒内没有拿到脚本」这种
 * 与「单条 25 秒」自相矛盾的提示，也看不出真正原因是**整批快到期了**。
 */
export function describeBatchBudgetExhausted(totalTimeoutMs: number, remainingMs: number): string {
    const left = Math.max(0, Math.round(remainingMs / 1000))
    return `抓取超时（整批已接近 ${Math.round(totalTimeoutMs / 1000)} 秒上限，本条只剩 ${left} 秒）` +
        '，请减少一次导入的链接数量后重试。'
}

/**
 * 给任意 Promise 套一层**绝对截止时间**。
 *
 * 【为什么不能只依赖内部超时】
 * 内部超时（socket / VM init）各自只覆盖自己那一段。一条链路上只要有任何一个
 * 环节没有超时（DNS 挂起、上游 Promise 永不 resolve、第三方库卡住），
 * 整条请求就会一直挂着、界面永远「导入中…」。
 * 这个包装是**最后一道闸**：无论内部怎么实现，到点一定 reject。
 *
 * 注意：它只保证「调用方不被吊死」，不会中断底层 I/O —— 底层自己也有超时，
 * 两者叠加才不会泄漏连接。
 */
export function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message?: string,
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        let settled = false
        const timer = setTimeout(() => {
            if (settled) return
            settled = true
            reject(new SourceImportError(message ?? describeTimeout(timeoutMs)))
        }, Math.max(1, timeoutMs))
        // 不让这个定时器单独把进程吊住
        if (typeof (timer as { unref?: () => void }).unref === 'function') timer.unref()

        promise.then(
            (value) => {
                if (settled) return
                settled = true
                clearTimeout(timer)
                resolve(value)
            },
            (err) => {
                if (settled) return
                settled = true
                clearTimeout(timer)
                reject(err)
            },
        )
    })
}

/** 从 URL 里取一个可读的回退文件名（没有 @name 元数据时用它命名音源） */
export function basenameFromUrl(url: string): string {
    try {
        const pathname = new URL(url).pathname
        const last = pathname.split('/').filter(Boolean).pop() || ''
        let decoded = last
        try {
            decoded = decodeURIComponent(last)
        } catch {
            // 保留未解码的原始片段
        }
        return decoded.replace(/[?#].*$/, '')
    } catch {
        return ''
    }
}
