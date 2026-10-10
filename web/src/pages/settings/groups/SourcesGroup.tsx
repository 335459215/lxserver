import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Download, Plus, Trash2 } from 'lucide-react'
import { api, isAdmin, useAuth } from '@/lib/auth'
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
  Stack,
  Switch,
  useToast,
} from '@/components/ui'

interface SourceRow {
  id: string
  name: string
  enabled: boolean
  isPublic?: boolean
  owner?: string
  version?: string
  platforms?: string[]
  url?: string
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-panel2 px-1.5 py-0.5 text-[11px] text-dim">{children}</span>
}

/** 导入音源 Dialog：粘贴脚本 → 验证 → 展示元数据 → 确认导入 */
function ImportSourceDialog({ onDone }: { onDone: () => void }) {
  const { toast } = useToast()
  const [script, setScript] = useState('')
  const [allowUnsafeVM, setAllowUnsafeVM] = useState(false)
  const [metadata, setMetadata] = useState<{ name?: string; version?: string; platforms?: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<'paste' | 'validated'>('paste')

  const validate = async () => {
    setBusy(true)
    try {
      const res = await api.sources.validate(script, allowUnsafeVM)
      if (res.ok) {
        const data = await res.json()
        setMetadata(data.metadata || data)
        setStep('validated')
        toast({ title: '验证通过', variant: 'success' })
      } else {
        const text = await res.text()
        toast({ title: '验证失败', description: text.slice(0, 120), variant: 'destructive' })
      }
    } finally {
      setBusy(false)
    }
  }

  const importSource = async () => {
    setBusy(true)
    try {
      const res = await api.sources.import(script, allowUnsafeVM)
      if (res.ok) {
        toast({ title: '音源已导入', variant: 'success' })
        setScript('')
        setMetadata(null)
        setStep('paste')
        onDone()
      } else {
        const text = await res.text()
        toast({ title: '导入失败', description: text.slice(0, 120), variant: 'destructive' })
      }
    } finally {
      setBusy(false)
    }
  }

  const reset = () => {
    setScript('')
    setMetadata(null)
    setStep('paste')
  }

  return (
    <Dialog onOpenChange={(open) => !open && reset()}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" /> 导入源
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>导入自定义音源</DialogTitle>
          <DialogDescription>
            粘贴自定义音源脚本内容（JS），先验证再导入。导入后可启用/禁用/排序。
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2 space-y-3">
          <textarea
            className="h-48 w-full rounded-lg border border-line bg-panel2 p-3 font-mono text-xs text-ink focus-visible:border-accent focus-visible:outline-none"
            placeholder="// 粘贴音源脚本..."
            value={script}
            onChange={(e) => {
              setScript(e.target.value)
              if (step === 'validated') setStep('paste')
            }}
            autoFocus
          />
          <label className="flex items-center gap-2 text-xs text-dim">
            <Switch checked={allowUnsafeVM} onCheckedChange={setAllowUnsafeVM} />
            允许不安全 VM（仅可信源）
          </label>

          {step === 'validated' && metadata && (
            <div className="rounded-lg border border-ok/30 bg-ok/5 p-3">
              <div className="text-sm font-medium text-ink">{metadata.name ?? '未知名称'} {metadata.version && <span className="text-dim">v{metadata.version}</span>}</div>
              {metadata.platforms && metadata.platforms.length > 0 && (
                <div className="mt-1 flex gap-1.5">
                  {metadata.platforms.map((p) => <Badge key={p}>{p}</Badge>)}
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" type="button">取消</Button>
          </DialogClose>
          {step === 'paste' ? (
            <Button onClick={validate} disabled={busy || !script.trim()}>
              {busy ? '验证中…' : '验证'}
            </Button>
          ) : (
            <Button onClick={importSource} disabled={busy}>
              {busy ? '导入中…' : '确认导入'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteSourceDialog({ source, onDone }: { source: SourceRow; onDone: () => void }) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      const res = await api.sources.delete(source.id)
      if (res.ok) {
        toast({ title: '已删除', description: source.name, variant: 'success' })
        onDone()
      } else {
        toast({ title: '删除失败', variant: 'destructive' })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="删除">
          <Trash2 className="size-4 text-danger" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>删除音源「{source.name}」？</DialogTitle>
          <DialogDescription>此操作不可撤销，会同时清除该源的缓存。</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild><Button variant="ghost">取消</Button></DialogClose>
          <Button variant="destructive" onClick={submit} disabled={busy}>
            {busy ? '删除中…' : '确认删除'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 音源组：自定义音源 CRUD（导入/启用/禁用/排序/删除）。
 * 增删改会作废服务端粘滞缓存与熔断状态（服务端 toggle/delete handler 已处理）。 */
export default function SourcesGroup() {
  const { auth } = useAuth()
  const { toast } = useToast()
  const [sources, setSources] = useState<SourceRow[] | null>(null)
  const [error, setError] = useState('')

  const load = () =>
    api
      .sources.list()
      .then(setSources)
      .catch((e: unknown) => setError(String(e instanceof Error ? e.message : e)))

  useEffect(() => {
    void load()
  }, [])

  const toggle = async (id: string, enabled: boolean) => {
    // 乐观更新
    setSources((prev) => prev?.map((s) => (s.id === id ? { ...s, enabled } : s)) ?? null)
    try {
      const res = await api.sources.toggle(id, enabled)
      if (!res.ok) {
        toast({ title: '切换失败', variant: 'destructive' })
        void load()
      }
    } catch {
      void load()
    }
  }

  const reorder = async (index: number, direction: -1 | 1) => {
    if (!sources) return
    const newIndex = index + direction
    if (newIndex < 0 || newIndex >= sources.length) return
    const reordered = [...sources]
    ;[reordered[index], reordered[newIndex]] = [reordered[newIndex], reordered[index]]
    setSources(reordered)
    try {
      await api.sources.reorder(reordered.map((s) => s.id))
    } catch {
      void load()
    }
  }

  if (!isAdmin(auth)) return <div className="text-sm text-dim">需要管理员账号。</div>
  if (error) return <div className="text-sm text-danger">{error}</div>
  if (!sources) return <div className="text-sm text-dim">加载中…</div>

  return (
    <Stack gap={3}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-ink">自定义音源</h3>
          <p className="mt-0.5 text-xs text-dim">共 {sources.length} 个源；增删改会作废解析器粘滞缓存与熔断状态。</p>
        </div>
        <ImportSourceDialog onDone={load} />
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-panel shadow-card">
        <div className="divide-y divide-line">
          {sources.map((s, i) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-ink">{s.name}</span>
                  {s.version && <Badge>v{s.version}</Badge>}
                  {s.isPublic && <Badge>公开</Badge>}
                </div>
                {s.platforms && s.platforms.length > 0 && (
                  <div className="mt-0.5 flex gap-1.5">
                    {s.platforms.map((p) => <Badge key={p}>{p}</Badge>)}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" aria-label="上移" onClick={() => reorder(i, -1)} disabled={i === 0}>
                  <ArrowUp className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label="下移" onClick={() => reorder(i, 1)} disabled={i === sources.length - 1}>
                  <ArrowDown className="size-4" />
                </Button>
                <Switch checked={s.enabled} onCheckedChange={(v) => void toggle(s.id, v)} />
                <DeleteSourceDialog source={s} onDone={load} />
              </div>
            </div>
          ))}
          {sources.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-faint">
              <Download className="mx-auto mb-2 size-6 text-faint" />
              暂无音源，点右上角导入
            </div>
          )}
        </div>
      </div>
    </Stack>
  )
}
