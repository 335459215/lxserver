/**
 * 音乐地址解析器：不分平台 + 并发竞速。
 *
 * 旧行为是「歌曲属于哪个平台，就只在该平台的自定义源里挑」——选网易的歌，
 * 就只有声明支持 wy 的源会被调用，其它源哪怕能解析出同一首歌也完全不参与，
 * 而且是串行轮询，N 个源就是 N 段失败延迟相加。
 *
 * 这里改成：
 *  1. 不分平台：除歌曲原平台外，按歌名+歌手在其它「有自定义源能解析」的平台并发搜替身，
 *     凑成一张候选表（原平台优先，跨平台按相似度）。
 *  2. 并发：候选歌曲之间并发；同一平台内多个自定义源由 callUserApiGetMusicUrl 错峰竞速。
 *  3. 更稳：返回的链接会被真正探测一次，403/404 视为该源失败并继续竞速，而不是把坏链接交给客户端；
 *     死源会被熔断，成功结果会被粘滞缓存。
 */
import needle from 'needle'
import { getProxyAgent } from '@/modules/utils/proxy.js'
import { callUserApiGetMusicUrl, isSourceSupported } from '@/server/userApi'
import { findServerSourceMatches, normalizeSongInfo, AUTO_SOURCE_ORDER } from '@/server/musicMatch'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/** 一次解析最多同时铺开的候选平台数，防止极端配置把上游接口打爆 */
const MAX_PLATFORM_CANDIDATES = 6

export interface ResolveMusicUrlOptions {
    /** 已 normalizeSongInfo 过的歌曲信息 */
    songInfo: any
    quality: string
    username: string
    onProgress?: (attempt: any) => Promise<void> | void
    excludeApiSources?: string[]
    enableAutoSwitchApiSource?: boolean
    /** 覆盖 music.url.crossPlatform */
    crossPlatform?: boolean
    /** 音质降级顺序，默认只解析给定音质（音质降级交给播放器的播放错误策略） */
    qualities?: string[]
    /** 限定候选平台（Subsonic 按 source.priority 限定用） */
    platformOrder?: string[]
}

export interface ResolveMusicUrlResult {
    url: string
    type: string
    sourceName?: string
    sourceId?: string
    /** 客户端请求时歌曲所在的平台 */
    requestedSource: string
    /** 最终解析成功的平台（可能与 requestedSource 不同） */
    resolvedSource: string
    /** 最终用于解析的歌曲信息（跨平台时是替身） */
    resolvedSong: any
    attempts: any[]
    hasMoreSources: boolean
    /** 是否命中粘滞缓存（诊断用） */
    fromCache: boolean
}

// === 粘滞缓存 ===

interface StickyEntry {
    url: string
    type: string
    sourceId?: string
    sourceName?: string
    platform: string
    song: any
    createdAt: number
    expiresAt: number
}
const STICKY_MAX_ENTRIES = 500
const stickyCache = new Map<string, StickyEntry>()
/** 命中后超过这个年龄才重新探测，新鲜的直接信 */
const STICKY_TRUST_MS = 60_000

const stickyKey = (username: string, song: any, quality: string) => [
    username,
    song?.source,
    song?.songmid ?? song?.id ?? '',
    String(song?.name || ''),
    String(song?.singer || ''),
    quality,
].join('|')

const stickyGet = (key: string) => {
    const hit = stickyCache.get(key)
    if (!hit) return null
    if (hit.expiresAt <= Date.now()) { stickyCache.delete(key); return null }
    return hit
}

const stickySet = (key: string, entry: StickyEntry) => {
    stickyCache.set(key, entry)
    if (stickyCache.size > STICKY_MAX_ENTRIES) {
        // Map 按插入序迭代，删掉最老的一批即可
        const it = stickyCache.keys()
        for (let i = 0; i < 100; i++) {
            const oldest = it.next()
            if (oldest.done) break
            stickyCache.delete(oldest.value)
        }
    }
}

/** 音源脚本被增删改、或开关变化后，粘滞缓存必须作废 */
export const clearStickyCache = () => { stickyCache.clear() }

// === 链接探测 ===

