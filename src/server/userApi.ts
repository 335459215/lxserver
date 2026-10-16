import { VM } from 'vm2'
import * as fs from 'fs'
import * as path from 'path'

import needle from 'needle'
import * as crypto from 'crypto'
import * as zlib from 'zlib'
import { promisify } from 'util'

import { AsyncLocalStorage } from 'async_hooks'
import { getProxyAgent } from '../modules/utils/proxy.js'
import { debugLog } from '@/server/utils/debugLog'
import { createSourceHealth } from './sourceHealth'
import { isSourceAbort, observeSourceAbort, runSourceRequest, sourceAbortError, waitForSourceDelay } from './sourceRequest'
import type { SourceSignal } from './sourceRequest'
const inflate = promisify(zlib.inflate)
const deflate = promisify(zlib.deflate)

// 彻底切断与沙箱上下文的联系
function decontextify(obj: any): any {
    if (obj === null || obj === undefined) return obj

    // 非对象直接返回
    if (typeof obj !== 'object') return obj

    // 处理 Buffer (极其重要：使用 Uint8Array 中转以切断 Proxy 链)
    try {
        if (Buffer.isBuffer(obj) || obj instanceof Uint8Array || (obj && obj.constructor && obj.constructor.name === 'Buffer')) {
            return Buffer.from(Uint8Array.from(obj as any))
        }
    } catch (e) { }

    // 处理数组
    if (Array.isArray(obj)) {
        try {
            return obj.map(item => decontextify(item))
        } catch (e) {
            return []
        }
    }

    // 处理 Error (增加对沙箱内 Error 的识别)
    if (obj instanceof Error || (obj && obj.constructor && obj.constructor.name === 'Error')) {
        const err = new Error(obj.message)
        err.stack = obj.stack
        return err
    }

    // 处理普通对象 (预防 Proxy Traps)
    try {
        const newObj: any = {}
        const keys = Object.keys(obj)
        for (const key of keys) {
            try {
                newObj[key] = decontextify(obj[key])
            } catch (e) { }
        }
        return newObj
    } catch (e) {
        try {
            const str = JSON.stringify(obj)
            return str ? JSON.parse(str) : String(obj)
        } catch (e2) {
            return String(obj)
        }
    }
}

// 用户API信息接口
interface UserApiInfo {
    id: string
    name: string
    description: string
    version: number | string
    author: string
    homepage: string
    script: string
    sources: Record<string, any>
    enabled: boolean
    owner: string // 'open' or username
    allowUnsafeVM?: boolean
}

export interface ApiStatusInfo {
    status: 'success' | 'failed'
    error?: string
    updateAlert?: {
        name?: string
        log?: string
        updateUrl?: string
    }
}

// 加载的 API 实例
const loadedApis = new Map<string, any>()

// API 初始化状态追踪 map<id, status>
const apiStatus = new Map<string, ApiStatusInfo>()

/** 返回已成功加载的 API 源数量，用于状态展示与健康检查。 */
export function getLoadedApisCount() {
    return loadedApis.size
}

export function getApiStatus(owner: string, id: string): ApiStatusInfo | undefined {
    return apiStatus.get(`${owner}_${id}`)
}


