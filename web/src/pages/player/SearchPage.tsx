import { useState } from 'react'
import { Search } from 'lucide-react'
import { Button, Input, Stack, useToast } from '@/components/ui'

/** 搜索页壳：入口与空态就位；「搜索 → 解析 → 播放」闭环下一版本接入。
 * 接口面见 docs/stage0/api-and-state-map.md：/api/music/search（无鉴权）、
 * /api/music/url（播放核心）均现成，本轮不调用。 */
export default function SearchPage() {
  const [keyword, setKeyword] = useState('')
  const { toast } = useToast()

  return (
    <Stack gap={6} className="w-full rise">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">搜索</h1>
        <p className="mt-1 text-sm text-dim">聚合主流平台音源，搜到即可播放。</p>
      </header>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const q = keyword.trim()
          if (!q) return
          toast({
            title: '搜索结果下一版本接入',
            description: `「${q}」的聚合搜索与播放链路（search → url → 播放栏）下一版本打通。`,
          })
        }}
      >
        <Input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索歌曲、歌手、专辑…"
          aria-label="搜索关键词"
          autoComplete="off"
        />
        <Button type="submit" disabled={!keyword.trim()}>
          <Search className="size-4" /> 搜索
        </Button>
      </form>

      <div className="rounded-2xl border border-dashed border-line bg-panel/60 p-10 text-center">
        <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-panel2 text-faint">
          <Search className="size-5" />
        </span>
        <p className="mt-3 text-sm font-medium text-ink">输入关键词开始搜索</p>
        <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-dim">
          聚合搜索接口已就绪；结果列表与点歌播放在下一版本接入，播放后由底部播放栏接管。
        </p>
      </div>
    </Stack>
  )
}