const probeUrl = async (url: string, method: 'head' | 'get'): Promise<{ status?: number, location?: string } | null> => {
    try {
        const resp = await needle(method, url, null, {
            follow_max: 0,
            response_timeout: 3500,
            read_timeout: 3500,
            // 探测的是音乐平台链接，归 music 分类（NAS 上该分类不走代理）
            agent: await getProxyAgent(url, 'music'),
            headers: {
                'User-Agent': UA,
                Referer: new URL(url).origin,
                // 一些 CDN 禁 HEAD，用 Range GET 兜底
                ...(method === 'get' ? { Range: 'bytes=0-1' } : {}),
            },
        })
        return { status: resp.statusCode, location: resp.headers.location }
    } catch {
        return null
    }
}

/**
 * 跟随重定向拿到直链，并判断链接到底能不能播。
 * 只在拿到明确的 HTTP 错误码时才判失败——HEAD 被 CDN 拒绝(405/501)会退回 Range GET 重探，
 * 纯网络错误不直接判死，因为无法区分「不支持 HEAD」和「源确实挂了」。
 */
export const resolveAndValidateUrl = async (
    url: string
): Promise<{ url: string, ok: boolean, reason?: string }> => {
    if (!url || !url.startsWith('http')) return { url, ok: true }
    let current = url
    for (let depth = 0; depth <= 3; depth++) {
        let probe = await probeUrl(current, 'head')
        // 405/501: 服务器不接受 HEAD，换 Range GET 再确认一次
        if (!probe || probe.status === 405 || probe.status === 501) {
            probe = await probeUrl(current, 'get')
            if (!probe) return { url: current, ok: false, reason: '链接探测失败(超时或网络错误)' }
        }
        const status = probe.status ?? 0
        if ([301, 302, 303, 307, 308].includes(status) && probe.location) {
            let next = String(probe.location)
            if (!next.startsWith('http')) {
                try { next = new URL(next, current).href } catch { return { url: current, ok: true } }
            }
            current = next
            continue
        }
        if (status >= 400) return { url: current, ok: false, reason: `音源返回的链接不可用(HTTP ${status})` }
        // 2xx/3xx 可用；状态码缺失或异常值不作判定，保持旧行为放行
        return { url: current, ok: true }
    }
    return { url: current, ok: true }
}

// === 主解析流程 ===

