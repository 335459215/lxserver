import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Heart, ListMusic, Loader2, Plus, RefreshCw, TriangleAlert } from 'lucide-react'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  useToast,
} from '@/components/ui'
import { coverUrl } from '@/lib/music'
import { createPlaylist, LIST_DEFAULT_ID, LIST_LOVE_ID, type Playlist } from '@/lib/lists'
import { useLists } from '@/lib/useLists'
import { PlaylistTransferButtons } from '@/components/player/PlaylistTransfer'

/** 歌单卡片：封面取第一首有封面的曲目 */
function PlaylistCard({ playlist, icon }: { playlist: Playlist; icon?: 'heart' | 'list' }) {
  const cover = playlist.songs.map((s) => coverUrl(s)).find(Boolean)
  const Icon = icon === 'heart' ? Heart : ListMusic

  return (
    <Link
      to={`/playlist/${encodeURIComponent(playlist.id)}`}
      className="group flex items-center gap-3 rounded-2xl border border-line bg-panel p-3 shadow-card transition-all hover:border-accent/40 hover:shadow-pop"
    >
      {cover ? (
        <img
          src={cover}
          alt=""
          loading="lazy"
          className="size-14 shrink-0 rounded-xl border border-line object-cover"
        />
      ) : (
        <span className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-line bg-panel2 text-faint">
          <Icon className="size-5" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{playlist.name}</span>
        <span className="block truncate text-xs text-faint">{playlist.songs.length} 首</span>
      </span>
    </Link>
  )
}

/** 新建歌单：输入名字 → 服务端整份恢复写回 → 直接进新歌单页加歌。
 *
 *  【为什么建完要跳进去】
 *  刚建的歌单一定是空的，停在列表页只会看到多了一张「0 首」的卡片，
 *  用户下一步必然是想往里加歌。直接送进详情页，那里有搜索入口，少一次点击。 */
function CreatePlaylistDialog({ onDone }: { onDone: (id: string) => void }) {
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    try {
      const id = await createPlaylist(trimmed)
      toast({ title: '歌单已创建', description: trimmed, variant: 'success' })
      setOpen(false)
      setName('')
      onDone(id)
    } catch (e: unknown) {
      toast({
        title: '创建失败',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setName('') }}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" /> 新建歌单
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建歌单</DialogTitle>
          <DialogDescription>给歌单起个名字，建好后就能往里加歌。</DialogDescription>
        </DialogHeader>
        <div className="mt-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：深夜循环"
            autoFocus
            maxLength={60}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
          />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" type="button">取消</Button>
          </DialogClose>
          <Button onClick={submit} disabled={busy || !name.trim()}>
            {busy ? '创建中…' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 歌单总览：试听列表 + 我的收藏 + 自建歌单（可新建）。 */
export default function PlaylistPage() {
  const { snapshot, loading, error, reload } = useLists()
  const navigate = useNavigate()

  return (
    <div className="w-full rise">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-ink">歌单</h1>
        <div className="flex items-center gap-2">
          <PlaylistTransferButtons onDone={() => void reload(true)} />
          <CreatePlaylistDialog onDone={(id) => navigate(`/playlist/${encodeURIComponent(id)}`)} />
        </div>
      </header>

      {loading && (
        <div className="flex items-center gap-2 py-16 text-sm text-dim">
          <Loader2 className="size-4 animate-spin" /> 正在读取歌单…
        </div>
      )}

      {error && !loading && (
        <div className="mt-6 rounded-2xl border border-dashed border-line bg-panel/60 p-10 text-center">
          <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-panel2 text-danger">
            <TriangleAlert className="size-5" />
          </span>
          <p className="mt-3 text-sm font-medium text-ink">读不到歌单</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-dim">{error}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => void reload()}>
            <RefreshCw className="size-3.5" /> 重试
          </Button>
        </div>
      )}

      {snapshot && !loading && !error && (
        <>
          <section className="mt-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <PlaylistCard
                playlist={{ id: LIST_DEFAULT_ID, name: '试听列表', songs: snapshot.defaultList }}
                icon="list"
              />
              <PlaylistCard
                playlist={{ id: LIST_LOVE_ID, name: '我的收藏', songs: snapshot.loveList }}
                icon="heart"
              />
            </div>
          </section>

          {/* 自建歌单：有就列出来，没有就什么都不显示（不再摆一个虚线空框） */}
          {snapshot.userList.length > 0 && (
            <section className="mt-8">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {snapshot.userList.map((l) => (
                  <PlaylistCard key={l.id} playlist={l} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
