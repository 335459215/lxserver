import { Link } from 'react-router-dom'
import { Heart, Loader2, ListMusic, RefreshCw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui'
import { coverUrl } from '@/lib/music'
import { LIST_DEFAULT_ID, LIST_LOVE_ID, type Playlist } from '@/lib/lists'
import { useLists } from '@/lib/useLists'

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

/** 歌单总览：试听列表 + 我的收藏 + 自建/导入歌单 */
export default function PlaylistPage() {
  const { snapshot, loading, error, reload } = useLists()

  return (
    <div className="w-full rise">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">歌单</h1>
        <p className="mt-1 text-sm text-dim">试听列表、我的收藏，以及同步账号里的自建歌单。</p>
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
            <h2 className="text-[11px] font-medium tracking-widest text-faint">内置</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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

          <section className="mt-8">
            <h2 className="text-[11px] font-medium tracking-widest text-faint">
              我的歌单{snapshot.userList.length > 0 && ` · ${snapshot.userList.length}`}
            </h2>
            {snapshot.userList.length === 0 ? (
              <div className="mt-3 rounded-2xl border border-dashed border-line bg-panel/60 p-8 text-center">
                <p className="text-sm font-medium text-ink">还没有自建歌单</p>
                <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-dim">
                  歌单由 LX 客户端（桌面/手机 App）同步上来；也可以先去
                  <Link to="/search" className="mx-1 text-accent hover:underline">
                    搜索
                  </Link>
                  找歌试听。
                </p>
              </div>
            ) : (
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {snapshot.userList.map((l) => (
                  <PlaylistCard key={l.id} playlist={l} />
                ))}
              </div>
            )}
          </section>

          <p className="mt-8 text-xs text-faint">
            内置列表共 {snapshot.defaultList.length + snapshot.loveList.length} 首，
            {snapshot.userList.length} 个自建歌单。
          </p>
        </>
      )}
    </div>
  )
}
