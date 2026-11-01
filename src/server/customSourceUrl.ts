/**
 * 自定义音源「按链接导入」的纯逻辑层。
 *
 * 【为什么单独抽一个文件】
 * 「按链接导入」这条链路上真正会出错、也真正会被人改坏的判断只有几类：
 * URL 合不合法、抓回来的东西超没超体量、超没超时、走不走代理、内容是不是空的。
 * 把它们和 http 请求分开，就能直接对拍单测，不必起服务器、也不必碰真网络。
 * 请求本身在 customSourceFetch.ts，本文件不 import 任何 http/fs —— 保持可测。
 */

/** 抓取超时（毫秒）。音源脚本都很小，20 秒足够；再久只会让对话框干等。 */
export const SOURCE_FETCH_TIMEOUT_MS = 20_000

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

    if (/TIMEOUT|ETIMEDOUT|TimeoutError|timed?\s?out|响应超时/i.test(text)) {
        return `抓取超时（超过 ${Math.round(SOURCE_FETCH_TIMEOUT_MS / 1000)} 秒没响应），请检查链接，或勾选「使用代理」后重试。`
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
