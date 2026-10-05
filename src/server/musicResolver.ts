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
import { callUserApiGetMusicUrl, isSourceSupported, reportSourceResult } from '@/server/userApi'
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
    /** 只有探测确认过可用的链接才允许进缓存；探测被拒(probeError)的不缓存 */
    confirmed: boolean
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

// === 按歌记忆「播放器报告过播不了的源」 ===
// 播放失败后播放器会带 excludeApiSources 重试——这是对「这个源这首歌不行」
// 最权威的报告，比服务端探测可信（网关可以对探针 RST，但骗不过真正的播放）。
// 只在重试那一次生效是不够的：下次播放同一首歌会被重新解析回同一个死源。
// 记住它，后续解析直接跳过。
const SONG_BLACKLIST_TTL = 15 * 60_000
const SONG_BLACKLIST_MAX = 800
const songSourceBlacklist = new Map<string, { ids: Set<string>, expiresAt: number }>()

const songBlacklistKey = (username: string, song: any) => [
    username,
    song?.source,
    song?.songmid ?? song?.id ?? '',
    String(song?.name || ''),
    String(song?.singer || ''),
].join('|')

const addSongBlacklist = (key: string, rawIds: string[]) => {
    const entry = songSourceBlacklist.get(key) ?? { ids: new Set<string>(), expiresAt: 0 }
    for (const id of rawIds) {
        const v = String(id || '').trim().toLowerCase()
        if (v) entry.ids.add(v)
    }
    entry.expiresAt = Date.now() + SONG_BLACKLIST_TTL
    songSourceBlacklist.set(key, entry)
    if (songSourceBlacklist.size > SONG_BLACKLIST_MAX) {
        const it = songSourceBlacklist.keys()
        for (let i = 0; i < 100; i++) { const k = it.next(); if (k.done) break; songSourceBlacklist.delete(k.value) }
    }
}

const getSongBlacklist = (key: string): string[] => {
    const entry = songSourceBlacklist.get(key)
    if (!entry) return []
    if (entry.expiresAt <= Date.now()) { songSourceBlacklist.delete(key); return [] }
    return [...entry.ids]
}

/** 播放器成功换源播放后，把这首歌此前拉黑的源清掉——它们可能只是当时抽风 */
export const clearSongBlacklist = (username: string, song: any) => { songSourceBlacklist.delete(songBlacklistKey(username, song)) }

// === 源级熔断（由真实播放失败驱动） ===
// 服务端探测在「网关屏蔽探针」和「网关真挂了」之间无法区分（Cloudflare 的 522
// 要等 10~30s 才返回，探测超时内拿不到）。唯一能分辨的是真正的播放。
// 所以：播放器报告某源播不了时按源累计「不同的歌」；短时间内在 2 首以上歌曲上
// 都失败，就判定这个源当前不可用，全部歌曲跳过它一段时间——否则每首新歌都要
// 先撞一次它。恢复靠时间到期后放探针，或后台测试音源时整体清零。
const PLAYBACK_BREAKER_MIN_SONGS = 2
const PLAYBACK_BREAKER_WINDOW_MS = 10 * 60_000
const PLAYBACK_BREAKER_COOLDOWN_MS = 10 * 60_000
const playbackBreakers = new Map<string, { songs: Set<string>, firstAt: number, openUntil: number }>()

const playbackBreakerKey = (rawId: string) => String(rawId || '').trim().toLowerCase()

/** 记录一次「播放器报告该源在这首歌上播不了」；返回该源是否因此被熔断 */
const recordPlaybackFailure = (rawId: string, songKey: string): boolean => {
    const key = playbackBreakerKey(rawId)
    if (!key) return false
    const now = Date.now()
    const st = playbackBreakers.get(key)
    if (st && st.openUntil > now) return true
    const cur = st && now - st.firstAt <= PLAYBACK_BREAKER_WINDOW_MS
        ? st
        : { songs: new Set<string>(), firstAt: now, openUntil: 0 }
    cur.songs.add(songKey)
    // 探测被拒的链接有的能播有的不能，单首歌失败不作数；要不同歌曲都失败才算
    if (cur.songs.size >= PLAYBACK_BREAKER_MIN_SONGS) {
        cur.openUntil = now + PLAYBACK_BREAKER_COOLDOWN_MS
        playbackBreakers.set(key, cur)
        console.warn(`[音源解析] 「${rawId}」在 ${cur.songs.size} 首歌上播放失败，熔断 ${PLAYBACK_BREAKER_COOLDOWN_MS / 60000} 分钟`)
        return true
    }
    playbackBreakers.set(key, cur)
    return false
}

