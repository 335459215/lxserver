import * as fs from 'fs'
import * as path from 'path'
import { extractMetadata, loadUserApi, initUserApis, getApiStatus, getSourceSpeed, getLoadedApi, recordSourceSpeed } from './userApi'
import musicSdkRaw from '@/modules/utils/musicSdk/index.js'
import type { IncomingMessage, ServerResponse } from 'http'
import { getProxyAgent } from '../modules/utils/proxy.js'
import { isAdminRequest } from './adminAuth'
import { basenameFromUrl, buildFetchPlan, describeBatchBudgetExhausted, normalizeSourceContent, sizeLimitError, SOURCE_BATCH_TOTAL_TIMEOUT_MS, SOURCE_IMPORT_ITEM_TIMEOUT_MS, SOURCE_MAX_BYTES, SourceImportError, withTimeout } from './customSourceUrl'
import { fetchSourceScript } from './customSourceFetch'
import {
    SOURCE_BATCH_LIMIT,
    describeDuplicate,
    findDuplicateSource,
    hashSourceContent,
    normalizeSourceUrl,
    sourceIdFromName,
    type SourceFingerprint,
} from './customSourceDedupe'

// 读取请求体
async function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: any[] = []
        req.on('data', chunk => { chunks.push(chunk) })
        req.on('end', () => {
            const buffer = Buffer.concat(chunks)
            resolve(buffer.toString('utf-8'))
        })
        req.on('error', reject)
    })
}

// 验证脚本
export async function handleValidate(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = await readBody(req)
        const { script, username, allowUnsafeVM } = JSON.parse(body)

        // 鉴权逻辑：只有已登录用户（非 default）可以免密码验证
        const targetOwner = (username && username !== 'default') ? username : 'open'
        if (targetOwner === 'open') {
            const auth = req.headers['x-user-token']
            if (!isAdminRequest(req, auth)) {
                res.writeHead(403, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, error: '权限不足：管理自定义源需要先验证管理员身份。' }))
                return
            }
        }

        if (!script || typeof script !== 'string') {
            throw new Error('Invalid script content')
        }

        const metadata = extractMetadata(script)

        // 尝试加载验证
        // persist:false —— 校验用的临时实例不登记进 loadedApis，否则每次上传
        // 都会留下一个永不回收的 VM
        const result = await loadUserApi({
            id: 'temp_validation',
            script,
            enabled: false,
            allowUnsafeVM: !!allowUnsafeVM,
            ...metadata,
            owner: 'temp' // 临时验证 owner
        } as any, { persist: false })

        if (result.success) {
            // 检查是否注册了任何源
            const api = result.apiInstance
            const sources = api?.info?.sources || {}
            const sourcesCount = Object.keys(sources).length

            if (sourcesCount === 0) {
                throw new Error('脚本没有注册任何音源。请确保脚本正确调用了 lx.send("inited", { sources: {...} })')
            }

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
                valid: true,
                metadata,
                sources: Object.keys(sources),
                sourcesCount
            }))
        } else {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
                valid: false,
                error: result.error,
                requireUnsafe: result.requireUnsafe,
                disabledVM: result.requireUnsafe && !global.lx.config['system.allowUnsafeVM'],
                metadata // 即使验证失败也返回元数据，方便前端展示
            }))
        }
    } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ valid: false, error: err.message }))
    }
}

// 辅助函数：获取脚本信息（元数据和支持的源）
async function getScriptInfo(scriptContent: string, allowUnsafeVM: boolean = false) {
    const metadata = extractMetadata(scriptContent)

    // 试运行脚本以获取支持的源
    let supportedSources: string[] = []
    let requireUnsafe = false
    try {
        const result = await loadUserApi({
            id: 'temp_analysis_' + Date.now(),
            script: scriptContent,
            enabled: false,
            allowUnsafeVM,
            ...metadata,
            owner: 'temp'
        } as any, { persist: false })

        if (result.success && result.apiInstance?.info?.sources) {
            supportedSources = Object.keys(result.apiInstance.info.sources)
        } else {
            requireUnsafe = !!result.requireUnsafe
        }
    } catch (e: any) {
        console.warn('[自定义源] 分析脚本支持源失败:', e.message)
    }

    return { metadata, supportedSources, requireUnsafe }
}

// 辅助函数：获取源存储目录
function getSourceDir(username?: string) {
    const dataPath = process.env.DATA_PATH || path.join(process.cwd(), 'data')
    const root = path.join(dataPath, 'users', 'source')
    // 如果 username 是 'open' 或 'default' 或空，则映射到 _open
    const targetDirName = (username && username !== 'default' && username !== 'open') ? username : '_open'
    return path.join(root, targetDirName)
}

/** 读 sources.json；损坏或不存在都当空列表，避免批量导入被一条脏数据整体卡死。 */
function readSourcesMeta(dir: string): any[] {
    const metaPath = path.join(dir, 'sources.json')
    if (!fs.existsSync(metaPath)) return []
    try {
        const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        return Array.isArray(parsed) ? parsed : []
    } catch (e) {
        console.warn('[自定义源] sources.json 解析失败，按空列表处理:', metaPath, e)
        return []
    }
}

/** 给现有源补上内容哈希与版本，供批量导入判重 / 判断是否该覆盖。 */
function fingerprintExistingSources(dir: string, owner: string): SourceFingerprint[] {
    return readSourcesMeta(dir).map(source => {
        let contentHash = ''
        // sources.json 里的 version 可能是数字（老数据），统一成字符串再比
        let version: string | undefined = source.version != null ? String(source.version) : undefined
        try {
            const scriptPath = path.join(dir, String(source.id || ''))
            if (source.id && fs.existsSync(scriptPath)) {
                const text = fs.readFileSync(scriptPath, 'utf-8')
                contentHash = hashSourceContent(text)
                // 【为什么以脚本里的 @version 为准】sources.json 的 version 字段是
                // 导入那一刻记下的快照；脚本被覆盖/手工替换过时它会过期。
                // 去重要比的是「磁盘上这份脚本现在是几版」，所以优先读脚本头。
                const meta = extractMetadata(text)
                if (meta.version != null) version = String(meta.version)
            }
        } catch (e) {
            // 单个源读不到内容不影响其它源的判重
        }
        return {
            id: source.id,
            name: source.name,
            sourceUrl: source.sourceUrl,
            contentHash,
            owner,
            version,
        }
    })
}

interface BatchImportResultItem {
    index: number
    input: string
    name?: string
    id?: string
    status: 'imported' | 'skipped' | 'failed'
    reason?: string
    code?: string
}

