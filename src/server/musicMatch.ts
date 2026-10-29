/**
 * 跨平台歌曲匹配：把「在别的平台按歌名+歌手搜到替身」这件事从 server.ts 里抽出来。
 *
 * 单独成模块的原因：这套匹配逻辑被多个上层复用（/api/music/url 的音源解析、
 * 自动换源等）。逻辑留在 server.ts 里的话，各消费方反向 import server.ts 会形成循环依赖，
 * 所以抽到这里由各方共同依赖。
 */
import musicSdkRaw from '@/modules/utils/musicSdk/index.js'
import { isSourceSupported } from '@/server/userApi'

const musicSdk = musicSdkRaw as any

/** 自动换源的候选平台顺序（不含歌曲原平台） */
export const AUTO_SOURCE_ORDER = ['wy', 'tx', 'kw', 'kg', 'mg']
const SOURCE_MATCH_CACHE_TTL = 60_000
const sourceMatchCache = new Map<string, { expiresAt: number, promise: Promise<any[]> }>()

export const normalizeSongMatchText = (value: unknown) => String(value || '')
  .toLowerCase()
  .replace(/[（(\[].*?[）)\]]/g, '')
  .replace(/[\s\p{P}\p{S}]/gu, '')

export const normalizeSongNameText = (value: unknown) => String(value || '')
  .toLowerCase()
  .replace(/[\s\p{P}\p{S}]/gu, '')

/** 从歌名里抽出**版本词**集合（live / 伴奏 / remix / 纯音乐 …），用于判定
 *  「候选与目标是不是同一个录音」。见 getSongMatchScore 里的详细说明。
 *
 *  【为什么返回排序后的字符串而不是数组】调用方只需要判等，字符串比较最直接。
 *
 *  【为什么必须归一化全角括号】平台常用 `（Live）`（全角），
 *  不做归一化会漏掉一半的版本标记 —— 而漏掉就是放行错歌。
 *
 *  【收录标准】只收「明确改变录音本体」的词。 */
const VERSION_PATTERNS: Array<[RegExp, string]> = [
  [/\blive\b/, 'live'],
  [/现场/, 'live'],
  [/\bunplugged\b/, 'unplugged'],
  [/\bacoustic\b/, 'acoustic'],
  [/不插电/, 'unplugged'],
  [/伴奏/, 'instrumental'],
  [/\binstrumental\b/, 'instrumental'],
  [/\bkaraoke\b/, 'karaoke'],
  [/\boff\s*vocal\b/, 'karaoke'],
  [/\bremix\b/, 'remix'],
  [/混音/, 'remix'],
  [/\bcover\b/, 'cover'],
  [/翻唱/, 'cover'],
  [/\breprise\b/, 'reprise'],
  [/\bnightcore\b/, 'nightcore'],
  [/\bslowed\b/, 'slowed'],
  [/加速版?/, 'nightcore'],
  [/慢速|降速/, 'slowed'],
  [/\bpiano\s*version\b/, 'piano'],
  [/钢琴版/, 'piano'],
  [/\bmusic\s*box\b/, 'musicbox'],
  [/\b8d\s*audio\b/, '8d'],
]

export const versionTags = (rawName: unknown): string => {
  // 全角 ASCII → 半角（覆盖 （） ： 等标点与全角字母），再统一小写
  const text = String(rawName || '')
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .toLowerCase()
  const tags = new Set<string>()
  for (const [re, tag] of VERSION_PATTERNS) {
    if (re.test(text)) tags.add(tag)
  }
  // 排序保证「同集合、不同书写顺序」判等一致
  return [...tags].sort().join('+')
}

const splitSingerNames = (value: unknown) => String(value || '')
  .toLowerCase()
  .split(/[、，,&；;|/+]/)
  .map(normalizeSongMatchText)
  .filter(Boolean)

export const isSingerMatch = (candidateSinger: unknown, targetSinger: unknown) => {
  const candidateText = normalizeSongMatchText(candidateSinger)
  const targetText = normalizeSongMatchText(targetSinger)
  if (!targetText) return true
  if (!candidateText) return false
  if (candidateText.includes(targetText) || targetText.includes(candidateText)) return true

  const candidateParts = splitSingerNames(candidateSinger)
  const targetParts = splitSingerNames(targetSinger)
  return candidateParts.some(candidatePart => targetParts.some(targetPart => (
    candidatePart.includes(targetPart) || targetPart.includes(candidatePart)
  )))
}

