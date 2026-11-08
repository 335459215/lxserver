/**
 * 自定义音源导入的去重纯逻辑。
 *
 * 【为什么单独成文件】
 * 去重规则一旦写进 handler，就必须起服务器、造请求、碰文件系统才能验证；
 * 而真正容易被改坏的判断只有三件事：
 *   1. 同一个源换了文件名/链接，内容还是同一份脚本（按内容哈希判）；
 *   2. 同一个链接重复粘贴（按规范化 URL 判）；
 *   3. 同名源重复导入（按 id 判）。
 * 这里保持零 I/O，单测可以直接对拍。
 */
import crypto from 'crypto'
import { basenameFromUrl } from './customSourceUrl'

/** 一次批量导入最多接受的条数，防止误粘贴整份订阅列表把 VM 打满。 */
export const SOURCE_BATCH_LIMIT = 50

export interface SourceFingerprint {
    /** 源 id（通常是「源名.js」）*/
    id?: string
    name?: string
    /** 导入时的原始链接（仅链接导入会记）*/
    sourceUrl?: string
    /** 脚本正文的 sha256；旧 sources.json 没有这个字段，调用方现算 */
    contentHash?: string
    /** open / 用户名；仅用于把命中原因说清楚 */
    owner?: string
    /** 脚本里 `@version` 声明的版本号（v2.49.3 起参与去重比较）*/
    version?: string
}

export interface SourceCandidate {
    id: string
    name?: string
    sourceUrl?: string
    contentHash: string
    /** 待导入脚本的 `@version` */
    version?: string
}

/** 去重命中的**动作**：
 *  - `skip`：已存在且不比新的旧 → 跳过（原有行为）
 *  - `overwrite`：同名但待导入的版本更新 → 覆盖旧的（v2.49.3 新增） */
export type DuplicateAction = 'skip' | 'overwrite'

export interface DuplicateHit {
    kind: 'id' | 'content' | 'url'
    existingId?: string
    existingName?: string
    existingOwner?: string
    /** 命中后该怎么处理，默认按 skip 理解以兼容旧调用点 */
    action?: DuplicateAction
    /** overwrite 时带上新旧版本，用于文案与日志 */
    existingVersion?: string
    candidateVersion?: string
}

/**
 * 版本号比较：a 是否**比** b **新**。
 *
 * 【为什么要自己写】音源脚本的 `@version` 并不都符合 semver：
 * 实测有 `v9.3 93特供版 DeepSeek优化`、`2.2.0`、`1.7.17`、`20240115` 这些形态。
 * 直接字符串比较会把 `v9.3` 判成比 `2.2.0` 新（因为 'v' > '2'），
 * 引入 semver 库又会因为非法版本抛异常、直接丢掉整条导入。
 *
 * 规则（确定性、可单测）：
 *  1. 去掉前导 `v/V` 与空白；
 *  2. 取开头连续的数字段，按 `.` 切成数字数组（`9.3` → [9,3]；`93特供版` → [93]）；
 *  3. 逐段数值比较，缺位补 0（`9.3` > `9`）；
 *  4. 全部相等时判定**不更新**（返回 false）—— 同版本重导视为重复，保持原样；
 *  5. 任一侧没有可解析的数字版本时返回 false（无法判断就不覆盖，保守优先）。
 */
export function isNewerVersion(candidate?: string, existing?: string): boolean {
    const toParts = (v?: string): number[] | null => {
        if (typeof v !== 'string') return null
        const cleaned = v.trim().replace(/^[vV]/, '').trim()
        const m = cleaned.match(/^\d+(?:\.\d+)*/)
        if (!m) return null
        return m[0].split('.').map((n) => Number.parseInt(n, 10))
    }

    const a = toParts(candidate)
    const b = toParts(existing)
    // 任一侧无法解析：不判定为更新（避免把带奇怪后缀的版本当成新版反复覆盖）
    if (!a || !b) return false

    const len = Math.max(a.length, b.length)
    for (let i = 0; i < len; i++) {
        const x = a[i] ?? 0
        const y = b[i] ?? 0
        if (x > y) return true
        if (x < y) return false
    }
    return false
}

/**
 * 生成可读且唯一的源 id（文件名）。
 *
 * 与旧实现逐字符保持一致：中文保留，文件系统非法字符替换为 `_`，
 * 统一移除 `.js` 再补回来，保证「同名源仍是同一个 id」。
 */
