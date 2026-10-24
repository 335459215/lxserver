import * as React from 'react'
import { Download, Loader2, Upload } from 'lucide-react'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, useToast } from '@/components/ui'
import { fetchLists, restoreLists, type ListsSnapshot } from '@/lib/lists'
import {
  buildExport,
  mergeImport,
  parseImport,
  type MergeSummary,
  type RawListData,
} from '@/lib/playlistTransfer'

/** 快照 → wire 形状（userList 曲目字段名不同：songs → list） */
function snapshotToRaw(snap: ListsSnapshot): RawListData {
  return {
    defaultList: snap.defaultList,
    loveList: snap.loveList,
    userList: snap.userList.map((p) => ({ ...p, list: p.songs })),
  }
}

function stamp(): string {
  const d = new Date()
  const two = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`
}

/** 歌单导入 / 导出（v2.37.0）。
 *
 *  导出：拉最新全量 → 本站信封 JSON 下载。
 *  导入：解析（兼容本站信封 / 落雪桌面 play_list / 裸服务端形状）→ 拉**最新**全量 →
 *  内存合并（现有的全保留，绝不整份替换）→ 确认对话框 → 整份写回。
 *  【为什么导入前要确认】写回走的是全量恢复接口，合并逻辑再稳也不该
 *  让「选了个文件」直接等于「改了我全部歌单」—— 误选文件是高频操作。 */
export function PlaylistTransferButtons({ onDone }: { onDone: () => void }) {
  const { toast } = useToast()
  const fileRef = React.useRef<HTMLInputElement | null>(null)
  const [pending, setPending] = React.useState<{
    next: RawListData
    summary: MergeSummary
    fileName: string
  } | null>(null)
  const [busy, setBusy] = React.useState(false)

  const onExport = async () => {
    try {
      const snap = await fetchLists()
      const text = buildExport(snapshotToRaw(snap))
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `lxserver-歌单-${stamp()}.json`
      a.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 5000)
      toast({
        title: '已导出歌单',
        description: `自建歌单 ${snap.userList.length} 个 · 收藏 ${snap.loveList.length} 首`,
      })
    } catch (e) {
      toast({
        title: '导出失败',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    }
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // 清掉选择，同一个文件再次选择也能触发 change
    e.target.value = ''
    if (!file) return
    try {
      const imported = parseImport(await file.text())
      // 用最新全量做基底，不用页面快照 —— 页面上的可能已过期
      const current = snapshotToRaw(await fetchLists())
      const { next, summary } = mergeImport(current, imported)
      if (summary.newLists + summary.mergedLists + summary.newSongs === 0) {
        toast({ title: '备份里的歌曲都已存在', description: '没有需要导入的内容' })
        return
      }
      setPending({ next, summary, fileName: file.name })
    } catch (err) {
      toast({
        title: '无法导入这个文件',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    }
  }

  const confirmImport = async () => {
    if (!pending || busy) return
    setBusy(true)
    try {
      await restoreLists(pending.next)
      const s = pending.summary
      toast({
        title: '导入完成',
        description: `新增歌单 ${s.newLists} 个、并入已有歌单 ${s.mergedLists} 个、新增歌曲 ${s.newSongs} 首`,
      })
      setPending(null)
      onDone()
    } catch (e) {
      toast({
        title: '导入失败',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        aria-label="选择歌单备份文件"
        onChange={(e) => void onFile(e)}
      />
      <Button
        variant="outline"
        size="sm"
        onClick={() => void onExport()}
        aria-label="导出歌单"
        title="把全部歌单导出为 JSON 备份"
      >
        <Download className="size-3.5" /> 导出
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => fileRef.current?.click()}
        aria-label="导入歌单"
        title="从 JSON 备份导入歌单（与本站导出、落雪桌面歌单备份互通）"
      >
        <Upload className="size-3.5" /> 导入
      </Button>

      <Dialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>确认导入歌单？</DialogTitle>
            <DialogDescription>
              {pending
                ? `「${pending.fileName}」：新增歌单 ${pending.summary.newLists} 个、并入已有歌单 ${pending.summary.mergedLists} 个、新增歌曲 ${pending.summary.newSongs} 首。现有歌单与歌曲全部保留。`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPending(null)}>
              取消
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void confirmImport()}>
              {busy && <Loader2 className="size-3.5 animate-spin" />} 确认导入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