/**
 * 单条链接的完整抓取：算 URL → 建代理 agent → 抓正文。
 *
 * 【为什么单独抽出来】批量循环里那条 `withTimeout(...)` 需要一个可传入的 Promise；
 * 把这几步内联在循环里，就没法给整条链路套截止时间（`await` 已经散开了）。
 * 抽成函数后，**整段**（含代理 agent 构建）都在同一个超时保护之下。
 */
async function importOneByUrl(
    raw: unknown,
    useProxy: boolean,
    _budgetMs: number,
): Promise<{ content: string; sourceUrl: string; filename: string }> {
    const plan = buildFetchPlan({ url: raw, useProxy })
    const agent = plan.proxyCategory ? await getProxyAgent(plan.url, plan.proxyCategory) : undefined
    const fetched = await fetchSourceScript(plan, { agent })
    return {
        content: fetched.content,
        sourceUrl: fetched.finalUrl,
        filename: basenameFromUrl(plan.url) || 'unknown_source.js',
    }
}

interface BatchImportPayload {
    urls?: unknown
    files?: unknown
    username?: string
    allowUnsafeVM?: boolean
    useProxy?: boolean
}

/**
 * 批量导入音源（链接 / 本地脚本共用一套逻辑）。
 *
 * 设计取舍：
 * - 逐条处理、逐条返回结果：一条链接抓取失败不应该让整批 10 个源全部回滚；
 * - 批量内也判重：同一批里重复粘贴的链接、同一份脚本换文件名，只入第一个；
 * - 与已有源按「id / 内容哈希 / 原始链接」三重判重，命中就跳过并说明原因；
 * - 公开源只参与「内容/链接」判重（把 id 清空），保留用户用同名私有源覆盖公开源的既有能力。
 */