export const resolveMusicUrl = async (opts: ResolveMusicUrlOptions): Promise<ResolveMusicUrlResult> => {
    const cfg = global.lx.config
    const song = normalizeSongInfo({ ...opts.songInfo })
    if (!song?.source) throw new Error('Invalid songInfo: missing source')
    const requestedSource = song.source
    const username = opts.username
    const validate = cfg['music.url.validate'] !== false
    const stickyTtlMs = Math.max(0, Number(cfg['music.url.stickyTtl'] ?? 600)) * 1000
    const qualities = opts.qualities?.length ? opts.qualities : [opts.quality || '128k']

    // 1) 粘滞缓存：同一首歌反复播放时直接复用上次的平台+自定义源，跳过整条链路
    if (stickyTtlMs > 0) {
        for (const q of qualities) {
            const hit = stickyGet(stickyKey(username, song, q))
            if (!hit) continue
            const fresh = Date.now() - hit.createdAt < STICKY_TRUST_MS
            if (fresh || !validate) {
                console.log(`[音源解析] 命中粘滞缓存: ${song.name} - ${song.singer} (${hit.platform}/${hit.sourceName})`)
                return {
                    url: hit.url,
                    type: hit.type,
                    sourceId: hit.sourceId,
                    sourceName: hit.sourceName,
                    requestedSource,
                    resolvedSource: hit.platform,
                    resolvedSong: hit.song,
                    attempts: [],
                    hasMoreSources: false,
                    fromCache: true,
                }
            }
            // 存了较久：确认链接还活着再用，签过名的直链过期就当没缓存过
            const v = await resolveAndValidateUrl(hit.url)
            if (v.ok) {
                hit.url = v.url
                console.log(`[音源解析] 粘滞缓存链接仍可用: ${song.name} - ${song.singer} (${hit.platform}/${hit.sourceName})`)
                return {
                    url: hit.url,
                    type: hit.type,
                    sourceId: hit.sourceId,
                    sourceName: hit.sourceName,
                    requestedSource,
                    resolvedSource: hit.platform,
                    resolvedSong: hit.song,
                    attempts: [],
                    hasMoreSources: false,
                    fromCache: true,
                }
            }
            console.warn(`[音源解析] 粘滞缓存链接已失效(${v.reason})，重新解析: ${song.name} - ${song.singer}`)
            stickyCache.delete(stickyKey(username, song, q))
        }
    }

    // 2) 候选表与调度
    //    关键点：原平台立刻开跑，跨平台替身等搜索结果回来再补进竞速。
    //    若反过来「先 await 跨平台搜索再开始解析」，原平台本来就能播的歌
    //    也要白等一次平台搜索往返——那正是这里要消灭的串行等待。
    const candidates: { song: any, platform: string, cross: boolean }[] = [
        { song, platform: requestedSource, cross: false },
    ]
    const crossEnabled = opts.crossPlatform ?? (cfg['music.url.crossPlatform'] !== false)
    const cfg2 = cfg as any
    const crossStaggerMs = Math.max(0, Number(cfg2['music.url.crossStagger'] ?? 150))
    const crossGraceMs = Math.max(0, Number(cfg2['music.url.priorityGrace'] ?? 350))
    const crossParallel = Math.max(1, Number(cfg2['music.url.maxParallelPlatforms'] ?? 3))

    const errors: string[] = []
    const successes = new Map<number, any>()
    const inflight = new Set<number>()
    let attemptSlots: any[][] = [[]]
    let accepted: { index: number, value: any } | null = null
    let finished = 0
    let searchDone = !crossEnabled
    let graceDeadline = 0
    let dirty = false
    let notify: (() => void) | null = null
    const changed = () => { dirty = true; const n = notify; notify = null; n?.() }
    const nextChange = async (): Promise<void> => {
        if (dirty) { dirty = false; return }
        await new Promise<void>(r => { notify = r })
        dirty = false
    }
    const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

    const runCandidate = async (index: number, quality: string) => {
        const c = candidates[index]
        const slot = attemptSlots[index]
        try {
            const r = await callUserApiGetMusicUrl(
                c.platform,
                c.song,
                quality,
                username,
                (att: any) => {
                    // 标注来自哪个平台/是否跨平台，前端的尝试列表才看得出「换源」发生过
                    void opts.onProgress?.({ ...att, source: c.platform, cross: c.cross })
                },
                opts.enableAutoSwitchApiSource !== false,
                opts.excludeApiSources,
            )
            if (!r?.url) throw new Error('音源未返回可用链接')
            let finalUrl = r.url
            if (validate) {
                const v = await resolveAndValidateUrl(r.url)
                if (!v.ok) {
                    const reason = `${c.platform}/${r.sourceName || '未知源'}: ${v.reason}`
                    console.warn(`[音源解析] 链接校验未通过 ${reason}`)
                    const att = { name: r.sourceName || '未知源', sourceId: r.sourceId, source: c.platform, cross: c.cross, status: 'fail' as const, message: v.reason ?? '链接不可用' }
                    slot.push(att)
                    // callUserApiGetMusicUrl 已经报过一次 success，这里必须补一条 fail，
                    // 否则前端进度里会留着一条和最终结果矛盾的「成功」。
                    void opts.onProgress?.(att)
                    errors.push(reason)
                    changed()
                    return
                }
                finalUrl = v.url
            }
            if (accepted) return
            slot.push({ name: r.sourceName || '未知源', sourceId: r.sourceId, source: c.platform, cross: c.cross, status: 'success', message: `链接可用${c.cross ? '（跨平台替身）' : ''}` })
            successes.set(index, { result: r, url: finalUrl, platform: c.platform, song: c.song, quality })
            changed()
        } catch (err: any) {
            errors.push(`${c.platform}: ${err?.message || err}`)
            changed()
        } finally {
            inflight.delete(index)
            finished++
            changed()
        }
    }

    let nextIndex = 0
    /** 有空位就把还没跑的候选补上去：原平台立即启动，跨平台候选之间错峰 */
    const pump = async () => {
        while (!accepted && nextIndex < candidates.length && inflight.size < crossParallel) {
            const index = nextIndex++
            if (index > 0) await sleep(crossStaggerMs)
            if (accepted) return
            inflight.add(index)
            void runCandidate(index, quality)
        }
    }
    // pump 需要看到当前音质的 quality，但它定义在音质循环里
    let quality = qualities[0]

    // 跨平台搜索与原平台解析并行发起：结果回来时若还没定胜负，就补进候选表继续竞速
    if (crossEnabled && song.name && song.singer) {
        void findServerSourceMatches(song, username).then(matches => {
            try {
                const allowed = opts.platformOrder?.length ? new Set(opts.platformOrder) : null
                for (const m of matches || []) {
                    if (candidates.length >= MAX_PLATFORM_CANDIDATES) break
                    const cand = normalizeSongInfo({ ...m })
                    if (!cand?.source || cand.source === requestedSource) continue
                    if (!isSourceSupported(cand.source, username)) continue
                    if (allowed && !allowed.has(cand.source)) continue
                    if (candidates.some(c => c.platform === cand.source)) continue
                    candidates.push({ song: cand, platform: cand.source, cross: true })
                }
                if (candidates.length > 1) {
                    console.log(`[音源解析] ${song.name} - ${song.singer} 不分平台竞速, 候选平台: ${candidates.map(c => c.platform).join(', ')}`)
                }
            } catch (err: any) {
                console.warn(`[音源解析] 跨平台候选筛选失败: ${err?.message || err}`)
            } finally {
                while (attemptSlots.length < candidates.length) attemptSlots.push([])
                searchDone = true
                void pump()
                changed()
            }
        }).catch(err => {
            console.warn(`[音源解析] 跨平台搜索失败: ${err?.message || err}`)
            searchDone = true
            changed()
        })
    }

    let winner: { index: number, value: any } | null = null

    // 音质逐级降级：默认只有一档，Subsonic 可传多档
    for (quality of qualities) {
        attemptSlots.forEach(x => { x.length = 0 })
        successes.clear()
        inflight.clear()
        nextIndex = 0
        finished = 0
        graceDeadline = 0
        accepted = null
        winner = null
        dirty = false
        errors.length = 0
        void pump()

        // 与 callUserApiGetMusicUrl 同款的裁决：取序号最小的成功项，
        // 并给序号更小的在途候选一段「总预算」宽限时间反超。
        for (;;) {
            if (successes.size > 0) {
                const indexes = [...successes.keys()].sort((a, b) => a - b)
                const best = indexes[0]
                // 宽限是「从第一个成功出现算起的总预算」，不是每轮各等一次——
                // 否则 while 里会一轮轮重新计时，慢源照样把延迟拖满，宽限形同虚设。
                if (graceDeadline === 0) graceDeadline = Date.now() + crossGraceMs
                const hasLowerInFlight = [...inflight].some(i => i < best)
                if (hasLowerInFlight && crossGraceMs > 0 && Date.now() < graceDeadline) {
                    await Promise.race([nextChange(), sleep(graceDeadline - Date.now())])
                    continue
                }
                winner = { index: best, value: successes.get(best) }
                accepted = winner
                break
            }
            // 必须等跨平台搜索也结束，否则可能在替身还没进来时就判定全军覆没
            if (searchDone && finished >= candidates.length) break
            await nextChange()
        }

        if (winner) break
        console.warn(`[音源解析] 音质 ${quality} 下所有候选均失败: ${errors.join(' | ')}`)
    }

    const attempts = attemptSlots.flat()

    if (winner) {
        const { result, url, platform, song: usedSong, quality: usedQuality } = winner.value
        if (stickyTtlMs > 0) {
            const key = stickyKey(username, song, opts.quality || usedQuality)
            stickySet(key, {
                url,
                type: result.type || usedQuality,
                sourceId: result.sourceId,
                sourceName: result.sourceName,
                platform,
                song: usedSong,
                createdAt: Date.now(),
                expiresAt: Date.now() + stickyTtlMs,
            })
        }
        console.log(`[音源解析] ✓ ${song.name} - ${song.singer} (${requestedQualityLabel(opts.quality, usedQuality)}) 命中 ${platform}/${result.sourceName}`)
        return {
            url,
            type: result.type || usedQuality,
            sourceId: result.sourceId,
            sourceName: result.sourceName,
            requestedSource,
            resolvedSource: platform,
            resolvedSong: usedSong,
            attempts,
            // 还有候选没跑完就返回了，说明可能还有更好的结果，值得让客户端继续试
            hasMoreSources: finished < candidates.length,
            fromCache: false,
        }
    }

    const detail = errors.length ? errors.join(' | ') : '没有任何可用的自定义源'
    const err: any = new Error(
        `已尝试 ${candidates.length} 个平台(${candidates.map(c => c.platform).join(', ')})的全部自定义源，均无法播放。${detail}`
    )
    err.attempts = attempts
    err.allSourcesExhausted = true
    throw err
}

const requestedQualityLabel = (requested: string | undefined, used: string) => (
    requested && requested !== used ? `${requested}→降级 ${used}` : used
)