// 从脚本注释中提取元数据
export function extractMetadata(script: string): Partial<UserApiInfo> {
    const meta: any = {}

    // 匹配 JSDoc 风格的注释 (支持 /*! 和 /**)
    const commentMatch = script.match(/\/\*[*!]([\s\S]*?)\*\//)
    if (commentMatch) {
        const comment = commentMatch[1]

        // @name
        const nameMatch = comment.match(/@name\s+(.+)/)
        if (nameMatch) meta.name = nameMatch[1].trim()

        // @description
        const descMatch = comment.match(/@description\s+(.+)/)
        if (descMatch) meta.description = descMatch[1].trim()

        // @version
        const verMatch = comment.match(/@version\s+(.+)/)
        if (verMatch) meta.version = verMatch[1].trim()

        // @author
        const authorMatch = comment.match(/@author\s+(.+)/)
        if (authorMatch) meta.author = authorMatch[1].trim()

        // @repository or @homepage
        const repoMatch = comment.match(/@(?:repository|homepage)\s+(.+)/)
        if (repoMatch) meta.homepage = repoMatch[1].trim()
    }

    return meta
}

// Async-local ownership also follows lx.request calls made after awaits inside a VM handler.
const sourceRequestContext = new AsyncLocalStorage<AbortSignal>()

// 创建 lx.request 包装器（使用 needle）
async function createLxRequest(isUnsafe: boolean = false, onSniffUpdate?: (alert: { name?: string, log?: string, updateUrl?: string }) => void) {
    // 自定义音源脚本调用 lx.request 是同步的，无法在调用时 await，
    // 因此这里预先按 http/https 各建一个 agent，调用时按目标协议取用。
    // 走 customSource 分类的独立开关（未配置时沿用 proxy.all.*）。
    const agentHttps = await getProxyAgent('https://lx-proxy-probe.invalid', 'customSource')
    const agentHttp = agentHttps ? await getProxyAgent('http://lx-proxy-probe.invalid', 'customSource') : undefined

    return (url: string, options: any, callback: Function) => {
        const safeOptions = decontextify(options || {})
        const { method = 'get', timeout, headers, body, form, formData } = safeOptions
        const timeoutMs = typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0
            ? Math.min(timeout, 60_000) : 10_000
        const controller = new AbortController()
        const detach = observeSourceAbort(sourceRequestContext.getStore(), () => controller.abort())
        const requestOptions: any = {
            headers,
            follow_max: 5,
            open_timeout: timeoutMs,
            response_timeout: timeoutMs,
            read_timeout: timeoutMs
        }
        if (agentHttps && /^https:/i.test(String(url))) requestOptions.agent = agentHttps
        else if (agentHttp) requestOptions.agent = agentHttp

        let data = body
        if (form || formData) {
            data = form || formData
            requestOptions.json = false
        }

        // Needle's response timeout ends at headers. This independent deadline ends only
        // when its callback has consumed the entire body (including redirect bodies).
        const pending = runSourceRequest<{ resp: any, body: any }>(() => {
            let request: any
            const promise = new Promise((resolve, reject) => {
                request = needle.request(method, url, data, requestOptions, (err: any, resp: any, body: any) => {
                    if (err) reject(err)
                    else resolve({ resp, body })
                })
            })
            return { promise, cancel: () => request?.abort() }
        }, { timeoutMs, signal: controller.signal })

        const deliver = (error: any, response: any, body: any) => {
            try { callback.call(null, error, response, body) }
            catch (error: any) { console.error('[自定义源] lx.request 回调异常:', error?.message) }
        }
        void pending.then(({ resp, body }) => {
            let safeResp: any
            try {
                let parsedBody = body
                if (typeof body === 'string') {
                    try { parsedBody = JSON.parse(body) } catch {}
                }
                if (onSniffUpdate && parsedBody && typeof parsedBody === 'object') {
                    const targetData = parsedBody.data || parsedBody
                    const updateMsg = targetData.updateMsg || targetData.log || targetData.updateLog || targetData.msg
                    const updateUrl = targetData.updateUrl || targetData.url || targetData.downloadUrl
                    if (updateMsg && (updateUrl || typeof updateMsg === 'string' && updateMsg.includes('更新'))) {
                        onSniffUpdate({ log: String(updateMsg), updateUrl: updateUrl ? String(updateUrl) : '' })
                    }
                }
                safeResp = {
                    statusCode: resp.statusCode,
                    statusMessage: resp.statusMessage,
                    headers: resp.headers,
                    body: decontextify(parsedBody)
                }
                if (isUnsafe) {
                    safeResp = JSON.parse(JSON.stringify({
                        statusCode: resp.statusCode, statusMessage: resp.statusMessage, headers: resp.headers
                    }))
                    safeResp.body = typeof parsedBody === 'object' && !Buffer.isBuffer(parsedBody)
                        ? JSON.parse(JSON.stringify(parsedBody)) : parsedBody
                }
            } catch (error) {
                deliver(decontextify(error), null, null)
                return
            }
            deliver(null, safeResp, safeResp.body)
        }, error => deliver(decontextify(error), null, null)).finally(detach)

        return () => controller.abort()
    }
}

// 加载自定义源脚本
// opts.persist=false 时不把实例登记进 loadedApis（校验/试运行等一次性用途），
// 否则这些临时 VM 会永久驻留：initUserApi 的清理只匹配 owner===targetUser，
// 而校验用的是 owner:'temp'，永远匹配不上，VM 与上下文会随每次上传/导入无限累积。
export async function loadUserApi(apiInfo: UserApiInfo, opts?: { persist?: boolean }): Promise<any> {
    const persist = opts?.persist !== false
    if (persist) sourceHealth.reset(apiInfo.id, apiInfo.owner)
    // 从脚本中提取元数据
    const metadata = extractMetadata(apiInfo.script)
    const fullApiInfo = { ...apiInfo, ...metadata }

    // 创建事件处理映射
    const eventHandlers = new Map<string, Function>()
    let registeredSources: any = {}
    /** 本次加载是否**真的收到了** sources 声明（D-003）。
     *
     *  【为什么需要这个标记】
     *  `lx.send('inited', {})`（漏带 sources）或三参写法
     *  `lx.send('inited', {sources}, extra)` 都会让 registeredSources 保持空对象，
     *  但 initResolve 照样 resolve —— 加载被判 success、info.sources 为空。
     *  上层自愈逻辑拿这个「空」当权威结果，会把 sources.json 里已存的
     *  supportedSources 覆写成 `[]`，用户什么都没做错源却坏掉，且无任何提示。
     *  有了这个标记，上层才能区分「脚本声明了 0 个源」与「压根没拿到声明」。 */
    let sourcesDeclared = false

    // ========== 关键修改：提前创建 initPromise ==========
    let initResolve: (() => void) | null = null
    let initReject: ((err: Error) => void) | null = null
    const initPromise = new Promise<void>((resolve, reject) => {
        initResolve = resolve
        initReject = reject
    })
    // ==================================================

    // lx 环境数据准备
    const lxDataInside = {
        version: '2.0.0',
        env: 'desktop',
        platform: 'web',
        currentScriptInfo: {
            name: fullApiInfo.name,
            description: fullApiInfo.description,
            version: fullApiInfo.version,
            author: fullApiInfo.author,
            homepage: fullApiInfo.homepage,
            rawScript: fullApiInfo.script,
        },
        EVENT_NAMES: {
            request: 'request',
            inited: 'inited',
            updateAlert: 'updateAlert'
        }
    }

    // 构建 lx 工具集
    const lxUtils = {
        buffer: {
            from: (d: any, e: any) => Buffer.from(decontextify(d), decontextify(e)),
            bufToString: (b: any, f: any) => Buffer.isBuffer(b) ? b.toString(f) : Buffer.from(b, 'binary').toString(f)
        },
        crypto: {
            md5: (str: string) => crypto.createHash('md5').update((decontextify(str) || '') as any).digest('hex'),
            aesEncrypt: (buffer: any, mode: string, key: any, iv: any) => {
                const dKey = decontextify(key)
                const dIv = decontextify(iv)
                const dBuffer = decontextify(buffer)
                const algorithm = `aes-${(dKey as any).length * 8}-${mode}`
                const cipher = crypto.createCipheriv(algorithm as any, dKey as any, dIv as any)
                return Buffer.concat([cipher.update(dBuffer as any) as any, cipher.final() as any])
            },
            rsaEncrypt: (buffer: any, key: any) => crypto.publicEncrypt(decontextify(key) as any, decontextify(buffer) as any),
            randomBytes: (size: number) => crypto.randomBytes(size),
        },
        zlib: {
            inflate: (buffer: any) => inflate(decontextify(buffer) as any),
            deflate: (buffer: any) => deflate(decontextify(buffer) as any),
        }
    }

    // 核心 lx 对象
    const lxObject = {
        ...lxDataInside,
        utils: lxUtils,
        request: await createLxRequest(
            !!apiInfo.allowUnsafeVM && !!global.lx.config['system.allowUnsafeVM'],
            (alert) => {
                const currentStatus = apiStatus.get(`${fullApiInfo.owner}_${fullApiInfo.id}`) || { status: 'success' }
                currentStatus.updateAlert = {
                    name: alert.name || fullApiInfo.name,
                    log: alert.log,
                    updateUrl: alert.updateUrl
                }
                apiStatus.set(`${fullApiInfo.owner}_${fullApiInfo.id}`, currentStatus)
                console.log(`[自定义源] [更新嗅探] 嗅探到源 ${fullApiInfo.name} 的更新提示: ${alert.log}`)
            }
        ),
        send: (eventName: string, data: any, ...extraArgs: any[]) => {
            // 本服务端的 send 是**两参**形式 (eventName, data)。音源脚本常见的
            // 三参写法 `lx.send('inited', {sources}, something)` 会让 sources 丢失，
            // 而自愈逻辑随后会把 sources.json 里的声明覆写成空（D-003，高危）。
            // 这里给出**可见警告**，让写错签名的人当场发现，而不是事后丢配置。
            if (extraArgs.length > 0 && eventName === 'inited') {
                console.warn(
                    `[自定义源] ${fullApiInfo.name}: lx.send 只接受两个参数 (eventName, data)，` +
                    `收到 ${2 + extraArgs.length} 个 —— 多余参数会被忽略。` +
                    `请写成 lx.send('inited', { sources: { ... } })`
                )
            }
            const dData = decontextify(data)
            // console.log(`[自定义源-${fullApiInfo.name}] send:`, eventName)
            if (eventName === 'inited') {
                if (dData && dData.sources) {
                    registeredSources = dData.sources
                    sourcesDeclared = true
                    if (global.lx.config['debug.enabled']) {
                        console.log(`[自定义源-${fullApiInfo.name}] 已注册音源:`, Object.keys(registeredSources).join(', '))
                    }
                } else {
                    // 收到了 inited 但没有 sources —— 明确告警，并且**不**把它
                    // 当成「这个源支持 0 个平台」的权威声明（见 sourcesDeclared）。
                    console.warn(
                        `[自定义源] ${fullApiInfo.name}: lx.send('inited', …) 未携带 sources 字段，` +
                        `本次不会更新已保存的支持平台列表`
                    )
                }
                if (initResolve) initResolve()
            } else if (eventName === 'updateAlert') {
                let alertPayload: any = {}
                if (typeof dData === 'object' && dData !== null) {
                    alertPayload = {
                        name: dData.name || fullApiInfo.name,
                        log: dData.log || dData.updateMsg || dData.msg || (typeof dData === 'string' ? dData : ''),
                        updateUrl: dData.updateUrl || dData.url || ''
                    }
                } else if (typeof dData === 'string') {
                    alertPayload = {
                        name: fullApiInfo.name,
                        log: dData,
                        updateUrl: ''
                    }
                }
                const error: any = new Error(`发现新版本, 需要更新: ${alertPayload.log || JSON.stringify(dData)}`)
                error.updateAlert = alertPayload
                if (initReject) initReject(error)
            }
        },
        on: (eventName: string, handler: Function) => {
            // console.log(`[UserApi-${fullApiInfo.name}] on:`, eventName)
            if (eventName === 'request') {
                eventHandlers.set(eventName, handler)
            }
        }
    }

    // 针对音源脚本沙箱的 console 代理：非 DEBUG 模式下静默普通的 log/info/debug 等输出
    const sandboxConsole = {
        log: (...args: any[]) => { if (global.lx.config['debug.enabled']) console.log(...args) },
        info: (...args: any[]) => { if (global.lx.config['debug.enabled']) console.info(...args) },
        debug: (...args: any[]) => { if (global.lx.config['debug.enabled']) console.debug(...args) },
        warn: (...args: any[]) => { if (global.lx.config['debug.enabled']) console.warn(...args) },
        time: (...args: any[]) => { if (global.lx.config['debug.enabled']) console.time(...args) },
        timeEnd: (...args: any[]) => { if (global.lx.config['debug.enabled']) console.timeEnd(...args) },
        error: (...args: any[]) => { console.error(...args) }
    }

    // 完整沙箱环境
    const sandbox: any = {
        console: sandboxConsole,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Buffer,
        URL,
        URLSearchParams,
        TextEncoder,
        TextDecoder,
        process: {
            nextTick: (fn: Function, ...args: any[]) => setTimeout(() => fn(...args), 0),
            env: { NODE_ENV: process.env.NODE_ENV || 'production' }
        },
        lx: lxObject,
        // 关键：适配混淆脚本对全局变量的引用
        global: null,
        window: null,
        globalThis: null,
        atob: (s: string) => Buffer.from(s, 'base64').toString('binary'),
        btoa: (s: string) => Buffer.from(s, 'binary').toString('base64'),
        crypto: crypto
    }
    sandbox.global = sandbox
    sandbox.window = sandbox
    sandbox.globalThis = sandbox

    try {
        if (apiInfo.allowUnsafeVM && global.lx.config['system.allowUnsafeVM']) {
            console.log(`[自定义源] ${fullApiInfo.name} 正在以原生 VM 模式启动...`)
            const vm = require('vm')
            const context = vm.createContext(sandbox)
            // 不再注入 injectionCode 字符串，环境已在 sandbox 中就绪
            vm.runInContext(apiInfo.script, context, {
                filename: `custom_source_${fullApiInfo.id}.js`,
                timeout: 10000
            })
        } else {
            // 保持 vm2 逻辑用于安全模式
            try {
                const vmInstance = new VM({
                    timeout: 10000,
                    sandbox,
                    eval: true,
                    wasm: false,
                })
                await vmInstance.run(apiInfo.script)
            } catch (e: any) {
                const isContextError = e.message.includes('contextified object') || e.message.includes('Operation not allowed')
                if (isContextError) {
                    console.warn(`[自定义源] ${fullApiInfo.name} 触发 vm2 安全限制，正在提示用户开启 VM 模式`)
                    throw new Error('REQUIRE_UNSAFE_VM')
                }
                throw e
            }
        }

        // Clear the initialization deadline on success as well (no detached 3s timers).
        let initTimer: ReturnType<typeof setTimeout> | undefined
        try {
            await Promise.race([
                initPromise,
                new Promise((_, reject) => { initTimer = setTimeout(() => reject(new Error('初始化超时，请确保脚本调用了 lx.send("inited", ...)')), 3000) })
            ])
        } finally {
            clearTimeout(initTimer)
        }

        // 保存加载 of the API
        const apiInstance = {
            info: { ...fullApiInfo, sources: registeredSources },
            /** 本次是否真的收到了 sources 声明。上层自愈据此决定能否覆写
             *  sources.json —— 没拿到声明时绝不能把已存的支持平台列表清空（D-003）。 */
            sourcesDeclared,
            handlers: eventHandlers,
            callRequest: (action: string, source: string, info: any, requestOpts?: { signal?: SourceSignal, requestTimeoutMs?: number }) => {
                const pending = runSourceRequest<any>(signal => sourceRequestContext.run(signal, () => {
                    const handler = eventHandlers.get('request')
                    if (!handler) throw new Error(`源 ${fullApiInfo.name} 未注册 request 处理器`)
                    let inputData = { action, source, info }
                    if (apiInfo.allowUnsafeVM && global.lx.config['system.allowUnsafeVM']) {
                        inputData = JSON.parse(JSON.stringify(inputData))
                    }
                    // Preserve Promise/cancel handles until runSourceRequest owns them.
                    return handler(inputData)
                }), { timeoutMs: requestOpts?.requestTimeoutMs, signal: requestOpts?.signal })
                return pending.then(result => decontextify(result))
            }
        }

        if (persist) loadedApis.set(`${fullApiInfo.owner}_${apiInfo.id}`, apiInstance)
        console.log(`[自定义源] ✓ 成功加载: ${fullApiInfo.name} v${fullApiInfo.version} (所属: ${fullApiInfo.owner}${persist ? '' : '，临时实例不驻留'})`)
        console.log(`[自定义源]   支持平台: ${Object.keys(registeredSources).join(', ')}`)
        return { success: true, apiInstance, error: null, sourcesDeclared }
    } catch (error: any) {
        console.error(`[自定义源] ✗ 加载失败 ${fullApiInfo.name}:`, error.message)
        if (error.stack && error.message !== 'REQUIRE_UNSAFE_VM') {
            console.error(`[自定义源] [错误堆栈] ${fullApiInfo.name}:`, error.stack)
        }

        let isRequireUnsafe = !apiInfo.allowUnsafeVM && (error.message === 'REQUIRE_UNSAFE_VM' || error.message.includes('初始化超时') || error.message.includes('timeout'))

        // 如果在 VM2 模式下加载失败，且系统允许 VM 模式，尝试测试原生 VM 模式能否成功加载
        if (!isRequireUnsafe && !apiInfo.allowUnsafeVM && global.lx.config['system.allowUnsafeVM']) {
            try {
                const testUnsafeRes = await loadUserApi({
                    ...apiInfo,
                    id: `${apiInfo.id}_test_vm`,
                    allowUnsafeVM: true
                }, { persist: false })
                if (testUnsafeRes.success) {
                    console.log(`[自定义源] ${fullApiInfo.name} 在 VM2 模式下失败，但在原生 VM 模式下成功，标记 requireUnsafe = true`)
                    isRequireUnsafe = true
                }
            } catch (e) { }
        }

        return { success: false, apiInstance: null, error: error.message, requireUnsafe: isRequireUnsafe, updateAlert: error.updateAlert }
    }
}

// Owner+id scoped health; collection only checks eligibility, execution atomically acquires it.
const sourceHealth = createSourceHealth({
    policy: () => ({
        enabled: global.lx.config['music.url.breakerEnabled'] !== false,
        threshold: Math.max(1, Number(global.lx.config['music.url.breakerThreshold'] ?? 3) || 3),
        cooldownMs: Math.max(5_000, (Number(global.lx.config['music.url.breakerCooldown'] ?? 300) || 300) * 1000)
    })
})

/** Link-validation accounting; omit owner only for public ('open') sources. */
export const reportSourceResult = (apiId: string, ok: boolean, owner = 'open') => sourceHealth.recordResult(apiId, ok, owner)

/** Only genuine positive measured latency is accepted; EMA alpha=.35, TTL=30min. */
export const recordSourceSpeed = (apiId: string, ms: number, owner = 'open') => sourceHealth.recordSpeed(apiId, ms, owner)
export const getSourceSpeed = (apiId: string, owner = 'open'): number | null => sourceHealth.getSpeed(apiId, owner)

const orderSpeedTuneEnabled = () => global.lx.config['music.url.speedTune'] !== false

/** Source mutation invalidates both breaker state and measured latency. */
export const resetAllSourceBreakers = () => sourceHealth.resetAll()

export interface MusicUrlRaceOptions {
    /** 外层置 true 后，内部竞速立刻停止发起新的候选并尽快返回——
     *  否则输掉的外层候选会把整条内部竞速跑完，一次播放多打十几次上游请求 */
    signal?: SourceSignal
    /** Strict total deadline per attempt (handler + link validation), default 10s. */
    requestTimeoutMs?: number
    /**
     * 脚本成功返回链接时要不要记一次熔断「成功」。解析器会随后对链接做可用性
     * 探测并自行记账；若这里也记成功，就会把熔断计数清零，紧接着解析器记的
     * 「校验失败」永远只有 1 次——稳定返回死链的源永远到不了熔断阈值。
     */
    recordBreakerSuccess?: boolean
    /** 关闭后回退到串行轮询（仅用于排障/对比） */
    race?: boolean
    /**
     * 候选链接的可播性校验。返回 false 表示这个链接不能用（死链/网关屏蔽），
     * 该候选不算赢，竞速继续让后面的源上。
     *
     * 为什么需要：音源脚本「调用成功」不等于「链接能播」。长青这类聚合源排在
     * order.json 前面，后端挂掉时依然会成功返回一个 522 死链——内部竞速一见
     * 脚本返回就判它赢，把同平台真正能播的源（野花/野草/全豆要）全部中止，
     * 死链就这么被交到播放器手上，缓冲十几秒才失败（实测每首等 4~10s）。
     * 由解析器（唯一持有探测能力的一方）来裁决，内部竞速只管「拿到几个候选」。
     */
    validateLink?: (url: string) => Promise<boolean>
    /** 相邻候选的错峰启动间隔(ms) */
    staggerMs?: number
    /** 已有低序号候选成功时，给更靠前在途候选反超的宽限时间(ms) */
    priorityGraceMs?: number
    /** 同时在途的候选上限 */
    maxParallel?: number
    /** 每个候选自身的尝试次数 */
    retries?: number
}

// 调用自定义源的 getMusicUrl
export async function callUserApiGetMusicUrl(
    source: string,
    songInfo: any,
    quality: string,
    clientUsername?: string,
    onProgress?: (attempt: any) => Promise<void> | void,
    enableAutoSwitchApiSource?: boolean,
    excludeApiSources?: string[],
    opts?: MusicUrlRaceOptions
): Promise<{ url: string, type: string, sourceName?: string, sourceId?: string, sourceOwner?: string, attempts?: any[], hasMoreSources?: boolean }> {
    if (opts?.signal?.aborted) throw sourceAbortError()
    // 标准化 songInfo 格式：将 meta 中的字段提升到顶层
    const normalizedSongInfo = { ...songInfo }
    if (songInfo.meta) {
        // 将 meta 中的所有字段展开到顶层
        Object.assign(normalizedSongInfo, songInfo.meta)

        // ========== 通用字段映射 ==========
        // songId -> songmid (通用)
        if (songInfo.meta.songId && !normalizedSongInfo.songmid) {
            normalizedSongInfo.songmid = songInfo.meta.songId
        }

        // 图片字段统一
        if (songInfo.meta.picUrl && !normalizedSongInfo.img) {
            normalizedSongInfo.img = songInfo.meta.picUrl
        }

        // 音质信息
        if (songInfo.meta.qualitys && !normalizedSongInfo.types) {
            normalizedSongInfo.types = songInfo.meta.qualitys
        }
        if (songInfo.meta._qualitys && !normalizedSongInfo._types) {
            normalizedSongInfo._types = songInfo.meta._qualitys
        }

        // ========== 各平台特有字段 ==========
        // 酷狗 (kg): hash, albumId
        if (songInfo.meta.hash && !normalizedSongInfo.hash) {
            normalizedSongInfo.hash = songInfo.meta.hash
        }
        if (songInfo.meta.albumId && !normalizedSongInfo.albumId) {
            normalizedSongInfo.albumId = songInfo.meta.albumId
        }

        // 咪咕 (mg): copyrightId, lrcUrl, mrcUrl, trcUrl
        if (songInfo.meta.copyrightId && !normalizedSongInfo.copyrightId) {
            normalizedSongInfo.copyrightId = songInfo.meta.copyrightId
        }
        if (songInfo.meta.lrcUrl && !normalizedSongInfo.lrcUrl) {
            normalizedSongInfo.lrcUrl = songInfo.meta.lrcUrl
        }
        if (songInfo.meta.mrcUrl && !normalizedSongInfo.mrcUrl) {
            normalizedSongInfo.mrcUrl = songInfo.meta.mrcUrl
        }
        if (songInfo.meta.trcUrl && !normalizedSongInfo.trcUrl) {
            normalizedSongInfo.trcUrl = songInfo.meta.trcUrl
        }

        // QQ音乐 (tx): strMediaMid, albumMid
        if (songInfo.meta.strMediaMid && !normalizedSongInfo.strMediaMid) {
            normalizedSongInfo.strMediaMid = songInfo.meta.strMediaMid
        }
        if (songInfo.meta.albumMid && !normalizedSongInfo.albumMid) {
            normalizedSongInfo.albumMid = songInfo.meta.albumMid
        }

        // 不再删除 meta 对象，以免有些严谨的脚本报错（许多脚本会读取 info.meta）
        // delete normalizedSongInfo.meta
    }

    // ========== 顶层字段兜底映射 ==========
    if (!normalizedSongInfo.hash && songInfo.hash) {
        normalizedSongInfo.hash = songInfo.hash
    }
    if (!normalizedSongInfo.copyrightId && songInfo.copyrightId) {
        normalizedSongInfo.copyrightId = songInfo.copyrightId
    }
    if (!normalizedSongInfo.strMediaMid && songInfo.strMediaMid) {
        normalizedSongInfo.strMediaMid = songInfo.strMediaMid
    }
    if (!normalizedSongInfo.albumMid && songInfo.albumMid) {
        normalizedSongInfo.albumMid = songInfo.albumMid
    }
    if (!normalizedSongInfo.albumId && songInfo.albumId) {
        normalizedSongInfo.albumId = songInfo.albumId
    }
    if (!normalizedSongInfo.lrcUrl && songInfo.lrcUrl) {
        normalizedSongInfo.lrcUrl = songInfo.lrcUrl
    }
    if (!normalizedSongInfo.mrcUrl && songInfo.mrcUrl) {
        normalizedSongInfo.mrcUrl = songInfo.mrcUrl
    }
    if (!normalizedSongInfo.trcUrl && songInfo.trcUrl) {
        normalizedSongInfo.trcUrl = songInfo.trcUrl
    }
    if (typeof normalizedSongInfo.hash === 'string' && !normalizedSongInfo.hash) {
        delete normalizedSongInfo.hash
    }

    let supportedCount = 0;
    let lastError: any = null;

    // 查找支持该 source 的 API
    // 收集所有支持该 source 的 API，并根据权限过滤
    let candidates: any[] = []
    const userApiIds = new Set<string>()

    // 读取当前用户的公开源状态覆盖（启用/禁用）以及私有源 ID 集合
    let userStates: Record<string, any> = {}
    const dataPath = process.env.DATA_PATH || path.join(process.cwd(), 'data')
    if (clientUsername && clientUsername !== 'default') {
        const userPath = path.join(dataPath, 'users', 'source', clientUsername)
        const statesPath = path.join(userPath, 'states.json')
        const metaPath = path.join(userPath, 'sources.json')

        if (fs.existsSync(statesPath)) {
            try { userStates = JSON.parse(fs.readFileSync(statesPath, 'utf-8')) } catch (e) { }
        }
        // 预收集私有源 ID（用于屏蔽同名公开源）
        if (fs.existsSync(metaPath)) {
            try {
                const userSources = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
                for (const s of userSources) userApiIds.add(s.id)
            } catch (e) { }
        }
    } else {
        const openStatesPath = path.join(dataPath, 'users', 'source', '_open', 'states.json')
        if (fs.existsSync(openStatesPath)) {
            try { userStates = JSON.parse(fs.readFileSync(openStatesPath, 'utf-8')) } catch (e) { }
        }
    }

    const getSourceState = (id: string) => {
        return userStates[id] || userStates[decodeURIComponent(id)] || userStates[encodeURIComponent(id)] || {}
    }

    // 按 loadedApis 收集所有可用候选源（权限过滤，不强制任何顺序）
    const trippedSourceNames: string[] = []
    for (const [apiId, api] of loadedApis) {
        if (!api.info.sources || !api.info.sources[source]) continue
        // 连续失败被熔断的源本轮直接不参与竞速
        if (sourceHealth.isBlocked(api.info.id, api.info.owner)) {
            trippedSourceNames.push(api.info.name)
            if (global.lx.config['debug.enabled']) console.log(`[自定义源] ${api.info.name} 处于熔断冷却，本轮跳过`)
            continue
        }

        const state = getSourceState(api.info.id)

        if (api.info.owner === 'open') {
            // 计算公开源对当前用户的有效启用状态
            let isEnabled = api.info.enabled
            if (clientUsername && clientUsername !== 'default') {
                if (typeof state.enabled === 'boolean') {
                    isEnabled = state.enabled
                }
            }
            if (!isEnabled) continue
            if (userApiIds.has(api.info.id)) continue  // 被同名私有版本覆盖，跳过

            // 检查平台是否被禁用
            if (Array.isArray(state.disabledSources) && state.disabledSources.includes(source)) {
                continue
            }

            candidates.push(api)
        } else if (clientUsername && api.info.owner === clientUsername) {
            if (!api.info.enabled) continue

            // 检查平台是否被禁用
            if (Array.isArray(state.disabledSources) && state.disabledSources.includes(source)) {
                continue
            }

            candidates.push(api)
            userApiIds.add(api.info.id) // 兜底：确保后续不重复添加公开同名源
        }
    }

    // === 实时按 order.json 对候选列表排序 ===
    // 不依赖 loadedApis 的 Map 插入顺序（部分 reload 后顺序会乱），
    // 每次解析都直接读 order.json，无需重启服务器即可生效
    if (candidates.length > 1) {
        const dataPath = process.env.DATA_PATH || path.join(process.cwd(), 'data')
        let orderData: string[] = []

        // 优先读用户自己的排序（admin/order.json），再回退到公开源排序（_open/order.json）
        const orderCandidates = clientUsername && clientUsername !== 'default'
            ? [
                path.join(dataPath, 'users', 'source', clientUsername, 'order.json'),
                path.join(dataPath, 'users', 'source', '_open', 'order.json')
              ]
            : [path.join(dataPath, 'users', 'source', '_open', 'order.json')]

        for (const orderPath of orderCandidates) {
            if (fs.existsSync(orderPath)) {
                try {
                    orderData = JSON.parse(fs.readFileSync(orderPath, 'utf-8'))
                    if (orderData.length > 0) break
                } catch (e) { }
            }
        }

        if (orderData.length > 0) {
            const idToIndex = new Map(orderData.map((id, i) => [id, i]))
            candidates.sort((a: any, b: any) => {
                const ia = idToIndex.has(a.info.id) ? idToIndex.get(a.info.id)! : 999999
                const ib = idToIndex.has(b.info.id) ? idToIndex.get(b.info.id)! : 999999
                return ia - ib
            })
        }

        // === 测速微调：同优先级内把快的源排前面 ===
        //
        // 【为什么只做「同优先级内」的微调，而不是全局按速度排序】
        // order.json 是用户显式表达的偏好（「我就想先用这个源」）。用实测速度
        // 去覆盖它，等于替用户改配置 —— 一旦测速样本受网络抖动影响，
        // 用户会发现自己的排序莫名失效。所以只处理 order.json **没表态**的那部分：
        // 两个源同在排序表里时按表来；都不在表里（或名次相同）时才用速度决定先后。
        //
        // 【为什么缺样本的排前面】
        // 没有样本 = 还没被探过 = 可能是个刚加进来的好源。把它沉底会形成
        // 「没样本→排后面→永远不被选中→永远没样本」的死循环。
        if (orderSpeedTuneEnabled()) {
            const rankOf = (id: string) => {
                const idx = orderData.indexOf(id)
                return idx === -1 ? Number.MAX_SAFE_INTEGER : idx
            }
            candidates.sort((a: any, b: any) => {
                const ra = rankOf(a.info.id)
                const rb = rankOf(b.info.id)
                if (ra !== rb) return ra - rb          // order.json 说了算
                const sa = getSourceSpeed(a.info.id, a.info.owner)
                const sb = getSourceSpeed(b.info.id, b.info.owner)
                if (sa === null && sb === null) return 0
                if (sa === null) return -1        // 无样本优先，给它一次机会
                if (sb === null) return 1
                return sa - sb
            })
        }
    }
    // =========================================

    // === 排除已在当前请求中上报失败/失效的自定义源 ===
    if (Array.isArray(excludeApiSources) && excludeApiSources.length > 0) {
        const excludeSet = new Set(excludeApiSources.map(s => String(s).trim().toLowerCase()))
        candidates = candidates.filter(api => {
            const name = (api.info?.name || '').trim().toLowerCase()
            const id = (api.info?.id || '').trim().toLowerCase()
            return !excludeSet.has(name) && !excludeSet.has(id)
        })
    }

    if (enableAutoSwitchApiSource === false && candidates.length > 1) {
        candidates = [candidates[0]]
        // 只留一个候选时并发竞速没有意义，退回串行 + 重试
        opts = { ...opts, race: false }
    }

    supportedCount = candidates.length

    if (supportedCount === 0) {
        const hasExcluded = Array.isArray(excludeApiSources) && excludeApiSources.length > 0
        // 三种「一个候选都没有」的原因要分开说。原来一律报「未找到支持 X 的自定义源」，
        // 会把「源装着、只是连续失败进了冷却」说成「源没装」，把管理员引到设置页看半天。
        const errMsg = hasExcluded
            ? `支持 ${source} 平台的自定义源均已尝试且无法播放（已尝试 ${excludeApiSources.length} 个音源）`
            : trippedSourceNames.length > 0
                ? `支持 ${source} 平台的 ${trippedSourceNames.length} 个自定义源正在熔断冷却中（${trippedSourceNames.join('、')}），稍后会自动重试`
                : `未找到支持 ${source} 平台的自定义源，请在设置中添加或启用相关源`
        if (onProgress) await onProgress({ name: '系统', status: 'fail', message: errMsg })
        const err: any = new Error(errMsg)
        err.allSourcesExhausted = true
        throw err
    }

    // 每个候选占一个槽位：attempts 最终按候选(优先级)顺序输出，而不是按完成先后。
    // 前端把这份列表直接展示给用户，按优先级排比按时间排可读。
    const attemptSlots: any[][] = candidates.map(() => [])
    const cfg = global.lx.config as any
    const raceEnabled = opts?.race ?? (cfg['music.url.race'] !== false)
    const staggerMs = Math.max(0, Number(opts?.staggerMs ?? cfg['music.url.raceStagger'] ?? 180))
    const priorityGraceMs = Math.max(0, Number(opts?.priorityGraceMs ?? cfg['music.url.priorityGrace'] ?? 350))
    const maxParallel = Math.max(1, Number(opts?.maxParallel ?? cfg['music.url.maxParallel'] ?? 4))
    // 只有一个候选时它就是唯一机会，至少给两次尝试（改造前是固定重试 3 次）。
    // 不能只靠 `?? defaultRetries` 取默认值：music.url.sourceRetries 在 defaultConfig
    // 里有值，?? 永远不会落到 defaultRetries，单源重试会直接消失。
    const configuredRetries = Math.max(1, Number(opts?.retries ?? cfg['music.url.sourceRetries'] ?? 1))
    const maxRetries = candidates.length === 1 ? Math.max(2, configuredRetries) : configuredRetries
    const retryDelayMs = Math.max(0, Number(cfg['music.url.retryDelay'] ?? 900))

    const requestTimeoutMs = Number.isFinite(opts?.requestTimeoutMs) && opts!.requestTimeoutMs! > 0
        ? opts!.requestTimeoutMs! : 10_000
    const controller = new AbortController()
    const detachAbort = observeSourceAbort(opts?.signal, () => controller.abort())
    const stopped = () => controller.signal.aborted || !!opts?.signal?.aborted
    const succeeded = new Map<number, any>()
    const inflight = new Set<number>()
    const running = new Set<Promise<void>>()
    let accepted: { index: number, result: any } | null = null
    let schedulingDone = false
    let graceDeadline = 0
    let dirty = false
    const listeners = new Set<() => void>()
    const changed = () => { dirty = true; for (const listener of [...listeners]) listener() }
    controller.signal.addEventListener('abort', changed)
    // Unlike Promise.race(nextChange, sleep), this removes timed-out listeners/timers.
    const nextChange = async (ms = 1000): Promise<void> => {
        if (dirty || stopped()) { dirty = false; return }
        await new Promise<void>(resolve => {
            const finish = () => { clearTimeout(timer); listeners.delete(finish); resolve() }
            const timer = setTimeout(finish, Math.max(0, ms))
            listeners.add(finish)
        })
        dirty = false
    }

    const emit = (slot: any[], att: any) => {
        slot.push(att)
        if (!accepted && !stopped() && onProgress) {
            try { void Promise.resolve(onProgress(att)).catch(() => {}) } catch {}
        }
    }

    const runCandidate = async (index: number) => {
        const api = candidates[index]
        const slot = attemptSlots[index]
        const identity = { name: api.info.name, sourceId: api.info.id, sourceOwner: api.info.owner }
        try {
            for (let i = 0; i < maxRetries; i++) {
                if (accepted || stopped()) return
                // Atomic admission belongs here, not to candidate collection: other platform
                // resolvers may already have collected this same recovering source.
                const permit = sourceHealth.acquire(api.info.id, api.info.owner)
                if (!permit) return
                try {
                    debugLog(`[自定义源] 尝试 ${api.info.name} 获取 ${source} 音乐链接 (第 ${i + 1}/${maxRetries} 次, 所属: ${api.info.owner})`)
                    const url = await runSourceRequest<string>(async signal => {
                        const result = await api.callRequest('musicUrl', source, {
                            musicInfo: normalizedSongInfo, quality, type: quality
                        }, { signal, requestTimeoutMs })
                        if (stopped() || signal.aborted) throw sourceAbortError()
                        // Undefined/non-URL results must never win a race.
                        if (typeof result !== 'string' || !result.trim()) throw new Error('音源未返回有效的 HTTP(S) URL')
                        const url = result.trim()
                        const parsed = new URL(url)
                        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('音源未返回有效的 HTTP(S) URL')
                        if (opts?.validateLink) {
                            const linkOk = await opts.validateLink(url)
                            if (stopped() || signal.aborted) throw sourceAbortError()
                            if (!linkOk) throw new Error('音源返回的链接不可用')
                        }
                        return url
                    }, { timeoutMs: requestTimeoutMs, signal: controller.signal })
                    // Recheck AFTER every await, including errors/cancellation from an outer race.
                    if (accepted || stopped()) return
                    permit.finish(opts?.recordBreakerSuccess === false ? undefined : true)
                    emit(slot, { ...identity, status: 'success', message: maxRetries > 1 ? `第 ${i + 1} 次尝试成功` : '' })
                    succeeded.set(index, { url, type: quality, sourceName: api.info.name, sourceId: api.info.id, sourceOwner: api.info.owner })
                    changed()
                    return
                } catch (error: any) {
                    if (accepted || stopped() || isSourceAbort(error)) return
                    lastError = error
                    permit.finish(false)
                    console.error(`[自定义源] ${api.info.name} 失败 (第 ${i + 1}/${maxRetries} 次):`, `音源日志：${error.message}`)
                    emit(slot, { ...identity, status: 'fail', message: `音源日志：${error.message}` })
                    changed()
                } finally {
                    permit.finish() // cancellation/deferred accounting releases a half-open slot
                }
                if (i < maxRetries - 1 && !accepted && !stopped()) {
                    try { await waitForSourceDelay(retryDelayMs, controller.signal) } catch { return }
                }
            }
        } finally {
            inflight.delete(index)
            changed()
        }
    }

    // One owned scheduler for serial and race modes; the arbiter deadline is live in both.
    const schedule = async () => {
        try {
            for (let i = 0; i < candidates.length; i++) {
                if (accepted || stopped()) return
                if (raceEnabled && i > 0) await waitForSourceDelay(staggerMs, controller.signal)
                while (inflight.size >= (raceEnabled ? maxParallel : 1) && !accepted && !stopped()) await nextChange()
                if (accepted || stopped() || (!raceEnabled && succeeded.size > 0)) return
                inflight.add(i)
                const task = runCandidate(i)
                running.add(task)
                void task.finally(() => running.delete(task))
                if (!raceEnabled) await task
            }
        } catch (error) {
            if (!isSourceAbort(error)) lastError = error
        } finally {
            schedulingDone = true
            changed()
        }
    }
    const scheduleTask = schedule()
    // Finite overall budget too; when it expires the scheduler and pending starts are stopped.
    const arbiterDeadline = Date.now() + 120_000
    let winner: { index: number, result: any } | null = null
    try {
        for (;;) {
            if (stopped()) break
            if (Date.now() >= arbiterDeadline) {
                lastError = new Error('自定义源竞速总时限已到')
                break
            }
            if (succeeded.size > 0) {
                const best = Math.min(...succeeded.keys())
                if (graceDeadline === 0) graceDeadline = Date.now() + priorityGraceMs
                const hasHigherPriorityInFlight = [...inflight].some(i => i < best)
                if (hasHigherPriorityInFlight && Date.now() < graceDeadline) {
                    await nextChange(Math.min(graceDeadline, arbiterDeadline) - Date.now())
                    continue
                }
                winner = { index: best, result: succeeded.get(best) }
                accepted = winner
                break
            }
            if (schedulingDone && inflight.size === 0) break
            await nextChange(Math.min(1000, arbiterDeadline - Date.now()))
        }
    } finally {
        controller.abort()
        detachAbort()
        await scheduleTask
        await Promise.allSettled([...running])
        controller.signal.removeEventListener('abort', changed)
    }

    const attempts = attemptSlots.flat()
    if (opts?.signal?.aborted) {
        const error: any = sourceAbortError()
        error.attempts = attempts
        throw error
    }

    if (winner) {
        const r = winner.result
        return {
            url: r.url,
            type: r.type || quality,
            sourceName: r.sourceName,
            sourceId: r.sourceId,
            sourceOwner: r.sourceOwner,
            attempts,
            hasMoreSources: winner.index < candidates.length - 1
        }
    }

    const detailMsg = supportedCount === 1
        ? `自定义源 [${candidates[0].info.name}] 解析失败`
        : `已尝试了 ${supportedCount} 个支持 ${source} 平台的源，但全部解析失败`

    const finalError: any = new Error(`${detailMsg} (音源日志: ${lastError?.message})`)
    finalError.attempts = attempts
    throw finalError
}

// 辅助函数：加载指定目录下的源
async function loadSourcesFromDir(dirPath: string, owner: string, stats: { loadedCount: number }) {
    const metaPath = path.join(dirPath, 'sources.json')
    if (!fs.existsSync(metaPath)) {
        return
    }

    try {
        let sources = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        let needsSave = false

        // === 按 order.json 排序，确保 loadedApis 插入顺序 = 用户配置的优先级顺序 ===
        const orderPath = path.join(dirPath, 'order.json')
        if (fs.existsSync(orderPath)) {
            try {
                const order: string[] = JSON.parse(fs.readFileSync(orderPath, 'utf-8'))
                if (order.length > 0) {
                    const idToIndex = new Map(order.map((id, i) => [id, i]))
                    sources = [...sources].sort((a: any, b: any) => {
                        const ia = idToIndex.has(a.id) ? idToIndex.get(a.id)! : 999999
                        const ib = idToIndex.has(b.id) ? idToIndex.get(b.id)! : 999999
                        return ia - ib
                    })
                }
            } catch (e) { }
        }
        // =========================================================================

        for (const source of sources) {
            if (!source.enabled && owner !== 'open') {
                console.log(`[自定义源] [${owner}] 跳过已禁用: ${source.name}`)
                apiStatus.delete(`${owner}_${source.id}`)
                continue
            }

            const scriptPath = path.join(dirPath, source.id)
            if (!fs.existsSync(scriptPath)) {
                console.warn(`[自定义源] [${owner}] 脚本文件未找到: ${source.id}`)
                continue
            }

            try {
                const script = fs.readFileSync(scriptPath, 'utf-8')
                const metadata = extractMetadata(script)

                const result = await loadUserApi({
                    id: source.id,
                    name: metadata.name || source.name,
                    description: metadata.description || '',
                    version: metadata.version || 1,
                    author: metadata.author || '',
                    homepage: metadata.homepage || '',
                    script,
                    sources: {},
                    enabled: source.enabled, // 传递原本的开关状态
                    allowUnsafeVM: source.allowUnsafeVM, // 传递不安全模式标志
                    owner: owner // 设置 owner
                })

                if (result.success) {
                    stats.loadedCount++
                    const prevStatus = apiStatus.get(`${owner}_${source.id}`)
                    apiStatus.set(`${owner}_${source.id}`, {
                        status: 'success',
                        updateAlert: result.updateAlert || prevStatus?.updateAlert
                    })

                    // [Self-Healing] 检查并修复 supportedSources
                    //
                    // 【绝不能用「没拿到声明」去覆写已存列表（D-003，高危）】
                    // 脚本漏带 sources、或把 lx.send 写成三参时，runtimeSources 会是
                    // 空数组。旧逻辑把它当权威结果，把 sources.json 里已存的
                    // supportedSources 覆写成 `[]` —— 用户什么都没做错，源却"坏掉"了，
                    // 重新上传也一样，而且**没有任何提示**。
                    // 只有脚本**明确声明过** sources 时才允许比对与更新。
                    if (!result.sourcesDeclared) {
                        console.warn(
                            `[自定义源] [${owner}] ${source.name} 本次未声明 sources，` +
                            `保留已保存的支持平台列表（${JSON.stringify(source.supportedSources || [])}）不做修改`
                        )
                    } else {
                        const runtimeSources = Object.keys(result.apiInstance.info.sources).sort();
                        const storedSources = (source.supportedSources || []).sort();

                        if (JSON.stringify(runtimeSources) !== JSON.stringify(storedSources)) {
                            console.log(`[自定义源] [自动修复] [${owner}] 更新源 ${source.name} 的支持列表: ${JSON.stringify(storedSources)} -> ${JSON.stringify(runtimeSources)}`);
                            source.supportedSources = runtimeSources;
                            if (metadata.version && source.version !== metadata.version) source.version = metadata.version;
                            if (metadata.author && source.author !== metadata.author) source.author = metadata.author;
                            if (metadata.description && source.description !== metadata.description) source.description = metadata.description;
                            if (metadata.homepage && source.homepage !== metadata.homepage) source.homepage = metadata.homepage;
                            needsSave = true;
                        }
                    }
                } else {
                    console.error(`[自定义源] [${owner}] 加载 ${metadata.name || source.name} 失败: ${result.error}`)
                    apiStatus.set(`${owner}_${source.id}`, { status: 'failed', error: result.error, updateAlert: result.updateAlert })
                }
            } catch (error: any) {
                console.error(`[自定义源] [${owner}] 加载 ${source.name} 失败:`, error.message)
                apiStatus.set(`${owner}_${source.id}`, { status: 'failed', error: error.message, updateAlert: error.updateAlert })
            }
        }

        if (needsSave) {
            // 在保存前更新该用户的最后操作时间，防止启动时 Self-Healing 触发 watcher 重复重载
            lastReloadMap.set(owner, Date.now())
            // Write back using the original (file-order) sources array to avoid overwriting sources.json ordering
            const originalSources = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
            const updatedMap = new Map(sources.map((s: any) => [s.id, s]))
            const merged = originalSources.map((s: any) => updatedMap.get(s.id) || s)
            fs.writeFileSync(metaPath, JSON.stringify(merged, null, 2));
            console.log(`[自定义源] [${owner}] 已更新 sources.json 元数据`);
        }
    } catch (error: any) {
        console.error(`[自定义源] [${owner}] 读取 sources.json 失败:`, error.message)
    }
}

// 文件监控相关
let fsWatcher: fs.FSWatcher | null = null
const lastReloadMap = new Map<string, number>() // 记录每个用户的最后加载时间

/** 关闭源文件监控。生产环境不需要调用（进程退出时自动关闭），
 *  但**测试必须能关** —— 否则 fs.watch 会让 node:test 进程永不退出
 *  （表现为测试挂起，不是失败，很容易被误当成"跑得慢"）。 */
export function stopSourceWatcher() {
    if (fsWatcher) {
        try { fsWatcher.close() } catch { /* 已关闭 */ }
        fsWatcher = null
    }
}

// 启动文件监控
function startWatcher(sourceRoot: string) {
    if (fsWatcher) return

    console.log(`[自定义源] 启动源文件监控: ${sourceRoot}`)
    const debounceMap = new Map<string, NodeJS.Timeout>()

    try {
        // Warning: recursive option for fs.watch is generally supported on Windows/macOS but not Linux
        // For better cross-platform support, chokidar would be preferred, but using fs.watch as requested/minimal dependency
        fsWatcher = fs.watch(sourceRoot, { recursive: true }, (eventType, filename) => {
            if (!filename) return

            // 仅关注 .js 和 sources.json 文件的变化
            if (!filename.endsWith('.js') && !filename.endsWith('sources.json')) {
                return
            }

            // 解析用户名 (目录名)
            // filename on Windows might be "username\file.js"
            const parts = (filename as string).split(path.sep)
            let username = parts[0]

            // 如果是 _open 目录，对应 'open' 用户
            if (username === '_open') {
                username = 'open'
            }

            // 简单的防抖处理
            if (debounceMap.has(username)) {
                clearTimeout(debounceMap.get(username)!)
            }

            debounceMap.set(username, setTimeout(() => {
                // 检查是否是最近刚加载或写入过 (避免面板上传或服务端自愈保存造成的重复加载)
                // 阈值设为 4000ms
                const lastReload = lastReloadMap.get(username) || 0
                if (Date.now() - lastReload < 4000) {
                    return
                }

                console.log(`[自定义源] [文件监控] 检测到文件变动 (${eventType}): ${filename} -> 重新加载 ${username}`)
                initUserApis(username).catch(err => {
                    console.error(`[自定义源] [文件监控] 重新加载失败:`, err)
                })
            }, 2000)) // 2秒防抖，等待文件写入完成
        })

        // 进程退出时关闭监听
        process.on('exit', () => {
            if (fsWatcher) fsWatcher.close()
        })
    } catch (e) {
        console.error('[自定义源] 启动文件监控失败:', e)
    }
}

// 从文件系统加载所有已启用的自定义源
// 路径变更：DATA_PATH/users/source/{username} 和 DATA_PATH/users/source/_open
export async function initUserApis(targetUser?: string) {
    resetAllSourceBreakers()
    const dataPath = process.env.DATA_PATH || path.join(process.cwd(), 'data')
    const sourceRoot = path.join(dataPath, 'users', 'source')
    const stats = { loadedCount: 0 }

    // 更新最后加载时间
    if (targetUser) {
        lastReloadMap.set(targetUser, Date.now())
    } else {
        // 全局加载
    }

    console.log(`[自定义源] ========================================`)

    // 如果根目录不存在，无需加载
    if (!fs.existsSync(sourceRoot)) {
        console.log(`[自定义源] 未找到自定义源根目录: ${sourceRoot}`)
        console.log(`[自定义源] ========================================`)
        return
    }

    // 尝试启动监控 (只会在第一次调用且无 watcher 时启动)
    if (!fsWatcher) {
        startWatcher(sourceRoot)
    }

    if (targetUser) {
        console.log(`[自定义源] 重新加载用户源: ${targetUser}`)
        // 清理该用户的旧源和状态
        for (const [key, api] of loadedApis.entries()) {
            if (api.info.owner === targetUser) {
                loadedApis.delete(key)
            }
        }
        for (const key of apiStatus.keys()) {
            if (key.startsWith(`${targetUser}_`)) {
                apiStatus.delete(key)
            }
        }

        // 加载该用户的源
        let dirName = targetUser

        // 特殊处理：如果是 'open'，对应目录是 '_open'
        if (targetUser === 'open') {
            dirName = '_open'
        }

        const userSourceDir = path.join(sourceRoot, dirName)
        if (fs.existsSync(userSourceDir)) {
            await loadSourcesFromDir(userSourceDir, targetUser, stats)
        }

    } else {
        console.log(`[自定义源] 初始化所有自定义源...`)
        loadedApis.clear()

        // 扫描 sourceRoot 下的所有子目录
        try {
            const entries = fs.readdirSync(sourceRoot, { withFileTypes: true })
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    let owner = entry.name
                    // 如果目录是 _open，owner 为 'open'
                    if (entry.name === '_open') {
                        owner = 'open'
                    }

                    const dirPath = path.join(sourceRoot, entry.name)
                    await loadSourcesFromDir(dirPath, owner, stats)
                }
            }
        } catch (error: any) {
            console.error('[自定义源] 扫描源目录失败:', error.message)
        }
    }

    console.log(`[自定义源] 本次加载: ${stats.loadedCount} 个源`)
    console.log(`[自定义源] 当前总计: ${loadedApis.size} 个源`)
    console.log(`[自定义源] ========================================`)
}