export const getSongDurationSeconds = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10000 ? Math.round(value / 1000) : Math.round(value)
  }

  const text = String(value || '').trim()
  if (!text) return 0
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const parsed = Number(text)
    return parsed > 10000 ? Math.round(parsed / 1000) : Math.round(parsed)
  }

  const parts = text.split(':').map(Number)
  if (parts.some(part => !Number.isFinite(part))) return 0
  if (parts.length === 2) return Math.round(parts[0] * 60 + parts[1])
  if (parts.length === 3) return Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2])
  return 0
}

/**
 * 候选与目标歌曲的相似度。返回 -1 表示不是同一首歌（调用方必须丢弃，
 * 绝不能退化成「拿最相似的那条去解析」，否则用户会听到完全不同的歌）。
 */
export const getSongMatchScore = (candidate: any, target: any) => {
  const candidateName = normalizeSongNameText(candidate?.name)
  const targetName = normalizeSongNameText(target?.name)
  if (!candidateName || !targetName) return -1
  if (!candidateName.includes(targetName) && !targetName.includes(candidateName)) return -1
  if (!isSingerMatch(candidate?.singer, target?.singer)) return -1

  // ===== 版本后缀护栏（2026-10-29 用户报告）=====
  //
  // 【缺陷】用户实测：「显示的是 A，播出来的是另一首」—— 只在歌单里出现，
  // 直接把音质调到最高、再开「自动选最高档」后必然复现。
  //
  // 链路：高音质档（flac/hires）原平台拿不到链接 → 服务端启用跨平台替身
  // → 按「歌名+歌手」在其它平台**搜替身**顶上去。上面的包含判断太松：
  // 目标 `晴天` 与候选 `晴天 (Live)`、`晴天 (伴奏)`、`晴天 - Remix`
  // 全部通过（候选名.includes(目标名)），歌手也相同、时长差在 8s 内的
  // 现场版/伴奏版由此被当成同一首 —— 用户听到的是**同一首歌的另一个录音**，
  // 体感就是「显示 A、播出来不是 A」。
  //
  // 低音质时不容易触发：320k 及以下原平台大多能直接给出链接，替身几乎不参与。
  //
  // 【为什么用「版本词」而非严格相等】平台命名不统一（`(Live)`/`（live版）`/
  // ` - Live`/`[伴奏]`），严格相等会误杀正常匹配（多数候选名带 `(feat. X)` 等
  // 可忽略后缀）。做法：把两侧的版本词集合抽出来，**不一致就否决**；
  // 一侧有版本词、另一侧没有，也否决（`晴天` vs `晴天 (Live)` 不是同一录音）。
  const candidateVersion = versionTags(candidate?.name)
  const targetVersion = versionTags(target?.name)
  if (candidateVersion !== targetVersion) return -1

  // ===== 时长必填护栏 =====
  // 原实现「任一侧时长缺失就不算分」，等于对缺失时长的候选完全放行 ——
  // 自定义源搜出来的条目经常没有 interval，恰是最容易混进错歌的一类。
  // 目标有时长、候选没有：宁可不用这个替身（少换一次源），也不要播错歌。
  const candidateDuration = getSongDurationSeconds(candidate?.interval)
  const targetDuration = getSongDurationSeconds(target?.interval)
  if (targetDuration > 0 && candidateDuration <= 0) return -1
  let durationScore = 0
  if (candidateDuration > 0 && targetDuration > 0) {
    const durationDiff = Math.abs(candidateDuration - targetDuration)
    if (durationDiff > 8) return -1
    durationScore = 8 - durationDiff
  }

  const nameScore = candidateName === targetName ? 20 : 10
  const candidateAlbum = normalizeSongMatchText(candidate?.albumName)
  const targetAlbum = normalizeSongMatchText(target?.albumName)
  const albumScore = candidateAlbum && targetAlbum && candidateAlbum === targetAlbum ? 3 : 0
  return nameScore + durationScore + albumScore
}