/** 该源是否已被「播放失败」熔断。
 *  注意：不能像通常的熔断那样「过期就删条目」——这里的条目有两种状态：
 *  openUntil>0 是已熔断（冷却中），openUntil=0 是还在累计失败歌曲数（尚未触发）。
 *  若把累计中的条目删掉，第二首歌上报失败时就只剩它自己那一条记录，永远凑不齐
 *  MIN_SONGS，熔断形同虚设。清理只交给 getPlaybackTrippedSources 按冷却到期做。
 */
const isPlaybackTripped = (rawId: string): boolean => {
    const st = playbackBreakers.get(playbackBreakerKey(rawId))
    if (!st) return false
    return st.openUntil > Date.now()
}

export const resetAllPlaybackBreakers = () => { playbackBreakers.clear() }

/** 当前所有被播放失败熔断中的源（id 或名称，匹配规则与 excludeApiSources 一致）。
 *  只清理「冷却已到期」的条目（openUntil>0 但已过期）；openUntil=0 的累计中条目保留。
 */
const getPlaybackTrippedSources = (): string[] => {
    const now = Date.now()
    const out: string[] = []
    for (const [key, st] of playbackBreakers) {
        if (st.openUntil > now) {
            out.push(key)
        } else if (st.openUntil > 0) {
            // 冷却到期，清理；下次失败会重新累计
            playbackBreakers.delete(key)
        }
        // openUntil === 0 → 仍在累计失败歌曲数，必须保留
    }
    return out
}

// === 链接探测 ===

/**
 * 用 Range GET 探测——不用 HEAD。
 * 原因一：播放器就是用 GET 播的，GET 的结果才是「能不能播」的真相，
 * 大量网关/CDN 对 HEAD 直接 404/RST，用 HEAD 判断会误杀好链接。
 * 原因二：Cloudflare 站点源站挂掉时，522 要等 CF 等完源站(10~30s)才返回，
 * 探测超时内拿不到——所以「探测被拒」的结论必须交给播放器的失败报告去补，
 * 这里不做更久的等待。
 */
const probeUrl = async (url: string): Promise<{ status?: number, location?: string } | null> => {
    try {
        const resp = await needle('get', url, null, {
            follow_max: 0,
            // 校验是优化手段不是闸门：探不通就放行，所以超时必须给得起。
            // 另外必须显式给 open_timeout——needle 默认 10s，TCP 连接挂住时
            // 一次解析会被拖到 10s 以上。
            open_timeout: 1200,
            response_timeout: 1200,
            read_timeout: 1200,
            // 探测的是音乐平台链接，归 music 分类（NAS 上该分类不走代理）
            agent: await getProxyAgent(url, 'music'),
            headers: {
                'User-Agent': UA,
                Referer: new URL(url).origin,
                Range: 'bytes=0-1',
            },
        })
        return { status: resp.statusCode, location: resp.headers.location }
    } catch {
        return null
    }
}

/**
 * 深度探测：给更长的超时（4s），用来在「短探测超时」之后补一刀。
 * Cloudflare 522 要等 CF 等完源站（10~30s）才返回——4s 也等不到完整的 522，
 * 但能等到一部分快的 5xx；更重要的是能等到部分 CDN 对非浏览器 UA 的 RST
 * 在更长窗口里返回的状态码。仍然探不通就维持「次选」身份交给播放器。
 */
