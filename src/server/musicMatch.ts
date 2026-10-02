/**
 * 跨平台歌曲匹配：把「在别的平台按歌名+歌手搜到替身」这件事从 server.ts 里抽出来。
 *
 * 单独成模块的原因：server.ts 与 subsonic.ts 互相都要用这套匹配逻辑（前者走 /api/music/url，
 * 后者走 Subsonic stream），但 server.ts import 了 subsonic.ts。逻辑留在 server.ts 里的话，
 * subsonic.ts 反向 import 会形成循环依赖，所以抽到这里由两边共同依赖。
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

  const candidateDuration = getSongDurationSeconds(candidate?.interval)
  const targetDuration = getSongDurationSeconds(target?.interval)
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