async function handleBatchImport(req: IncomingMessage, res: ServerResponse, kind: 'url' | 'upload') {
    let payload: BatchImportPayload
    try {
        payload = JSON.parse((await readBody(req)) || '{}')
    } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: '请求体不是合法 JSON' }))
        return
    }

    const rawItems = kind === 'url' ? payload.urls : payload.files
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: kind === 'url' ? '请至少填写一条音源链接' : '请至少选择一个脚本文件' }))
        return
    }
    if (rawItems.length > SOURCE_BATCH_LIMIT) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: `一次最多导入 ${SOURCE_BATCH_LIMIT} 个音源，请分批导入。` }))
        return
    }
    if (kind === 'upload') {
        // 防止一次请求把整个进程内存吃满：单文件另有 2MB 上限，这里再兜总大小。
        const totalBytes = rawItems.reduce((sum: number, item: any) => (
            sum + (typeof item?.content === 'string' ? Buffer.byteLength(item.content, 'utf-8') : 0)
        ), 0)
        if (totalBytes > 50 * 1024 * 1024) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, error: '本批脚本总大小超过 50MB，请分批导入。' }))
            return
        }
    }

    const targetOwner = (payload.username && payload.username !== 'default') ? payload.username : 'open'
    const auth = req.headers['x-user-token']
    const isAdmin = isAdminRequest(req, auth)

    // 与单条导入保持同一套权限：公共源、或勾选允许不安全 VM，必须是管理员。
    if (targetOwner === 'open' && !isAdmin) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: '公共源管理已受限，仅管理员可操作。' }))
        return
    }
    if (payload.allowUnsafeVM && !isAdmin) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: '允许以 VM 模式运行脚本需要验证管理员身份。' }))
        return
    }

    const sourcesDir = getSourceDir(payload.username)
    const metaPath = path.join(sourcesDir, 'sources.json')
    if (!fs.existsSync(sourcesDir)) fs.mkdirSync(sourcesDir, { recursive: true })

    const sources = readSourcesMeta(sourcesDir)
    const existing: SourceFingerprint[] = fingerprintExistingSources(sourcesDir, targetOwner)
    if (targetOwner !== 'open') {
        // 公开源只按内容/链接判重：id 置空，避免阻止「同名私有源覆盖公开源」的既有用法。
        const openDir = getSourceDir('open')
        for (const fp of fingerprintExistingSources(openDir, 'open')) existing.push({ ...fp, id: undefined })
    }

    const results: BatchImportResultItem[] = []
    const seenBatchUrls = new Set<string>()
    let imported = 0
    let skipped = 0
    let failed = 0
    // 整批的绝对截止时间：逐条串行时，任何一条卡住都不能把整批拖成无限等待。
    const batchDeadline = Date.now() + SOURCE_BATCH_TOTAL_TIMEOUT_MS
    /** 距离整批截止还剩多少毫秒（可能为负）。 */
    const deadlineLeft = () => batchDeadline - Date.now()

    for (let index = 0; index < rawItems.length; index++) {
        const raw: any = rawItems[index]
        const input = kind === 'url'
            ? String(raw ?? '').trim()
            : String(raw?.filename || '').trim()

        // 同一批里重复粘贴的链接直接跳过，不再重复抓取（前端也会先做一次去重）。
        if (kind === 'url' && input) {
            const normalized = normalizeSourceUrl(input)
            if (seenBatchUrls.has(normalized)) {
                skipped++
                results.push({ index, input, status: 'skipped', reason: '同一批次里重复的链接' })
                continue
            }
            seenBatchUrls.add(normalized)
        }

        // 总预算用完：剩余条目不再尝试，直接如实标记（不假装成功、也不悬挂）。
        const batchLeft = deadlineLeft()
        if (batchLeft <= 0) {
            failed++
            results.push({
                index,
                input: input || `第 ${index + 1} 项`,
                status: 'failed',
                code: 'BATCH_TIMEOUT',
                reason: `整批导入已超过 ${Math.round(SOURCE_BATCH_TOTAL_TIMEOUT_MS / 1000)} 秒上限，本条未处理。请分批导入或检查链接可达性。`,
            })
            continue
        }

        try {
            if (kind === 'url' && !input) throw new SourceImportError('链接为空')
            if (kind === 'upload' && (!raw || typeof raw.content !== 'string')) {
                throw new SourceImportError('缺少脚本内容')
            }

            let content = ''
            let filename = ''
            let sourceUrl: string | undefined

            if (kind === 'url') {
                // 单条的端到端上限 = min(单条预算, 整批剩余)，两层都不放过。
                const itemBudget = Math.min(SOURCE_IMPORT_ITEM_TIMEOUT_MS, batchLeft)
                // 单条预算被整批压缩时，文案要说明「是整批快到期」，不能只说一个
                // 与「单条 25 秒」矛盾的秒数。
                const squeezed = batchLeft < SOURCE_IMPORT_ITEM_TIMEOUT_MS
                const item = await withTimeout(
                    importOneByUrl(raw, !!payload.useProxy, itemBudget),
                    itemBudget,
                    squeezed
                        ? describeBatchBudgetExhausted(SOURCE_BATCH_TOTAL_TIMEOUT_MS, batchLeft)
                        : undefined,
                )
                content = item.content
                sourceUrl = item.sourceUrl
                filename = item.filename
            } else {
                content = raw.content
                filename = String(raw.filename || 'uploaded-source.js')
            }

            const normalized = normalizeSourceContent(content)
            if (!normalized.ok) throw new SourceImportError(normalized.error)
            content = normalized.content
            if (Buffer.byteLength(content, 'utf-8') > SOURCE_MAX_BYTES) {
                throw new SourceImportError(sizeLimitError())
            }

            // 脚本试运行（VM 初始化）也要有截止时间：脚本里若有个永不 resolve 的
            // 顶层 await，`lx.send('inited')` 就永远等不到，这里会一直挂着。
            // 内部 init 有 3s 超时，但那是「等 inited」本身；外层再兜一次更保险。
            const infoBudget = Math.min(SOURCE_IMPORT_ITEM_TIMEOUT_MS, Math.max(1000, deadlineLeft()))
            const { metadata, supportedSources, requireUnsafe } = await withTimeout(
                getScriptInfo(content, !!payload.allowUnsafeVM),
                infoBudget,
                `解析脚本超时（${Math.round(infoBudget / 1000)} 秒内脚本没有初始化完成），请确认这是音源脚本。`,
            )
            const displayName = metadata.name || filename
            if (!requireUnsafe && supportedSources.length === 0) {
                throw new SourceImportError('脚本没有注册任何音源，请确认选的是音源脚本而不是普通 JS 文件。')
            }

            // 需要原生 VM 的脚本逐条判断，不让一条危险脚本拖垮整批导入。
            if (requireUnsafe) {
                if (!isAdmin) {
                    failed++
                    results.push({ index, input, name: displayName, status: 'failed', code: 'ADMIN_REQUIRED', reason: '该脚本需要原生 VM 模式，仅管理员可导入。' })
                    continue
                }
                if (!global.lx.config['system.allowUnsafeVM']) {
                    failed++
                    results.push({ index, input, name: displayName, status: 'failed', code: 'VM_DISABLED', reason: '服务器已禁用 VM 模式，该脚本无法运行。' })
                    continue
                }
                if (!payload.allowUnsafeVM) {
                    failed++
                    results.push({ index, input, name: displayName, status: 'failed', code: 'REQUIRE_UNSAFE_VM', reason: '该脚本需要原生 VM 模式，请勾选「允许不安全 VM」后重试。' })
                    continue
                }
            }

            const id = sourceIdFromName(metadata.name, filename)
            const contentHash = hashSourceContent(content)
            const candidate = {
                id,
                name: displayName,
                sourceUrl,
                contentHash,
                // v2.49.3：把版本带进判重，同名时才能决定「覆盖」还是「跳过」
                version: metadata.version != null ? String(metadata.version) : undefined,
            }
            const hit = findDuplicateSource(candidate, existing)

            /* 【v2.49.3：同名新版本 → 覆盖】 */
            if (hit && hit.action !== 'overwrite') {
                skipped++
                results.push({ index, input, name: displayName, id, status: 'skipped', reason: describeDuplicate(hit) })
                continue
            }

            // 覆盖分支：源 id 一定命中已有条目，就地替换文件 + 元数据，
            // 并**保留用户的 enabled / 排序**等使用状态（换版本不该把源关掉）。
            const overwriting = !!hit
            const prevSource = overwriting
                ? sources.find((s: any) => s.id === id)
                : undefined

            fs.writeFileSync(path.join(sourcesDir, id), content, 'utf-8')
            const newSource = {
                id,
                name: displayName,
                version: metadata.version || '1.0.0',
                author: metadata.author || '未知',
                description: metadata.description || '',
                homepage: metadata.homepage || '',
                size: Buffer.byteLength(content, 'utf-8'),
                supportedSources,
                // 覆盖时继承原有启用状态与上传时间：用户只是换版本，
                // 不该被「换完变成关闭状态」或「上传时间被刷掉」打扰。
                enabled: prevSource ? !!prevSource.enabled : false,
                uploadTime: prevSource?.uploadTime || new Date().toISOString(),
                sourceUrl,
                allowUnsafeVM: !!requireUnsafe || !!payload.allowUnsafeVM,
                requireUnsafe: !!requireUnsafe,
            }

            if (overwriting) {
                const at = sources.findIndex((s: any) => s.id === id)
                if (at >= 0) sources[at] = { ...sources[at], ...newSource }
                else sources.push(newSource)
                // 指纹同步成新版本，避免同一批里后续条目又命中旧指纹
                const fpAt = existing.findIndex((f) => f.id === id && f.owner === targetOwner)
                const nextFp = { id, name: newSource.name, sourceUrl, contentHash, owner: targetOwner, version: metadata.version != null ? String(metadata.version) : undefined }
                if (fpAt >= 0) existing[fpAt] = nextFp
                else existing.push(nextFp)

                imported++
                results.push({
                    index,
                    input,
                    name: newSource.name,
                    id,
                    status: 'imported',
                    reason: describeDuplicate(hit as any),
                    code: 'OVERWRITTEN',
                })
                continue
            }

            sources.push(newSource)
            existing.push({ id, name: newSource.name, sourceUrl, contentHash, owner: targetOwner })
            imported++
            results.push({ index, input, name: newSource.name, id, status: 'imported' })
        } catch (e: any) {
            failed++
            results.push({
                index,
                input: input || `第 ${index + 1} 项`,
                status: 'failed',
                code: e instanceof SourceImportError ? 'IMPORT_ERROR' : 'UNKNOWN',
                reason: e?.message || String(e),
            })
        }
    }

    if (imported > 0) {
        fs.writeFileSync(metaPath, JSON.stringify(sources, null, 2))
        try {
            await initUserApis(targetOwner)
        } catch (e: any) {
            console.warn('[自定义源] 批量导入后重新加载失败:', e?.message || e)
        }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
        success: true,
        summary: { total: rawItems.length, imported, skipped, failed },
        results,
    }))
}

/** 批量按链接导入音源（每行一个链接）。 */
export async function handleBatchImportUrls(req: IncomingMessage, res: ServerResponse) {
    return handleBatchImport(req, res, 'url')
}

