/** 音乐下载能力封装：
 *  - 本地直链音乐：直接触发下载；
 *  - 在线聚合音乐：先解析指定/偏好音质直链，再通过服务端 /api/music/download
 *    自动写入 ID3 标签、高清封面与内嵌歌词并推送到浏览器下载。
 */
import { coverUrl, resolveMusicUrl, type Song } from '@/lib/music'
import { savedQuality, qualityLabel, type QualityTier } from '@/lib/quality'

/** 清理文件名中的非法字符（Windows/POSIX 文件名安全） */
export function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'music'
}

/** 根据实得音质或 URL 推导音频扩展名 */
export function inferAudioExtension(quality?: string, url?: string): string {
  const q = (quality ?? '').toLowerCase()
  if (q.includes('flac') || q.includes('hires') || q.includes('lossless') || q.includes('24bit')) {
    return '.flac'
  }
  if (url) {
    const cleanUrl = url.split('?')[0].toLowerCase()
    if (cleanUrl.endsWith('.flac')) return '.flac'
    if (cleanUrl.endsWith('.m4a')) return '.m4a'
    if (cleanUrl.endsWith('.ogg')) return '.ogg'
    if (cleanUrl.endsWith('.wav')) return '.wav'
  }
  return '.mp3'
}

/** 触发浏览器文件下载 */
export function triggerBrowserDownload(url: string, filename: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    document.body.removeChild(a)
  }, 1000)
}

export interface DownloadOptions {
  /** 期望的音质档位；不传则使用用户设置中保存的偏好音质 */
  quality?: QualityTier | string
  /** 是否向服务端请求嵌入 ID3 标签、封面及歌词（默认 true） */
  tag?: boolean
}

export interface DownloadSongResult {
  filename: string
  quality: string
  url: string
}

/** 执行单曲下载：
 *  解析直链 -> 组装 /api/music/download -> 触发下载
 */
export async function downloadSong(
  song: Song,
  options: DownloadOptions = {},
): Promise<DownloadSongResult> {
  const targetQuality = options.quality ?? savedQuality()
  const needTag = options.tag !== false

  // 1. 本地音乐（source === 'local'）
  if (song.source === 'local' && song.url) {
    const ext = inferAudioExtension(undefined, song.url)
    const baseName = sanitizeFilename(`${song.name} - ${song.singer}`)
    const filename = `${baseName}${ext}`
    triggerBrowserDownload(song.url, filename)
    return {
      filename,
      quality: '本地原质',
      url: song.url,
    }
  }

  // 2. 在线音乐：调用解析器获取真实直链
  const resolved = await resolveMusicUrl({
    songInfo: song,
    quality: targetQuality,
  })

  if (!resolved.url) {
    throw new Error('未获取到有效的音频下载地址')
  }

  const effectiveQuality = resolved.quality ?? resolved.type ?? targetQuality
  const ext = inferAudioExtension(effectiveQuality, resolved.url)
  const baseName = sanitizeFilename(`${song.name} - ${song.singer}`)
  const filename = `${baseName}${ext}`

  // 3. 构造服务端下载代理 URL（带打标与歌词参数）
  if (needTag) {
    const params = new URLSearchParams({
      url: resolved.url,
      filename,
      tag: '1',
      name: song.name,
      singer: song.singer,
      album: song.albumName ?? song.meta?.albumName ?? '',
      pic: coverUrl(song) ?? '',
      lyric: '1',
      source: song.source,
      songmid: String(song.songmid ?? song.id ?? ''),
    })
    if (song.interval) {
      params.set('interval', song.interval)
    }

    const downloadHref = `/api/music/download?${params.toString()}`
    triggerBrowserDownload(downloadHref, filename)

    return {
      filename,
      quality: qualityLabel(effectiveQuality) || effectiveQuality,
      url: downloadHref,
    }
  }

  // 4. 不需要打标时直接使用直链下载
  triggerBrowserDownload(resolved.url, filename)
  return {
    filename,
    quality: qualityLabel(effectiveQuality) || effectiveQuality,
    url: resolved.url,
  }
}

export interface BatchDownloadProgress {
  current: number
  total: number
  song: Song
  status: 'resolving' | 'downloading' | 'success' | 'error'
  error?: string
}

/** 批量下载曲目列表（如歌单或专辑）：
 *  采用按序调度 + 适当时间间隔（800ms），避免浏览器并发弹出下载被拦截，
 *  同时避免对后端解析器产生瞬间并发冲击。
 */
export async function downloadSongsQueue(
  songs: Song[],
  options: DownloadOptions & {
    onProgress?: (progress: BatchDownloadProgress) => void
    intervalMs?: number
    signal?: AbortSignal
  } = {},
): Promise<{ success: number; failed: number }> {
  const { onProgress, intervalMs = 800, signal, ...downloadOpts } = options
  let successCount = 0
  let failedCount = 0

  for (let i = 0; i < songs.length; i++) {
    if (signal?.aborted) break
    const song = songs[i]

    onProgress?.({
      current: i + 1,
      total: songs.length,
      song,
      status: 'resolving',
    })

    try {
      await downloadSong(song, downloadOpts)
      successCount++
      onProgress?.({
        current: i + 1,
        total: songs.length,
        song,
        status: 'success',
      })
    } catch (err: unknown) {
      failedCount++
      const message = err instanceof Error ? err.message : '下载失败'
      onProgress?.({
        current: i + 1,
        total: songs.length,
        song,
        status: 'error',
        error: message,
      })
    }

    if (i < songs.length - 1 && !signal?.aborted) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }

  return { success: successCount, failed: failedCount }
}

