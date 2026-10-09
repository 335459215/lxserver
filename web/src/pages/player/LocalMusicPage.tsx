import * as React from 'react'
import { Link } from 'react-router-dom'
import { FileMusic, Loader2, Play, RefreshCw, Search, TriangleAlert } from 'lucide-react'
import { Button, Input, Stack, useToast } from '@/components/ui'
import { formatTotalDuration, intervalToSeconds } from '@/lib/music'
import { syncLocalMusic, toPlayableSong, useLocalMusic } from '@/lib/localMusic'
import { usePlayer } from '@/lib/player'
import SongList from '@/components/player/SongList'

/** 本地音乐页（`/local`）：服务端「自定义音乐目录」里的音频文件。
 *
 *  与在线曲目的两处不同（都在 lib/localMusic.ts 里说明）：
 *  1. 播放走直链（`Song.url`），不经解析器；
 *  2. 封面/音频流用 query 带鉴权（`<audio>`/`<img>` 没法带请求头）。
 *
 *  目录本身的配置（路径、是否允许写入）是服务端用户级设置，本页只读展示；
 *  这里提供「重新扫描」用于目录里新增/删除文件后刷新索引。 */
export default function LocalMusicPage() {
  const player = usePlayer()
  const { toast } = useToast()

  const [keyword, setKeyword] = React.useState('')
  const [syncing, setSyncing] = React.useState(false)
  const res = useLocalMusic()

  const tracks = React.useMemo(() => res.data?.list ?? [], [res.data])

  const filtered = React.useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return tracks
    return tracks.filter((t) =>
      `${t.name} ${t.singer} ${t.album ?? ''}`.toLowerCase().includes(q),
    )
  }, [tracks, keyword])

  const songs = React.useMemo(() => filtered.map(toPlayableSong), [filtered])

  const totalSeconds = React.useMemo(
    () => tracks.reduce((sum, t) => sum + intervalToSeconds(t.interval), 0),
    [tracks],
  )
  const totalSize = React.useMemo(
    () => tracks.reduce((sum, t) => sum + (typeof t.size === 'number' ? t.size : 0), 0),
    [tracks],
  )

  const rescan = React.useCallback(async () => {
    setSyncing(true)
    try {
      await syncLocalMusic()
      res.reload()
      toast({ title: '已重新扫描本地目录', description: '索引已更新' })
    } catch (e) {
      toast({
        title: '重新扫描失败',
        description: e instanceof Error ? e.message : '未知错误',
      })
    } finally {
      setSyncing(false)
    }
  }, [res, toast])

  const playAll = React.useCallback(() => {
    if (!songs.length) return
    player.playQueue(songs, 0)
    toast({ title: `开始播放全部 ${songs.length} 首`, description: '本地音乐' })
  }, [player, songs, toast])

  return (
    <Stack gap={5} className="w-full rise">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">本地音乐</h1>
          <p className="mt-1 text-sm text-dim">服务端音乐目录里的歌曲，直接播放、不依赖在线音源。</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void rescan()} disabled={syncing}>
          {syncing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          重新扫描
        </Button>
      </header>

      {res.status === 'loading' && <RowsSkeleton />}

      {/* 未以用户身份登录时不会发请求（见 useLocalMusic），这里给明确指引 */}
      {res.status === 'idle' && (
        <div className="rounded-2xl border border-dashed border-line bg-panel/60 p-10 text-center">
          <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-panel2 text-faint">
            <FileMusic className="size-5" />
          </span>
          <p className="mt-3 text-sm font-medium text-ink">需要以用户身份登录</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-dim">
            本地曲库属于登录账号（目录按用户配置），管理员密码看不到它。请先用用户身份登录。
          </p>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link to="/settings/users">去登录</Link>
          </Button>
        </div>
      )}

      {res.status === 'error' && (
        <div className="rounded-2xl border border-dashed border-danger/40 bg-danger/5 p-8 text-center">
          <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-panel2 text-danger">
            <TriangleAlert className="size-5" />
          </span>
          <p className="mt-3 text-sm font-medium text-ink">读取本地曲库失败</p>
          <p className="mx-auto mt-1 max-w-md break-words text-xs leading-relaxed text-dim">{res.error}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={res.reload}>
            重试
          </Button>
        </div>
      )}

      {res.status === 'ready' && tracks.length === 0 && (
        <div className="rounded-2xl border border-dashed border-line bg-panel/60 p-10 text-center">
          <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-panel2 text-faint">
            <FileMusic className="size-5" />
          </span>
          <p className="mt-3 text-sm font-medium text-ink">还没有扫描到本地音乐</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-dim">
            本页读取的是服务端为当前账号配置的「自定义音乐目录」。请确认该目录已设置且里面有可识别的音频文件
            （支持 mp3 / flac / m4a / ogg / wav / ape，文件名形如「歌手 - 歌名」时能自动解析出标签）。
          </p>
          <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-faint">
            目录路径属于服务端用户配置，可在旧版播放器的「本地音乐」页或用户管理里设置。
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => void rescan()} disabled={syncing}>
            {syncing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            重新扫描
          </Button>
        </div>
      )}

      {res.status === 'ready' && tracks.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-dim">
              共 {tracks.length} 首
              {totalSeconds > 0 && ` · ${formatTotalDuration(totalSeconds)}`}
              {totalSize > 0 && ` · ${formatSize(totalSize)}`}
            </p>
            <Button size="sm" onClick={playAll} disabled={!songs.length}>
              <Play className="size-3.5 fill-current" /> 播放全部
            </Button>
          </div>

          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="在本地区库内筛选…"
              aria-label="筛选本地音乐"
              autoComplete="off"
              className="pl-9"
            />
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-panel/60 p-8 text-center text-sm text-dim">
              没有匹配「{keyword}」的曲目。
            </div>
          ) : (
            <section>
              {keyword.trim() && (
                <p className="mb-2 text-xs text-faint">
                  匹配 {filtered.length} / {tracks.length} 首
                </p>
              )}
              <SongList songs={songs} onPlay={(_song, i) => player.playQueue(songs, i)} />
            </section>
          )}
        </>
      )}
    </Stack>
  )
}

/** 本地文件大小：按 MB 展示，小于 1MB 用 KB */
function formatSize(bytes: number): string {
  const mb = bytes / 1024 / 1024
  if (mb >= 1) return `${mb.toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function RowsSkeleton() {
  return (
    <ul className="space-y-1" aria-busy="true">
      {Array.from({ length: 8 }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 rounded-xl px-3 py-2.5">
          <span className="h-3 w-6 rounded bg-panel2" />
          <span className="size-10 shrink-0 rounded-lg bg-panel2" />
          <span className="flex-1 space-y-1.5">
            <span className="block h-3 w-1/3 rounded bg-panel2" />
            <span className="block h-2.5 w-1/4 rounded bg-panel2" />
          </span>
        </li>
      ))}
    </ul>
  )
}