/**
 * 在「有自定义源能解析」的其它平台并发搜同一首歌，按相似度降序返回候选。
 * 结果按 (用户, 原平台, 歌名, 歌手, 时长) 缓存 60s——同一首歌在自动播放列表里
 * 会被反复请求，而平台搜索是整条链路上最慢的一环。
 */
export const findServerSourceMatches = async (songInfo: any, username: string) => {
  if (!songInfo?.name || !songInfo?.singer) return []

  const cacheKey = [
    username,
    songInfo.source,
    normalizeSongMatchText(songInfo.name),
    normalizeSongMatchText(songInfo.singer),
    getSongDurationSeconds(songInfo.interval),
  ].join(':')
  const now = Date.now()
  const cached = sourceMatchCache.get(cacheKey)
  if (cached && cached.expiresAt > now) return cached.promise

  for (const [key, value] of sourceMatchCache) {
    if (value.expiresAt <= now) sourceMatchCache.delete(key)
  }

  const searchSources = AUTO_SOURCE_ORDER.filter(source => (
    source !== songInfo.source && isSourceSupported(source, username) && musicSdk[source]?.musicSearch?.search
  ))
  const query = `${songInfo.name} ${songInfo.singer}`
  // 平台搜索接口很不可靠（Socket Hang Up / 超时都是常态）。任一平台出错时
  // 结果就不能进缓存——否则一次网络抖动会被当成「这首歌在别的平台不存在」，
  // 整整 TTL 内都不再重试，正好把偶发故障放大成持续故障。
  let hadError = false
  const perSource: Record<string, number> = {}
  const bestPerSource: Record<string, string> = {}
  const promise = Promise.all(searchSources.map(async source => {
    try {
      const searchData = await musicSdk[source].musicSearch.search(query, 1, 20)
      const list = Array.isArray(searchData?.list) ? searchData.list : []
      perSource[source] = list.length
      // 记下该平台得分最高的一条。没匹配上时要能一眼看出「是根本没搜到这首歌」
      // 还是「搜到了但被时长/歌手否掉了」。
      let best: any = null
      for (const it of list) {
        const sc = getSongMatchScore(it, songInfo)
        if (sc >= 0 && (best === null || sc > best.__score)) best = { ...it, __score: sc }
      }
      const first = list[0] || {}
      bestPerSource[source] = best
        ? `✓${best.__score} ${best.name}/${best.singer}/${best.interval}`
        : `✗首条=${first.name || '空'}/${first.singer || '空'}/${first.interval || '空'} 目标=${songInfo.name}/${songInfo.singer}/${songInfo.interval}`
      return list.map((item: any) => ({ ...item, source }))
    } catch (err: any) {
      hadError = true
      perSource[source] = -1
      console.warn(`[自动换源] 搜索 ${source} 失败: ${err?.message || err}`)
      return []
    }
  })).then(resultGroups => resultGroups.flat()
    .map(candidate => ({ candidate, score: getSongMatchScore(candidate, songInfo) }))
    .filter(item => item.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.candidate))
    .then(matches => {
      // 跨平台是可选路径，而且会静默失效。把「搜了哪些平台、各搜到几条、
      // 最终几条通过相似度校验」打出来，「为什么这首歌没换源」才看得见。
      console.log(`[自动换源] ${songInfo.name} ${songInfo.singer} | 搜索平台: ${searchSources.join(',') || '(无)'} | 命中: ${JSON.stringify(perSource)} | 通过校验: ${matches.length} | 各平台最佳: ${JSON.stringify(bestPerSource)}`)
      return matches
    })

  const entry = { expiresAt: now + SOURCE_MATCH_CACHE_TTL, promise }
  sourceMatchCache.set(cacheKey, entry)
  void promise.then(() => { if (hadError && sourceMatchCache.get(cacheKey) === entry) sourceMatchCache.delete(cacheKey) })
  return promise
}

/**
 * 规范化歌曲信息，确保收藏列表中的 meta 属性在根节点也可用
 * 解决 SDK 无法识别收藏歌曲音质的问题
 * （抽到 @/server/musicMatch：跨平台解析器也要用它来规范化替身歌曲）
 */
