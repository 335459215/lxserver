import * as React from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Search, UserRound } from 'lucide-react'
import { Button, Stack } from '@/components/ui'
import { sourceLabel } from '@/lib/music'
import { searchSingers, supportsArtistPages, useAsyncResource } from '@/lib/discover'

/** 按名字解析到歌手页（`/artist-name/:name?source=`）。
 *
 *  为什么需要它：歌曲只带 `singer` 名字、不带歌手 id，所以列表里点歌手名时无法直接拼出
 *  `/artist/:id`。这里用歌手搜索拿到 id，命中后 **replace 重定向** 到正式歌手页，
 *  用户只感知到「点歌手名 → 进了歌手页」一步。
 *
 *  匹配策略：优先取与输入**完全同名**的歌手（搜索会把名字相近的也返回，如「周杰伦.」「周杰伦♚」），
 *  没有完全同名才退而取第一条。 */
export default function ArtistNamePage() {
  const { name = '' } = useParams()
  const [params] = useSearchParams()
  const source = params.get('source') ?? 'wy'
  const navigate = useNavigate()

  const supported = supportsArtistPages(source)
  // useParams 返回的已经是解码后的值，不要再 decodeURIComponent（会二次解码）
  const keyword = name

  const res = useAsyncResource(
    supported && keyword ? `singerResolve:${source}:${keyword}` : '',
    React.useCallback(
      (signal: AbortSignal) => searchSingers({ name: keyword, source, signal }),
      [keyword, source],
    ),
  )

  const hit = React.useMemo(() => {
    const list = res.data ?? []
    if (!list.length) return null
    return list.find((s) => s.name === keyword) ?? list[0]
  }, [res.data, keyword])

  if (!supported) {
    return (
      <Stack gap={5} className="w-full rise">
        <BackLink onClick={() => navigate(-1)} />
        <div className="rounded-2xl border border-dashed border-line bg-panel/60 p-10 text-center">
          <p className="text-sm font-medium text-ink">该平台暂不支持歌手页</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-dim">
            「{sourceLabel(source)}」没有歌手接口。请在网易云或 QQ音乐 下浏览歌手。
          </p>
        </div>
      </Stack>
    )
  }

  if (hit) {
    return <Navigate to={`/artist/${encodeURIComponent(String(hit.id))}?source=${encodeURIComponent(source)}`} replace />
  }

  if (res.status === 'loading' || res.status === 'idle') {
    return (
      <Stack gap={5} className="w-full rise">
        <BackLink onClick={() => navigate(-1)} />
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-panel p-6">
          <span className="size-12 shrink-0 animate-pulse rounded-full bg-panel2" />
          <span className="flex-1 space-y-2">
            <span className="block h-3.5 w-32 rounded bg-panel2" />
            <span className="block h-3 w-20 rounded bg-panel2" />
          </span>
        </div>
      </Stack>
    )
  }

  return (
    <Stack gap={5} className="w-full rise">
      <BackLink onClick={() => navigate(-1)} />
      <div className="rounded-2xl border border-dashed border-line bg-panel/60 p-10 text-center">
        <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-panel2 text-faint">
          <UserRound className="size-5" />
        </span>
        <p className="mt-3 text-sm font-medium text-ink">没找到歌手「{keyword}」</p>
        <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-dim">
          {res.error ? `搜索失败：${res.error}` : '可能是名字写法不一致，或该歌手在音乐库里没有独立条目。'}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to={`/search?q=${encodeURIComponent(keyword)}&source=${encodeURIComponent(source)}`}>
              <Search className="size-3.5" /> 按歌曲搜索
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={res.reload}>
            重试
          </Button>
        </div>
      </div>
    </Stack>
  )
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-fit items-center gap-1.5 text-xs text-dim transition-colors hover:text-ink"
    >
      <ArrowLeft className="size-3.5" /> 返回
    </button>
  )
}