/** 批量按本地脚本文件导入音源（可多选）。 */
export async function handleBatchUploadFiles(req: IncomingMessage, res: ServerResponse) {
    return handleBatchImport(req, res, 'upload')
}

// 上传脚本
export async function handleUpload(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = await readBody(req)
        const { filename, content, username, allowUnsafeVM } = JSON.parse(body)

        // 确定 owner 用于后续标识
        const targetOwner = (username && username !== 'default') ? username : 'open'

        // 检查权限限制 (针对公开源)
        if (targetOwner === 'open') {
            const auth = req.headers['x-user-token']
            if (!isAdminRequest(req, auth)) {
                res.writeHead(403, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, error: '公共源管理已受限，仅管理员可操作。' }))
                return
            }
        }

        const sourcesDir = getSourceDir(username)
        const metaPath = path.join(sourcesDir, 'sources.json')

        // 创建目录
        if (!fs.existsSync(sourcesDir)) {
            fs.mkdirSync(sourcesDir, { recursive: true })
        }

        // 获取脚本信息
        const { metadata, supportedSources, requireUnsafe } = await getScriptInfo(content, allowUnsafeVM)

        // 核心安全校验：若脚本需要或者指定了 unsafe VM 模式，则必须验证管理员身份
        if (requireUnsafe || allowUnsafeVM) {
            const auth = req.headers['x-user-token']
            if (!isAdminRequest(req, auth)) {
                res.writeHead(403, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, error: '允许以 VM 模式运行脚本需要验证管理员身份。' }))
                return
            }
        }

        // 如果检测到需要不安全模式
        if (requireUnsafe) {
            // 如果系统已禁用 VM 模式
            if (!global.lx.config['system.allowUnsafeVM']) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, disabledVM: true, error: 'VM_DISABLED', message: '已禁用VM。该脚本需要原生 VM 模式运行，但服务器后台已禁用 VM 模式。' }))
                return
            }

            // 如果未提供标志，则要求确认
            if (!allowUnsafeVM) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, requireUnsafe: true, message: '该脚本需要原生 VM 模式运行，可能存在安全风险，是否继续？' }))
                return
            }
        }

        // 生成唯一ID（可读的文件名）
        const id = sourceIdFromName(metadata.name, filename)
        const scriptPath = path.join(sourcesDir, id)

        // 读取现有列表
        let sources: any[] = []
        if (fs.existsSync(metaPath)) {
            sources = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        }

        // 检查是否已存在
        const existing = sources.find(s => s.id === id)
        if (existing) {
            throw new Error(`源 "${metadata.name || filename}" 已存在于 [${targetOwner}]`)
        }

        // 保存脚本文件
        fs.writeFileSync(scriptPath, content, 'utf-8')

        // 更新元数据
        sources.push({
            id,
            name: metadata.name || filename,
            version: metadata.version || '1.0.0',
            author: metadata.author || '未知',
            description: metadata.description || '',
            homepage: metadata.homepage || '',
            size: Buffer.byteLength(content, 'utf-8'),
            supportedSources, // 保存支持的源
            enabled: false, // 默认禁用
            uploadTime: new Date().toISOString(),
            allowUnsafeVM: !!requireUnsafe || !!allowUnsafeVM,
            requireUnsafe: !!requireUnsafe
        })

        fs.writeFileSync(metaPath, JSON.stringify(sources, null, 2))

        // 重新加载该用户的API
        await initUserApis(targetOwner)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, id, metadata, supportedSources, owner: targetOwner, allowUnsafeVM: !!requireUnsafe || !!allowUnsafeVM }))
    } catch (err: any) {
        console.error('[自定义源] 上传失败:', err)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: err.message }))
    }
}

// 从远程URL导入脚本
export async function handleImport(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = await readBody(req)
        const { url, filename, username, allowUnsafeVM, useProxy } = JSON.parse(body)

        if (!url) {
            throw new Error('Missing URL')
        }

        // ⑥ 链接导入：统一走「默认直连、勾选才走代理」的抓取计划（见 customSourceUrl.ts）。
        // 以前只要全局 app 代理开着就强制走代理 —— NAS 上 customSource 经代理会 ECONNRESET。
        // 现在：协议白名单 + 回环/元数据地址拦截 + 逐跳重定向校验 + 2MB 流式上限 + 20s 整体超时。
        //
        // v2.49.2：整条链路（抓取 + 代理 agent 构建 + VM 试运行）套一个**绝对截止时间**。
        // 原来的 20s 只是 socket 级超时，DNS 挂起 / 脚本 init 不返回时界面会一直转圈。
        const itemBudget = SOURCE_IMPORT_ITEM_TIMEOUT_MS
        const { content, finalUrl, metadata, supportedSources, requireUnsafe } = await withTimeout(
            (async () => {
                const plan = buildFetchPlan({ url, useProxy: !!useProxy })
                const agent = plan.proxyCategory ? await getProxyAgent(plan.url, plan.proxyCategory) : undefined
                const fetched = await fetchSourceScript(plan, { agent })
                const info = await getScriptInfo(fetched.content, allowUnsafeVM)
                return { content: fetched.content, finalUrl: fetched.finalUrl, ...info }
            })(),
            itemBudget,
        )

        // 核心安全校验：若脚本需要或者指定了 unsafe VM 模式，则必须验证管理员身份
        if (requireUnsafe || allowUnsafeVM) {
            const auth = req.headers['x-user-token']
            if (!isAdminRequest(req, auth)) {
                res.writeHead(403, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, error: '允许以 VM 模式运行脚本需要验证管理员身份。' }))
                return
            }
        }

        // 如果检测到需要不安全模式
        if (requireUnsafe) {
            // 如果系统已禁用 VM 模式
            if (!global.lx.config['system.allowUnsafeVM']) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, disabledVM: true, error: 'VM_DISABLED', message: '已禁用VM。该脚本需要原生 VM 模式运行，但服务器后台已禁用 VM 模式。' }))
                return
            }

            // 如果未提供标志，则要求确认
            if (!allowUnsafeVM) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, requireUnsafe: true, message: '该脚本需要原生 VM 模式运行，可能存在安全风险，是否继续？' }))
                return
            }
        }

        const targetOwner = (username && username !== 'default') ? username : 'open'

        // 检查权限限制
        if (targetOwner === 'open') {
            const auth = req.headers['x-user-token']
            if (!isAdminRequest(req, auth)) {
                res.writeHead(403, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, error: '公共源导入已受限，仅管理员可操作。' }))
                return
            }
        }

        const sourcesDir = getSourceDir(username)
        const metaPath = path.join(sourcesDir, 'sources.json')

        // 创建目录
        if (!fs.existsSync(sourcesDir)) {
            fs.mkdirSync(sourcesDir, { recursive: true })
        }

        // 生成唯一ID（可读的文件名）
        const displayName = metadata.name || filename || 'unknown_source'
        const id = sourceIdFromName(metadata.name, filename || 'unknown_source')
        const scriptPath = path.join(sourcesDir, id)

        // 读取现有列表
        let sources: any[] = []
        if (fs.existsSync(metaPath)) {
            sources = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        }

        // 检查是否已存在
        const existing = sources.find(s => s.id === id)
        if (existing) {
            throw new Error(`源 "${displayName}" 已存在于 [${targetOwner}]`)
        }

        // 保存脚本文件
        fs.writeFileSync(scriptPath, content, 'utf-8')

        // 更新元数据
        sources.push({
            id,
            name: metadata.name || filename,
            version: metadata.version || '1.0.0',
            author: metadata.author || '未知',
            description: metadata.description || '',
            homepage: metadata.homepage || '',
            size: Buffer.byteLength(content, 'utf-8'),
            supportedSources, // 保存支持的源
            enabled: false,
            uploadTime: new Date().toISOString(),
            sourceUrl: finalUrl,
            allowUnsafeVM: !!requireUnsafe || !!allowUnsafeVM,
            requireUnsafe: !!requireUnsafe
        })

        fs.writeFileSync(metaPath, JSON.stringify(sources, null, 2))

        // 重新加载
        await initUserApis(targetOwner)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, filename: displayName, id, metadata, supportedSources, owner: targetOwner, allowUnsafeVM: !!requireUnsafe || !!allowUnsafeVM }))
    } catch (err: any) {
        console.error('[自定义源] 导入失败:', err)
        // 用户可修正的错误（链接非法/超限/拿到 HTML）回 400，前端能直接把文案显示出来；
        // 其它（磁盘、VM 初始化等）才算 500。
        const status = err instanceof SourceImportError ? err.status : 500
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: err.message }))
    }
}