// 获取所有已加载的 API
export function getLoadedApis() {
    return Array.from(loadedApis.values()).map(api => api.info)
}

// 检查某个源是否被支持
// clientUsername: 调用者的用户名。如果未提供，则只能检查 open 源
export function isSourceSupported(source: string, clientUsername?: string): boolean {
    const dataPath = process.env.DATA_PATH || path.join(process.cwd(), 'data')
    let userStates: Record<string, any> = {}
    if (clientUsername && clientUsername !== 'default') {
        const statesPath = path.join(dataPath, 'users', 'source', clientUsername, 'states.json')
        if (fs.existsSync(statesPath)) {
            try { userStates = JSON.parse(fs.readFileSync(statesPath, 'utf-8')) } catch (e) { }
        }
    } else {
        const openStatesPath = path.join(dataPath, 'users', 'source', '_open', 'states.json')
        if (fs.existsSync(openStatesPath)) {
            try { userStates = JSON.parse(fs.readFileSync(openStatesPath, 'utf-8')) } catch (e) { }
        }
    }

    const getSourceState = (id: string) => {
        return userStates[id] || userStates[decodeURIComponent(id)] || userStates[encodeURIComponent(id)] || {}
    }

    for (const [apiId, api] of loadedApis) {
        if (!api.info.sources || !api.info.sources[source]) {
            continue
        }

        const state = getSourceState(api.info.id)
        let isEnabled = api.info.enabled
        if (api.info.owner === 'open' && clientUsername && clientUsername !== 'default') {
            if (typeof state.enabled === 'boolean') {
                isEnabled = state.enabled
            }
        }
        if (!isEnabled) continue

        // 检查平台是否被禁用
        if (Array.isArray(state.disabledSources) && state.disabledSources.includes(source)) {
            continue
        }

        // 权限检查
        if (api.info.owner === 'open' || (clientUsername && api.info.owner === clientUsername)) {
            return true
        }
    }
    return false
}
