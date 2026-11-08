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
}

export interface SourceCandidate {
    id: string
    name?: string
    sourceUrl?: string
    contentHash: string
}

export interface DuplicateHit {
    kind: 'id' | 'content' | 'url'
    existingId?: string
    existingName?: string
    existingOwner?: string
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

/** 在已有指纹里找同一条源。优先级：id > 内容哈希 > 链接。 */
export function findDuplicateSource(
    candidate: SourceCandidate,
    existing: SourceFingerprint[],
): DuplicateHit | null {
    for (const item of existing) {
        if (candidate.id && item.id === candidate.id) {
            return {
                kind: 'id',
                existingId: item.id,
                existingName: item.name,
                existingOwner: item.owner,
            }
        }
    }

    for (const item of existing) {
        if (item.contentHash && item.contentHash === candidate.contentHash) {
            return {
                kind: 'content',
                existingId: item.id,
                existingName: item.name,
                existingOwner: item.owner,
            }
        }
    }

    const candidateUrl = normalizeSourceUrl(candidate.sourceUrl)
    if (candidateUrl) {
        for (const item of existing) {
            if (normalizeSourceUrl(item.sourceUrl) === candidateUrl) {
                return {
                    kind: 'url',
                    existingId: item.id,
                    existingName: item.name,
                    existingOwner: item.owner,
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
    switch (hit.kind) {
        case 'id':
            return `同名源已存在（${who}：${name}）`
        case 'content':
            return `脚本内容与${who}「${name}」完全相同`
        case 'url':
            return `该链接已导入过（${who}：${name}）`
    }
}