export function sourceIdFromName(name?: string, fallbackFilename?: string): string {
    let input = name || fallbackFilename || 'source'

    try {
        input = decodeURIComponent(input)
    } catch {
        // 输入不是合法 URL 编码时保持原样
    }

    // 文件名可能来自 URL、上传文件名或 @name；先按正/反斜杠取最后一段。
    let base = input
    if (/^https?:\/\//i.test(input)) {
        const fromUrl = basenameFromUrl(input)
        if (fromUrl) base = fromUrl
    } else {
        base = input.split(/[\\/]/).pop() || input
    }

    // 音源脚本可能是 .js / .mjs / .cjs；统一去掉扩展名后再补 .js，避免出现 a.mjs.js
    if (/\.(?:js|mjs|cjs)$/i.test(base)) {
        base = base.replace(/\.(?:js|mjs|cjs)$/i, '')
    }

    const clean = base.replace(/[\\/:*?"<>|]/g, '_').trim()
    return `${clean || 'source'}.js`
}

/** 脚本正文的 sha256（十六进制）。 */
export function hashSourceContent(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex')
}

/**
 * 规范化用于判重的 URL。
 *
 * 只做确定性归一：去首尾空白、去 fragment、交给 URL 统一主机大小写/默认端口。
 * 不擅自删除 query（很多音源靠 `?v=2` 区分版本），也不把 http/https 互认。
 */
export function normalizeSourceUrl(input: unknown): string {
    if (typeof input !== 'string') return ''
    const raw = input.trim()
    if (!raw) return ''
    try {
        const parsed = new URL(raw)
        parsed.hash = ''
        return parsed.toString()
    } catch {
        return raw
    }
}

/** 在已有指纹里找同一条源。优先级：id > 内容哈希 > 链接。
 *
 *  【v2.49.3：同名不再一律跳过，先看版本】
 *  用户反馈「同名源去重要看版本，以最新版本、最新导入的为主」。
 *  原实现命中 id（同名）就 skip —— 于是作者发新版时，用户把新脚本导进来
 *  只会得到「同名源已存在」，只能先手动删掉旧的再导，很别扭。
 *
 *  现在的判定：
 *   - **同名 + 新版本更新** → `overwrite`，由 handler 覆盖旧文件与元数据；
 *   - **同名 + 版本相同/更旧/无法比较** → `skip`（保持原行为，绝不降级）；
 *   - **内容哈希相同** → 无论版本号怎么写，都是同一份脚本 → `skip`；
 *   - **链接相同但同名不同版本** → 也按版本走（链接是同一地址、内容更新了）。
 *
 *  注意顺序：先判 id（拿到版本信息），再判内容，最后判 URL。
 *  内容哈希检查必须在 id 之后 —— 否则「同名新版」会因为内容不同而漏掉覆盖机会；
 *  而「同名且内容相同」在 id 那一步就会因版本不更新而 skip，不会误覆盖。
 */
export function findDuplicateSource(
    candidate: SourceCandidate,
    existing: SourceFingerprint[],
): DuplicateHit | null {
    // 1) 同名（同 id）：按版本决定覆盖还是跳过
    for (const item of existing) {
        if (candidate.id && item.id === candidate.id) {
            const newer = isNewerVersion(candidate.version, item.version)
            return {
                kind: 'id',
                existingId: item.id,
                existingName: item.name,
                existingOwner: item.owner,
                action: newer ? 'overwrite' : 'skip',
                existingVersion: item.version,
                candidateVersion: candidate.version,
            }
        }
    }

    // 2) 内容完全相同：就是同一份脚本，与版本号无关
    for (const item of existing) {
        if (item.contentHash && item.contentHash === candidate.contentHash) {
            return {
                kind: 'content',
                existingId: item.id,
                existingName: item.name,
                existingOwner: item.owner,
                action: 'skip',
            }
        }
    }

    // 3) 同链接：同一地址再导一次。若版本更新则照样覆盖
    const candidateUrl = normalizeSourceUrl(candidate.sourceUrl)
    if (candidateUrl) {
        for (const item of existing) {
            if (normalizeSourceUrl(item.sourceUrl) === candidateUrl) {
                const newer = isNewerVersion(candidate.version, item.version)
                return {
                    kind: 'url',
                    existingId: item.id,
                    existingName: item.name,
                    existingOwner: item.owner,
                    action: newer ? 'overwrite' : 'skip',
                    existingVersion: item.version,
                    candidateVersion: candidate.version,
                }
            }
        }
    }

    return null
}

/** 把去重命中翻译成用户能看懂的一句话。 */
export function describeDuplicate(hit: DuplicateHit): string {
    const who = hit.existingOwner === 'open'
        ? '公开源'
        : hit.existingOwner
            ? `账号 ${hit.existingOwner} 的源`
            : '已有源'
    const name = hit.existingName || hit.existingId || '同名源'
    const from = hit.existingVersion ? `v${hit.existingVersion.replace(/^[vV]/, '')}` : '旧版'
    const to = hit.candidateVersion ? `v${hit.candidateVersion.replace(/^[vV]/, '')}` : '新版'
    switch (hit.kind) {
        case 'id':
            return hit.action === 'overwrite'
                ? `已用新版本覆盖同名源（${who}：${name}，${from} → ${to}）`
                : `同名源已存在（${who}：${name}${hit.existingVersion ? `，${from}` : ''}），版本不比它新，已跳过`
        case 'content':
            return `脚本内容与${who}「${name}」完全相同`
        case 'url':
            return hit.action === 'overwrite'
                ? `链接已导入过，已用新版本覆盖（${who}：${name}，${from} → ${to}）`
                : `该链接已导入过（${who}：${name}）`
    }
}