const probeUrlDeep = async (url: string): Promise<{ status?: number, location?: string } | null> => {
    try {
        const resp = await needle('get', url, null, {
            follow_max: 0,
            open_timeout: 4000,
            response_timeout: 4000,
            read_timeout: 4000,
            agent: await getProxyAgent(url, 'music'),
            headers: {
                'User-Agent': UA,
                Referer: new URL(url).origin,
                Range: 'bytes=0-1',
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
): Promise<{ url: string, ok: boolean, reason?: string, probeError?: boolean }> => {
    if (!url || !url.startsWith('http')) return { url, ok: true }
    let current = url
    for (let depth = 0; depth <= 3; depth++) {
        const probe = await probeUrl(current)
        if (!probe) {
            // 探测本身失败（超时 / 连接被重置 / 站点只认浏览器 TLS 指纹）。
            // 自定义源大量返回 PHP 网关地址而非 CDN 直链，这类地址对服务端探测
            // 常直接 RST，对浏览器却完全可播——把「探测不到」判成死链会把能播的
            // 歌全部误杀（改造前这里只告警并放行）。「探针拿不到真相」的另一半
            // 由播放器的失败报告（按歌/按源黑名单）补上。
            return { url: current, ok: true, probeError: true }
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

    // 1) 粘滞缓存：同一首歌反复播放时直接复用上次的平台+自定义源，跳过整条链路。
    //    客户端带来的排除清单必须参与判断：播放失败后播放器会带着「排除刚失败的那个源」
    //    重试，若粘滞缓存照常命中，就会把同一个死链原样再发回去——播放器永远逃不出
    //    这个源，表现为「解析成功→一直缓冲→换源→还是缓冲」的死循环。
    const songKey = songBlacklistKey(username, song)
    // 播放器带来的排除清单 = 「刚失败的源」的权威报告，记入按歌黑名单，
    // 并累计到源级熔断（不同歌曲都失败才触发）。
    if (Array.isArray(opts.excludeApiSources) && opts.excludeApiSources.length > 0) {
        addSongBlacklist(songKey, opts.excludeApiSources)
        for (const src of opts.excludeApiSources) {
            if (isPlaybackTripped(String(src))) continue
            recordPlaybackFailure(String(src), songKey)
        }
    }
    const reportedSources = Array.isArray(opts.excludeApiSources) ? opts.excludeApiSources : []
    const clientExcludes = new Set<string>(
        [...getSongBlacklist(songKey), ...reportedSources]
            .map(x => String(x).trim().toLowerCase()).filter(Boolean),
    )
    // 被播放失败熔断的源：所有歌曲都跳过，直到冷却结束
    const playbackTripped = getPlaybackTrippedSources()
    for (const t of playbackTripped) clientExcludes.add(t.toLowerCase())
    const stickyExcluded = (hit: StickyEntry) => {
        if (!clientExcludes.size) return false
        const id = String(hit.sourceId || '').toLowerCase()
        const name = String(hit.sourceName || '').toLowerCase()
        return (id && clientExcludes.has(id)) || (name && clientExcludes.has(name))
    }
    if (stickyTtlMs > 0) {
        for (const q of qualities) {
            const hit = stickyGet(stickyKey(username, song, q))
            if (!hit) continue
            if (stickyExcluded(hit)) {
                console.warn(`[音源解析] 粘滞缓存的 ${hit.sourceName} 在客户端排除清单里，跳过缓存重新解析`)
                stickyCache.delete(stickyKey(username, song, q))
                continue
            }
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
    // 探测被拒但未判死的候选。只在没有任何「确认可用」候选时兜底。
    const unconfirmed = new Map<number, any>()
    // 外层胜出后通知所有还在跑的内部竞速立刻收手。没有它，输掉的候选会把自己
    // 那条内部竞速（同平台最多 14 个源）整个跑完——一次播放平白多打 4~15 次
    // 上游请求，既慢又把上游接口打到限流。
    const outerAbort = { aborted: false }
    // 本次解析中已失败的源。跨音质档累积下来，下一档直接排除：
    // 一个同时支持 4 个平台的源，在 3 档音质下最多会被无谓地调用 12 次。
    const failedSourceIds = new Set<string>([
        ...(Array.isArray(opts.excludeApiSources) ? opts.excludeApiSources : []).map(x => String(x)),
        ...playbackTripped,
    ])
    const successes = new Map<number, any>()
    const inflight = new Set<number>()
    let attemptSlots: any[][] = [[]]
    let accepted: { index: number, value: any } | null = null
    let finished = 0
    // needCrossSearch 定义在下方，这里按同样的条件预置，避免搜索块被跳过时永远等不到
    let searchDone = !(crossEnabled && !!song.name && !!song.singer)
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
                failedSourceIds.size ? [...failedSourceIds] : opts.excludeApiSources,
                { signal: outerAbort, recordBreakerSuccess: false },
            )
            if (!r?.url) throw new Error('音源未返回可用链接')
            // 逐源尝试明细要并进本候选的槽位。否则响应里的 attempts 只剩一条
            // 「最终成功」，哪个源试了几次、报了什么就全丢了，排障只能靠翻日志。
            // 只取失败条目：成功条目由下面那条带「链接可用 / 跨平台替身」注释的统一记录
            // 承担，两边都收会出现同一条成功重复一次。
            for (const a of Array.isArray(r.attempts) ? r.attempts : []) {
                if (a?.status === 'success') continue
                slot.push({ ...a, source: c.platform, cross: c.cross })
                if (a?.sourceId) failedSourceIds.add(String(a.sourceId))
            }
            // 重定向必须无条件跟随。music.url.validate 只决定「链接是否可用」的判定，
            // 不是「要不要解析重定向」——早期把两者绑在一起，关掉校验就会把带
            // 重定向的原始链接直接交给客户端，等于悄悄关了一个原有能力。
            const v = await resolveAndValidateUrl(r.url)
            if (!v.ok && validate) {
                const reason = `${c.platform}/${r.sourceName || '未知源'}: ${v.reason}`
                console.warn(`[音源解析] 链接校验未通过 ${reason}`)
                // 链接不可用同样算失败，必须记进熔断：「稳定返回 403 的源」永远
                // 不会抛异常，不靠这里计入就会被反复优先尝试。
                reportSourceResult(String(r.sourceId ?? ''), false)
                if (!accepted) {
                    const att = { name: r.sourceName || '未知源', sourceId: r.sourceId, source: c.platform, cross: c.cross, status: 'fail' as const, message: v.reason ?? '链接不可用' }
                    slot.push(att)
                    // callUserApiGetMusicUrl 已经报过一次 success，这里必须补一条 fail，
                    // 否则前端进度里会留着一条和最终结果矛盾的「成功」。
                    void opts.onProgress?.(att)
                }
                errors.push(reason)
                failedSourceIds.add(String(r.sourceId ?? ''))
                // 原平台这边已经出了失败结果，跨平台搜索不用再等定时器
                ensureSearchStarted()
                changed()
                return
            }
            // 探测被拒（网关对服务端探针直接 RST）≠ 链接可用：这类地址有的浏览器能播、
            // 有的就是死链（同一网关两种都实测过）。既不能直接当赢家——死链会被立刻
            // 交给播放器；也不能判死——会误杀能播的。降进「次选池」：只有当没有任何
            // 「确认可用」的候选时才用它兜底。
            if (v.probeError) {
                console.warn(`[音源解析] 链接探测被拒(超时/连接重置)，降为次选候选: ${c.platform}/${r.sourceName || '未知源'}`)
                unconfirmed.set(index, { result: r, url: v.url, platform: c.platform, song: c.song, quality })
                changed()
                return
            }
            if (accepted) return
            reportSourceResult(String(r.sourceId ?? ''), true)
            slot.push({ name: r.sourceName || '未知源', sourceId: r.sourceId, source: c.platform, cross: c.cross, status: 'success', message: `链接可用${c.cross ? '（跨平台替身）' : ''}` })
            successes.set(index, { result: r, url: v.url, platform: c.platform, song: c.song, quality, confirmed: true })
            changed()
        } catch (err: any) {
            errors.push(`${c.platform}: ${err?.message || err}`)
            for (const a of Array.isArray(err?.attempts) ? err.attempts : []) {
                if (a?.sourceId) failedSourceIds.add(String(a.sourceId))
            }
            // 同上：出失败结果就立刻拉起跨平台搜索
            ensureSearchStarted()
            changed()
        } finally {
            inflight.delete(index)
            finished++
            changed()
            // 关键：腾出并发槽位后必须把剩余候选拉起来。
            // 少了这一句，pump 会在 inflight 达到 crossParallel 时退出且再没人
            // 叫它，候选表里排队的平台永远不会被启动，finished 也就永远追不上
            // candidates.length，裁决循环在 await nextChange() 上永久挂死。
            // 这里的 quality 是 runCandidate 的形参（遮蔽了外层变量），正是本候选启动时
            // 所用的那一档，不会串到别的音质。
            void pump(quality)
        }
    }

    let nextIndex = 0
    /**
     * 有空位就把还没跑的候选补上去：原平台立即启动，跨平台候选之间错峰。
     * quality 由调用方显式传入而不是读闭包——候选完成时会在自己的 finally 里
     * 重新拉起 pump，那时外层音质循环可能已经换档，闭包里的值会串。
     */
    const pump = async (q: string) => {
        while (!accepted && nextIndex < candidates.length && inflight.size < crossParallel) {
            const index = nextIndex++
            if (index > 0) await sleep(crossStaggerMs)
            if (accepted) return
            inflight.add(index)
            void runCandidate(index, q)
        }
    }
    let quality = qualities[0]

    // 跨平台搜索改惰性触发：原平台自己能解析时一次都不搜（这是对上游接口最省的路径，
    // 每次播放省下 4 次平台搜索——持续打搜索会把上游打到限流，反过来拖慢所有源）。
    // 触发时机取「第一次候选失败」或「1.2s 内还没出结果」中更早的那个。
    const needCrossSearch = crossEnabled && !!song.name && !!song.singer
    let searchStarted = false
    let lazyTimer: ReturnType<typeof setTimeout> | null = null
    const startCrossSearch = () => {
        if (searchStarted || !needCrossSearch) return
        searchStarted = true
        if (lazyTimer) { clearTimeout(lazyTimer); lazyTimer = null }
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
                void pump(quality)
                changed()
            }
        }).catch(err => {
            console.warn(`[音源解析] 跨平台搜索失败: ${err?.message || err}`)
            searchDone = true
            changed()
        })
    }
    // 原平台迟迟没出结果就主动把跨平台搜索拉起来
    if (needCrossSearch) {
        lazyTimer = setTimeout(() => startCrossSearch(), 1200)
    }
    const ensureSearchStarted = () => {
        if (!searchStarted) startCrossSearch()
    }

    // 音源脚本自带 10s VM 超时，正常远到不了这个上限；纯粹是「绝不挂死」的兜底
    const ARBITER_MAX_WAIT_MS = 120_000
    let arbiterDeadline = 0
    let winner: { index: number, value: any } | null = null

    // 音质逐级降级：默认只有一档，Subsonic 可传多档
    for (quality of qualities) {
        attemptSlots.forEach(x => { x.length = 0 })
        successes.clear()
        unconfirmed.clear()
        inflight.clear()
        nextIndex = 0
        finished = 0
        graceDeadline = 0
        arbiterDeadline = Date.now() + ARBITER_MAX_WAIT_MS
        accepted = null
        winner = null
        dirty = false
        errors.length = 0
        void pump(quality)

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
                if (lazyTimer) { clearTimeout(lazyTimer); lazyTimer = null }
                break
            }
            // 只有「探测被拒」的次选、还没有任何确认可用的候选：
            // 给在途/未启动的候选一个宽限窗口去产出确认可用的结果，
            // 到点还没有才用次选兜底（次选仍可能被浏览器播出来）。
            if (unconfirmed.size > 0) {
                if (graceDeadline === 0) graceDeadline = Date.now() + crossGraceMs
                const confirmedStillPossible = inflight.size > 0 || nextIndex < candidates.length
                if (confirmedStillPossible && crossGraceMs > 0 && Date.now() < graceDeadline) {
                    await Promise.race([nextChange(), sleep(graceDeadline - Date.now())])
                    continue
                }
                // 宽限期到，仍没有确认可用的候选。但跨平台搜索可能还在跑——
                // 如果搜索还没结束，可能还有替身候选要进来，先等搜索，不急着
                // 跑 4s 深探测（深探测会同步阻塞裁决循环，新成功的候选要等
                // 深探测完才能被选中，白白多等几秒）。
                if (!searchDone && successes.size === 0) {
                    ensureSearchStarted()
                    if (Date.now() > arbiterDeadline) break
                    await Promise.race([nextChange(), sleep(1000)])
                    continue
                }
                // 所有候选（含跨平台替身）都跑完了，才有必要深探测次选候选：
                // 短探测超时的链接有可能是 Cloudflare 522（源站挂了，CF 要
                // 10~30s 才返回 522）——交给播放器只会缓冲半天再失败。用 4s
                // 深探测补一刀：拿到明确 4xx/5xx 就判死；确认 2xx/3xx 就提升
                // 为确认可用；仍然超时的才维持次选身份兜底。
                // validate=false 时用户已明确关掉链接校验，不跑深探测，直接兜底。
                if (successes.size === 0 && validate) {
                    for (const idx of [...unconfirmed.keys()].sort()) {
                        const uc = unconfirmed.get(idx)
                        if (!uc) continue
                        console.log(`[音源解析] 深度探测次选候选 #${idx} (${uc.platform}): ${uc.result.sourceName || '未知源'}`)
                        // tri-state: confirmed / dead / unknown(仍超时)
                        let deepConfirmed = false
                        let deepDead = false
                        try {
                            const dp = await probeUrlDeep(uc.url)
                            if (dp) {
                                const status = dp.status ?? 0
                                if (status >= 400) {
                                    deepDead = true
                                    console.warn(`[音源解析] 深度探测确认链接不可用(HTTP ${status}): ${uc.platform}/${uc.result.sourceName || '未知源'}`)
                                } else if ([301, 302, 303, 307, 308].includes(status) && dp.location) {
                                    let next = String(dp.location)
                                    if (!next.startsWith('http')) { try { next = new URL(next, uc.url).href } catch { deepConfirmed = true } }
                                    if (!deepConfirmed) {
                                        // 重定向目标用短探测跟进——如果短探测也超时(probeError)，
                                        // 不能判死：跟原始链接一样「探针拿不到真相」，维持次选身份。
                                        const v2 = await resolveAndValidateUrl(next)
                                        if (v2.ok && !v2.probeError) deepConfirmed = true
                                        else if (!v2.ok) { deepDead = true; console.warn(`[音源解析] 深度探测重定向后不可用: ${v2.reason}`) }
                                        // v2.probeError → 既不确认也不判死，维持次选
                                    }
                                } else {
                                    deepConfirmed = true
                                }
                            }
                        } catch { /* null = 仍超时，维持次选 */ }
                        if (deepConfirmed) {
                            console.log(`[音源解析] 深度探测确认链接可用: ${uc.platform}/${uc.result.sourceName || '未知源'}`)
                            uc.confirmed = true
                            successes.set(idx, uc)
                            // 找到一个确认可用的就够了，回到循环顶部走 successes 分支选它
                            break
                        } else if (deepDead) {
                            // 深探测确认死链——判死，避免把死链交给播放器
                            reportSourceResult(String(uc.result.sourceId ?? ''), false)
                            unconfirmed.delete(idx)
                            failedSourceIds.add(String(uc.result.sourceId ?? ''))
                            // 把这个源记入「本次解析失败」，避免后续音质档再试
                            errors.push(`${uc.platform}/${uc.result.sourceName || '未知源'}: 深度探测确认链接不可用`)
                        }
                        // 既不 confirmed 也不 dead → 维持次选，继续看下一个候选
                    }
                    if (successes.size > 0) {
                        // 深探测把某个次选提升为确认可用——回到循环顶部，走 successes 分支选赢家
                        continue
                    }
                    // unconfirmed 可能在深探测中被全部判死清空
                    if (unconfirmed.size === 0) {
                        if (searchDone && finished >= candidates.length) break
                        ensureSearchStarted()
                        if (Date.now() > arbiterDeadline) break
                        await Promise.race([nextChange(), sleep(1000)])
                        continue
                    }
                }
                const idx = Math.min(...unconfirmed.keys())
                winner = { index: idx, value: unconfirmed.get(idx) }
                accepted = winner
                if (lazyTimer) { clearTimeout(lazyTimer); lazyTimer = null }
                break
            }
            // 必须等跨平台搜索也结束，否则可能在替身还没进来时就判定全军覆没
            if (searchDone && finished >= candidates.length) break
            // 防御：正常情况下失败路径已经把搜索拉起来了，这里兜底
            ensureSearchStarted()
            // 兜底：即使将来有哪条路径忘了 signal，nextChange 也只会挂 1 秒，
            // 不会让 /api/music/url 的请求和它带起的 SSE 永久泄漏。
            if (Date.now() > arbiterDeadline) {
                console.warn(`[音源解析] 裁决超时(${quality}), 已完成 ${finished}/${candidates.length} 个候选, 跨平台搜索${searchDone ? '已结束' : '未结束'}`)
                break
            }
            await Promise.race([nextChange(), sleep(1000)])
        }

        if (winner) break
        console.warn(`[音源解析] 音质 ${quality} 下所有候选均失败: ${errors.join(' | ')}`)
    }

    const attempts = attemptSlots.flat()

    if (winner) {
        const { result, url, platform, song: usedSong, quality: usedQuality, confirmed } = winner.value
        // 只缓存「探测确认可用」的链接。探测被拒的地址有可能本来就是死链，
        // 缓存它等于把死链钉死十分钟——播放器重试换源也逃不掉。
        if (stickyTtlMs > 0 && confirmed) {
            const key = stickyKey(username, song, opts.quality || usedQuality)
            stickySet(key, {
                url,
                type: result.type || usedQuality,
                sourceId: result.sourceId,
                sourceName: result.sourceName,
                platform,
                song: usedSong,
                confirmed: true,
                createdAt: Date.now(),
                expiresAt: Date.now() + stickyTtlMs,
            })
        }
        console.log(`[音源解析] ✓ ${song.name} - ${song.singer} (${requestedQualityLabel(opts.quality, usedQuality)}) 命中 ${platform}/${result.sourceName}`)
        // 拿到了确认可用的链接：这首歌之前的失败记录不再有参考价值
        if (confirmed) clearSongBlacklist(username, song)
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