export const normalizeSongInfo = (songInfo: any) => {
  if (!songInfo) return songInfo
  const meta = songInfo.meta || {}

  // 0. 剥 songmid / id 上的平台前缀（wy_493735159 -> 493735159）。
  //
  // 【真实缺陷（2026-10-25 用户报告）】落雪桌面同步来的歌单条目，songmid 字段
  // 被写成了桌面端的 id 格式（带 "wy_" 前缀）。带前缀的 id 对各平台 SDK 都是
  // **无效 id**：官方 API 查不到 → 自定义源竞速里按歌名搜的替身源接管 →
  // 播的是**同名别的歌**（翻唱/现场版/铃声版）—— 用户感知为
  // 「歌单里显示 A 播的是 B」。搜索结果的 songmid 是原生干净的，所以
  // 只有歌单/收藏/默认列表才错位，与用户描述完全吻合。
  // 歌词路由早有同样的修复（[Fix] Normalize ID by stripping source prefix），
  // 这里把对称的修复补到解析入口。**无条件剥**（旧逻辑只在 songmid 缺失时
  // 才从 id 转换并剥前缀，songmid 已存在时直接放行 —— 正是漏掉的情况）。
  // kg 的 songmid 内部可能含下划线（数字_哈希），前缀必须完整匹配 `${source}_`
  // 才剥，不受影响。
  for (const field of ['songmid', 'id'] as const) {
    const v = songInfo[field]
    if (typeof v === 'string' && v.startsWith(`${songInfo.source}_`)) {
      songInfo[field] = v.slice(songInfo.source.length + 1)
    }
  }

  // 1. 处理音质信息 (types / _types)
  if (!songInfo.types && meta) {
    songInfo.types = meta.qualitys || meta.types
  }
  if (!songInfo._types && meta) {
    songInfo._types = meta._qualitys || meta._types
  }

  // 2. 处理基础字段备用根节点映射
  if (!songInfo.albumName && meta.albumName) songInfo.albumName = meta.albumName
  if (!songInfo.albumId && meta.albumId) songInfo.albumId = meta.albumId
  if (!songInfo.img && meta.picUrl) songInfo.img = meta.picUrl
  if (!songInfo.name && meta.name) songInfo.name = meta.name
  if (!songInfo.singer && meta.singer) songInfo.singer = meta.singer
  if (!songInfo.source && meta.source) songInfo.source = meta.source
  if (!songInfo.interval && meta.interval) songInfo.interval = meta.interval

  // 3. 处理通用 ID 转换 (id -> songmid)
  if (!songInfo.songmid) {
    if (meta.songId) {
      songInfo.songmid = meta.songId
    } else if (songInfo.id) {
      const sourcePrefix = `${songInfo.source}_`
      if (typeof songInfo.id === 'string' && songInfo.id.startsWith(sourcePrefix)) {
        songInfo.songmid = songInfo.id.slice(sourcePrefix.length)
      } else {
        songInfo.songmid = songInfo.id
      }
    }
  }

  // 4. 针对各平台 SDK 所需的特定字段进行补全
  switch (songInfo.source) {
    case 'wy': // 网易
      if (!songInfo.id && meta.songId) songInfo.id = Number(meta.songId)
      if (!songInfo.songmid && songInfo.id) songInfo.songmid = String(songInfo.id)
      break

    case 'kg': // 酷狗
      if (!songInfo.hash && meta.hash) songInfo.hash = meta.hash
      // 兼容某些 SDK 可能需要的 songmid 格式 (数字_哈希 或 仅哈Hash)
      break

    case 'tx': // 腾讯
      if (!songInfo.strMediaMid && meta.strMediaMid) songInfo.strMediaMid = meta.strMediaMid
      if (!songInfo.albumMid && meta.albumMid) songInfo.albumMid = meta.albumMid
      // 只有当 meta 中的 songId 是纯数字时才回填至 root.songId，否则保持 undefined 触发 SDK 自动获取
      const metaSongId = String(meta.songId || '')
      if (/^\d+$/.test(metaSongId)) {
        songInfo.songId = metaSongId
      }
      break

    case 'mg': // 咪咕
      if (!songInfo.copyrightId && meta.copyrightId) songInfo.copyrightId = meta.copyrightId
      if (!songInfo.lrcUrl && meta.lrcUrl) songInfo.lrcUrl = meta.lrcUrl
      if (!songInfo.songId) songInfo.songId = songInfo.songmid
      break

    case 'kw': // 酷我
      // 已在步骤 3 中通用处理
      break
  }

  return songInfo
}