// 获取列表
// 如果提供了 username，返回 open + username 的源
// 如果没提供，只返回 open 的源
export async function handleList(req: IncomingMessage, res: ServerResponse, username: string) {
    const openSources: any[] = []
    const userSources: any[] = []

    // 1. 读取 Open 源
    const openSourcesDir = getSourceDir('open') // -> .../_open
    const openMetaPath = path.join(openSourcesDir, 'sources.json')

    if (fs.existsSync(openMetaPath)) {
        try {
            const parsedOpenSources = JSON.parse(fs.readFileSync(openMetaPath, 'utf-8'))
            parsedOpenSources.forEach((s: any) => {
                s.owner = 'open'
                s.isPublic = true
                openSources.push(s)
            })
        } catch (e) { }
    }

    // 2. 读取 User 源 (如果有)
    let userStates: Record<string, any> = {}
    const targetStatesOwner = (username && username !== 'default') ? username : 'open'
    const statesDir = getSourceDir(targetStatesOwner)
    const userStatesPath = path.join(statesDir, 'states.json')
    if (fs.existsSync(userStatesPath)) {
        try {
            userStates = JSON.parse(fs.readFileSync(userStatesPath, 'utf-8'))
        } catch (e) { }
    }

    if (username && username !== 'default') {
        const userSourcesDir = getSourceDir(username)
        const userMetaPath = path.join(userSourcesDir, 'sources.json')

        if (fs.existsSync(userMetaPath)) {
            try {
                const parsedUserSources = JSON.parse(fs.readFileSync(userMetaPath, 'utf-8'))
                parsedUserSources.forEach((s: any) => {
                    s.owner = username
                    s.isPublic = false
                    userSources.push(s)
                })
            } catch (e) { }
        }
    }

    // 合并列表：如果公开源和用户源存在相同ID，则排除公开源
    const allSources: any[] = []
    const userSourceIds = new Set(userSources.map(s => s.id))

    openSources.forEach((s: any) => {
        if (!userSourceIds.has(s.id)) {
            if (userStates[s.id] && typeof userStates[s.id].enabled === 'boolean') {
                s.enabled = userStates[s.id].enabled
            }
            allSources.push(s)
        }
    })

    allSources.push(...userSources)

    // 补充运行时状态及禁用平台配置
    const enrichedSources = allSources.map((source: any) => {
        // 合并运行时状态
        const status = getApiStatus(source.owner, source.id)
        if (status) {
            source.status = status.status
            source.error = status.error
            if (status.updateAlert) {
                source.updateAlert = status.updateAlert
            }
        }

        // 实测响应耗时（毫秒）。与 status 同一性质 —— 都是「这个源现在怎么样」的运行时信息，
        // 放在这里前端无需额外请求即可展示「哪个源快」。无样本时不写该字段（而非写 0），
        // 因为 0ms 会被误读成「极快」，而真相是「还没测过」。
        const ms = getSourceSpeed(source.id, source.owner)
        if (ms !== null) source.speedMs = Math.round(ms)

        // 读取对应音源的禁用平台列表
        const stateObj = userStates[source.id] || (userStates[decodeURIComponent(source.id)]) || (userStates[encodeURIComponent(source.id)]) || {}
        source.disabledSources = Array.isArray(stateObj.disabledSources) ? stateObj.disabledSources : []

        return source
    })

    // ===== 自定义合并后的排序逻辑 =====
    let targetOwner = (username && username !== 'default') ? username : 'open'
    let orderPath = path.join(getSourceDir(targetOwner), 'order.json')
    let order: string[] = []

    if (!fs.existsSync(orderPath) && targetOwner !== 'open') {
        // 未保存私有排序则尝试获取公开排序
        orderPath = path.join(getSourceDir('open'), 'order.json')
    }

    if (fs.existsSync(orderPath)) {
        try {
            order = JSON.parse(fs.readFileSync(orderPath, 'utf-8'))
        } catch (e) { }
    }

    if (order.length > 0) {
        const idToIndex = new Map(order.map((id, index) => [id, index]))
        enrichedSources.sort((a, b) => {
            // 永远保持“已启用”在前的分组逻辑
            if (a.enabled !== b.enabled) {
                return a.enabled ? -1 : 1
            }

            // 同组内根据保存的绝对顺序排序
            const indexA = idToIndex.has(a.id) ? idToIndex.get(a.id)! : 999999
            const indexB = idToIndex.has(b.id) ? idToIndex.get(b.id)! : 999999

            if (indexA !== indexB) {
                return indexA - indexB
            }
            return 0
        })
    } else {
        // 默认让启用的在前，禁用的在后
        enrichedSources.sort((a, b) => {
            if (a.enabled !== b.enabled) {
                return a.enabled ? -1 : 1
            }
            return 0
        })
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(enrichedSources))
}

// 启用/禁用
// 启用/禁用
export async function handleToggle(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = await readBody(req)
        const { id, sourceId, enabled, username, allowUnsafeVM } = JSON.parse(body)
        const targetId = id || sourceId

        let targetOwner = (username && username !== 'default') ? username : 'open'

        // 检查权限限制
        if (targetOwner === 'open') {
            const auth = req.headers['x-user-token']
            if (!isAdminRequest(req, auth)) {
                res.writeHead(403, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, error: '公共源状态切换已受限，仅管理员可操作。' }))
                return
            }
        }

        let sourcesDir = getSourceDir(targetOwner)
        let metaPath = path.join(sourcesDir, 'sources.json')

        let target: any = null
        let sources: any[] = []
        let isPublicSourceToggle = false

        if (!fs.existsSync(sourcesDir)) {
            fs.mkdirSync(sourcesDir, { recursive: true })
        }

        if (fs.existsSync(metaPath)) {
            sources = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
            target = sources.find((s: any) => s.id === targetId)
        }

        if (!target && targetOwner !== 'open') {
            // 尝试看看是否是普通用户在切换公共源
            const openSourcesDir = getSourceDir('open')
            const openMetaPath = path.join(openSourcesDir, 'sources.json')
            if (fs.existsSync(openMetaPath)) {
                const openSources = JSON.parse(fs.readFileSync(openMetaPath, 'utf-8'))
                const openTarget = openSources.find((s: any) => s.id === targetId)
                if (openTarget) {
                    target = openTarget
                    isPublicSourceToggle = true
                }
            }
        }

        if (!target) {
            throw new Error('源不存在')
        }

        // 核心安全逻辑：
        // 1. 如果正在执行的是公共源个人状态切换 (isPublicSourceToggle === true)
        //    则只需在 server.ts 层面保证用户已登录即可，不需要额外的管理员密码。
        // 2. 如果正在修改的是全局公共源 (targetOwner === 'open')
        //    则必须校验管理员密码。
        if (targetOwner === 'open') {
            const auth = req.headers['x-user-token']
            if (!isAdminRequest(req, auth)) {
                res.writeHead(403, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, error: '权限不足：管理全局公开自定义源需要验证管理员身份。' }))
                return
            }
        }

        if (isPublicSourceToggle) {
            // 普通用户独立记录公开源的开启/关闭状态，不修改公开源属性
            const userStatesPath = path.join(sourcesDir, 'states.json')
            let states: any = {}
            if (fs.existsSync(userStatesPath)) {
                try { states = JSON.parse(fs.readFileSync(userStatesPath, 'utf-8')) } catch (e) { }
            }
            if (!states[targetId]) states[targetId] = {}
            states[targetId].enabled = enabled !== undefined ? enabled : !(states[targetId].enabled ?? target.enabled)
            fs.writeFileSync(userStatesPath, JSON.stringify(states, null, 2))

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, enabled: states[targetId].enabled }))
            return
        }

        const oldEnabled = target.enabled
        const oldAllowUnsafeVM = !!target.allowUnsafeVM

        // 核心安全校验：如果试图开启 VM 模式（或当前就是 VM 模式），必须要验证管理员密码
        if (target.allowUnsafeVM || allowUnsafeVM) {
            const auth = req.headers['x-user-token']
            if (!isAdminRequest(req, auth)) {
                res.writeHead(403, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, error: '开启/运行 VM 模式脚本需要验证管理员身份。' }))
                return
            }
        }

        // 修改逻辑：只有当参数明确为 true 时才更新为 true，防止被默认值 false 覆盖
        if (allowUnsafeVM === true) target.allowUnsafeVM = true
        target.enabled = enabled !== undefined ? enabled : !target.enabled

        fs.writeFileSync(metaPath, JSON.stringify(sources, null, 2))

        // 重新加载
        try {
            await initUserApis(targetOwner)

            // 如果是尝试启用，检查启用后的实时状态
            if (target.enabled) {
                const status = getApiStatus(targetOwner, targetId)
                const isRequireUnsafe = !allowUnsafeVM && !oldAllowUnsafeVM && !!(status && status.status === 'failed' && status.error && (
                    status.error === 'REQUIRE_UNSAFE_VM' ||
                    status.error.includes('初始化超时') ||
                    status.error.includes('timeout')
                ))
                if (isRequireUnsafe) {
                    console.warn(`[自定义源] 开启目标 ${targetId} 时触发超时或依赖 REQUIRE_UNSAFE_VM，已回滚...`)
                    // 回滚状态
                    target.enabled = oldEnabled
                    target.allowUnsafeVM = oldAllowUnsafeVM
                    fs.writeFileSync(metaPath, JSON.stringify(sources, null, 2))
                    await initUserApis(targetOwner)

                    // 如果系统已禁用 VM 模式，直接提示已禁用
                    if (!global.lx.config['system.allowUnsafeVM']) {
                        res.writeHead(200, { 'Content-Type': 'application/json' })
                        res.end(JSON.stringify({ success: false, disabledVM: true, error: 'VM_DISABLED', message: '已禁用VM。该脚本需要原生 VM 模式运行，但服务器后台已禁用 VM 模式。' }))
                        return
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' })
                    res.end(JSON.stringify({ success: false, requireUnsafe: true, message: '该脚本需要原生 VM 模式运行，可能存在安全风险，是否继续？' }))
                    return
                }
            }

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, enabled: target.enabled }))
        } catch (e: any) {
            // initUserApis 本身不应抛出这个错误（内部已捕获并记录 status），但为了健壮性保留此判断
            const isRequireUnsafe = !allowUnsafeVM && !oldAllowUnsafeVM && !!(e && e.message && (
                e.message === 'REQUIRE_UNSAFE_VM' ||
                e.message.includes('初始化超时') ||
                e.message.includes('timeout')
            ))
            if (isRequireUnsafe) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, requireUnsafe: true, message: '该脚本需要原生 VM 模式运行，可能存在安全风险，是否继续？' }))
                return
            }
            throw e
        }
    } catch (err: any) {
        console.error('[自定义源] 状态切换异常:', err)
        res.writeHead(500)
        res.end(err.message)
    }
}

// 拖拽排序，更新 sources.json 中源的顺序
export async function handleReorder(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = await readBody(req)
        const { username, sourceIds } = JSON.parse(body)

        if (!Array.isArray(sourceIds)) {
            throw new Error('sourceIds must be an array')
        }

        let targetOwner = (username && username !== 'default') ? username : 'open'

        // 检查权限限制 (公开源排序)
        if (targetOwner === 'open') {
            const auth = req.headers['x-user-token']
            if (!isAdminRequest(req, auth)) {
                res.writeHead(403, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, error: '公共源排序已受限，仅管理员可操作。' }))
                return
            }
        }

        let sourcesDir = getSourceDir(targetOwner)
        let metaPath = path.join(sourcesDir, 'sources.json')
        let orderPath = path.join(sourcesDir, 'order.json')

        if (!fs.existsSync(sourcesDir)) {
            fs.mkdirSync(sourcesDir, { recursive: true })
        }

        // 保存混合列表的绝对顺序到 order.json（用于 handleList 展示排序）
        fs.writeFileSync(orderPath, JSON.stringify(sourceIds, null, 2))

        // 同时尝试重排各自存在的 sources.json，并记录是否修改了 open 的源
        let openSourcesModified = false

        if (fs.existsSync(metaPath)) {
            const sources = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
            const currentSourcesMap = new Map(sources.map((s: any) => [s.id, s]))
            const newSources: any[] = []

            for (const id of sourceIds) {
                if (currentSourcesMap.has(id)) {
                    newSources.push(currentSourcesMap.get(id))
                    currentSourcesMap.delete(id)
                }
            }
            for (const [id, source] of currentSourcesMap) {
                newSources.push(source)
            }
            fs.writeFileSync(metaPath, JSON.stringify(newSources, null, 2))
        } else if (targetOwner !== 'open') {
            // 用户没有私有源时，重排 open 的 sources.json
            const openSourcesDir = getSourceDir('open')
            const openMetaPath = path.join(openSourcesDir, 'sources.json')
            const openOrderPath = path.join(openSourcesDir, 'order.json')
            if (fs.existsSync(openMetaPath)) {
                const sources = JSON.parse(fs.readFileSync(openMetaPath, 'utf-8'))
                const currentSourcesMap = new Map(sources.map((s: any) => [s.id, s]))
                const newSources: any[] = []

                for (const id of sourceIds) {
                    if (currentSourcesMap.has(id)) {
                        newSources.push(currentSourcesMap.get(id))
                        currentSourcesMap.delete(id)
                    }
                }
                for (const [id, source] of currentSourcesMap) {
                    newSources.push(source)
                }
                fs.writeFileSync(openMetaPath, JSON.stringify(newSources, null, 2))
                // 同时把 order.json 写入 open 目录，供 loadSourcesFromDir 按序加载
                fs.writeFileSync(openOrderPath, JSON.stringify(sourceIds, null, 2))
                openSourcesModified = true
            }
        }

        // 重新加载 API，使新顺序立即生效于解析优先级
        await initUserApis(targetOwner)
        // 若修改了 open 的源顺序，也必须重载 open，否则 loadedApis 里顺序不变
        if (openSourcesModified) {
            await initUserApis('open')
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
    } catch (err: any) {
        console.error('[自定义源] 排序保存异常:', err)
        res.writeHead(500)
        res.end(err.message)
    }
}

// 删除
export async function handleDelete(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = await readBody(req)
        const { id, sourceId, username } = JSON.parse(body)
        const targetId = id || sourceId

        // 查找逻辑同 Toggle
        let targetOwner = (username && username !== 'default') ? username : 'open'

        // 检查权限限制
        if (targetOwner === 'open') {
            const auth = req.headers['x-user-token']
            if (!isAdminRequest(req, auth)) {
                res.writeHead(403, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, error: '公共源删除已受限，仅管理员可操作。' }))
                return
            }
        }

        let sourcesDir = getSourceDir(targetOwner)
        let metaPath = path.join(sourcesDir, 'sources.json')

        // 尝试定位源
        let found = false
        let sources = []

        if (fs.existsSync(metaPath)) {
            sources = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
            if (sources.find((s: any) => s.id === targetId)) {
                found = true
            }
        }

        if (!found && targetOwner !== 'open') {
            const openSourcesDir = getSourceDir('open')
            const openMetaPath = path.join(openSourcesDir, 'sources.json')

            if (fs.existsSync(openMetaPath)) {
                const openSources = JSON.parse(fs.readFileSync(openMetaPath, 'utf-8'))
                if (openSources.find((s: any) => s.id === targetId)) {
                    targetOwner = 'open'
                    sourcesDir = openSourcesDir
                    metaPath = openMetaPath
                    sources = openSources
                    found = true
                }
            }
        }

        if (!found) {
            throw new Error('源不存在')
        }

        // 核心安全逻辑：删除全局公开源必须校验管理员权限
        if (targetOwner === 'open') {
            const auth = req.headers['x-user-token']
            if (!isAdminRequest(req, auth)) {
                res.writeHead(403, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, error: '权限不足：删除全局公共源需要验证管理员身份。' }))
                return
            }
        }

        const scriptPath = path.join(sourcesDir, targetId)
        sources = sources.filter((s: any) => s.id !== targetId)

        // 删除脚本文件
        if (fs.existsSync(scriptPath)) {
            fs.unlinkSync(scriptPath)
        }

        fs.writeFileSync(metaPath, JSON.stringify(sources, null, 2))

        // 重新初始化
        await initUserApis(targetOwner)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
    } catch (err: any) {
        console.error('[自定义源] 删除异常:', err)
        res.writeHead(500)
        res.end(err.message)
    }
}

// 更新音源的平台配置 (关闭/开启部分平台)
export async function handleUpdatePlatforms(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = await readBody(req)
        const { id, sourceId, username, disabledSources } = JSON.parse(body)
        const targetId = id || sourceId

        if (!targetId) {
            throw new Error('缺少音源ID')
        }

        let targetOwner = (username && username !== 'default') ? username : 'open'

        // 核心安全逻辑：如果是全局公开源且为 open 模式，需要验证管理员身份
        if (targetOwner === 'open') {
            const auth = req.headers['x-user-token']
            if (!isAdminRequest(req, auth)) {
                res.writeHead(403, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, error: '权限不足：修改全局公开源平台配置需要管理员身份。' }))
                return
            }
        }

        const sourcesDir = getSourceDir(targetOwner)
        if (!fs.existsSync(sourcesDir)) {
            fs.mkdirSync(sourcesDir, { recursive: true })
        }

        const userStatesPath = path.join(sourcesDir, 'states.json')
        let states: Record<string, any> = {}
        if (fs.existsSync(userStatesPath)) {
            try {
                states = JSON.parse(fs.readFileSync(userStatesPath, 'utf-8'))
            } catch (e) { }
        }

        // 兼容原名、解码后或编码后的 key
        let matchedKey = targetId
        if (!states[matchedKey]) {
            try {
                const decoded = decodeURIComponent(targetId)
                if (states[decoded]) matchedKey = decoded
            } catch (e) { }
        }
        if (!states[matchedKey]) {
            try {
                const encoded = encodeURIComponent(targetId)
                if (states[encoded]) matchedKey = encoded
            } catch (e) { }
        }

        if (!states[matchedKey]) {
            states[matchedKey] = {}
        }

        states[matchedKey].disabledSources = Array.isArray(disabledSources) ? disabledSources : []
        fs.writeFileSync(userStatesPath, JSON.stringify(states, null, 2), 'utf-8')

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
            success: true,
            id: matchedKey,
            disabledSources: states[matchedKey].disabledSources
        }))
    } catch (error: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: error.message }))
    }
}

/**
 * 音源有效性探测：对一个自定义源做一次**真实解析**，返回成功/失败与耗时。
 *
 * 【为什么不是「脚本加载成功」就算有效】
 * 加载成功只说明脚本能跑起来，不代表它现在还能拿到链接 —— 上游接口挂掉、
 * 版本过期（如「独家音源 v6 需 v7」）时脚本照样加载成功。用户要判断的是
 * 「这个源今天还能不能用」，只有走一次 getMusicUrl 才算数。
 *
 * 【为什么要把其它源排除掉】
 * callUserApiGetMusicUrl 会在「同一平台的多个自定义源」之间竞速，不排除的话
 * 测出来可能是**别人**源的耗时与成功率，张冠李戴 —— 那样这个检测就没意义了。
 *
 * 【为什么要先搜一首样本歌】
 * getMusicUrl 需要 songmid 这类平台内标识，不能凭空构造。先用内置平台搜一首
 * 固定样本（周杰伦《晴天》优先，拿不到就取第一条），再拿它去解析。
 */
export async function handleProbe(req: IncomingMessage, res: ServerResponse) {
    const auth = req.headers['x-user-token']
    if (!isAdminRequest(req, auth)) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: '权限不足：音源检测需要管理员身份。' }))
        return
    }

    try {
        const body = JSON.parse((await readBody(req)) || '{}')
        const id = String(body.id || '')
        const platform = String(body.platform || '')
        const owner = String(body.username || 'open')
        if (!id || !platform) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, error: 'Missing id/platform' }))
            return
        }

        const sdk: any = musicSdkRaw
        const searchable = (p: string) => !!(sdk[p]?.musicSearch?.search)

        // 【v2.49.3：平台不要盲取 [0]】
        // 前端传的 platform 是 supportedSources[0]，而那个顺序来自脚本里
        // `Object.keys(sources)` 的声明顺序，**不代表我们服务端能搜**。
        // 若某源把 bilibili 之类放在首位，而 SDK 没有对应 musicSearch，
        // 这里会直接 400「平台 X 不支持搜索」—— 用户看到的就是「不可用」，
        // 但源本身可能完全正常。改为：先试请求的平台，不行就从该源
        // **实际注册的平台**里挑第一个能搜的；一个都没有才如实报「无法检测」。
        if (!id || !platform) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, error: 'Missing id/platform' }))
            return
        }

        const loadedApiEarly: any = getLoadedApi(owner, id)
        const declared: string[] = loadedApiEarly?.info?.sources
            ? Object.keys(loadedApiEarly.info.sources)
            : []
        const candidates = [platform, ...declared].filter((p, i, arr) => p && arr.indexOf(p) === i)
        const chosen = candidates.find(searchable) || ''

        if (!chosen) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
                success: true,
                ok: false,
                // unprobeable = 「测不了」，与「测出来是坏的」必须分开，
                // 否则界面会把正常的源标红，误导用户去删它。
                unprobeable: true,
                ms: 0,
                platform: platform,
                error: `该源声明的平台（${declared.slice(0, 4).join('、') || platform}）都没有内置搜索能力，无法自动检测；不代表源不可用。`,
            }))
            return
        }

        // 1) 取样本歌（用挑好的可搜平台）
        const searchData = await sdk[chosen].musicSearch.search('晴天 周杰伦', 1, 5)
        const list: any[] = searchData?.list || []
        const sample = list[0]
        if (!sample) {
            res.end(JSON.stringify({
                success: true, ok: false, ms: 0, platform: chosen,
                error: '该平台搜不到样本歌，无法检测',
            }))
            return
        }

        // 2) 直接拿这一个源的实例来调用
        //
        // 【为什么不用 callUserApiGetMusicUrl + excludeApiSources】
        // 第一版就是那么写的，实测排除没生效（日志「已尝试 13 个音源」），
        // 测出来的是整个平台竞速的结果，不是这一个源 —— 正是要避免的张冠李戴。
        // 根因是两边的标识格式不一致：sources.json 的 id 是文件名（带 `.js`），
        // 运行时 api.info.id 不带。与其继续猜标识怎么对齐，不如直接取实例调用
        // `musicUrl`：请求发给谁，结果就是谁的，不存在歧义。
        const api: any = getLoadedApi(owner, id)
        if (!api) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
                success: true, ok: false, ms: 0,
                error: '该源未加载（启动时加载失败，或已停用）',
                sample: sample?.name || '',
            }))
            return
        }

        // 3) 真实解析 + 计时
        const started = Date.now()
        let ok = false
        let error = ''
        try {
            const r: any = await Promise.race([
                api.callRequest('musicUrl', platform, {
                    musicInfo: sample,
                    quality: '320k',
                    type: '320k',
                }, { requestTimeoutMs: 15000 }),
                new Promise((_, reject) => {
                    const t = setTimeout(() => reject(new Error('检测超时（20 秒）')), 20000)
                    // 别让这个定时器把进程吊着
                    if (typeof (t as any).unref === 'function') (t as any).unref()
                }),
            ])
            // 与真实取链同一判据：必须是字符串且是 http(s)，否则视为无效
            const url = typeof r === 'string' ? r.trim() : ''
            ok = /^https?:\/\//i.test(url)
            if (!ok) error = '源没有返回可用的 http(s) 链接'
        } catch (e: any) {
            error = e?.message || String(e)
        }
        const ms = Date.now() - started

        // 4) 记进测速表 —— 检测结果同时刷新列表里的「延迟」徽章
        if (ok) recordSourceSpeed(id, ms, owner)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, ok, ms, error, sample: sample?.name || '', platform: chosen }))
    } catch (error: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: error.message }))
    }
}
