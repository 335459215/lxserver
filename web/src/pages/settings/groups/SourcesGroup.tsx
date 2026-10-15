import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Download, Plus, Trash2, Zap } from 'lucide-react'
import { api, isAdmin, useAuth } from '@/lib/auth'
import { useConfigForm } from '@/lib/useConfig'
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
  SwitchField,
  useToast,
} from '@/components/ui'

interface SourceRow {
  id: string
  name: string
  enabled: boolean
  isPublic?: boolean
  owner?: string
  version?: string
  /** 后端字段名是 supportedSources；保留 platforms 兼容旧响应 */
  supportedSources?: string[]
  platforms?: string[]
  url?: string
  /** 实测响应耗时（毫秒）；无样本时字段不存在 */
  speedMs?: number
  status?: string
  error?: string
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-panel2 px-1.5 py-0.5 text-[11px] text-dim">{children}</span>
}

/** 音源速度标识。
 *
 *  【为什么无样本时什么都不显示，而不是显示「--」或「0ms」】
 *  显示占位符会让人以为「测过了，结果是未知」，而真相是「还没播放过、没数据」。
 *  留空最诚实，也不会在列表里塞满无意义的灰字。
 *
 *  【为什么分档而不是直接显示数字】
 *  用户在设置页要判断的是「这个源快不快」，不是精确到毫秒的读数。
 *  分档能让颜色和图标承载这个判断，扫一眼就够；精确值放在 title 里供排障。 */
function SpeedBadge({ ms }: { ms?: number }) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null

  // 分档阈值取常见实际体验：<400ms 几乎无感，<1200ms 可接受，再慢就有明显等待
  //
  // ⚠️ 只用设计系统里真实存在的语义色（ok / dim / danger）。
  // 这里原本写的是 text-warn，而 tailwind.config.cjs 里**没有 warn** ——
  // 类名会静默不生成，表现为「慢源没有任何视觉提示」，很难发现。
  const tone =
    ms < 400
      ? 'text-ok bg-ok/10'
      : ms < 1200
        ? 'text-dim bg-panel2'
        : 'text-danger bg-danger/10'

  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${tone}`}
      title={`实测响应耗时 ${ms}ms（由链接探测顺带测量，不额外增加播放延迟）`}
    >
      <Zap className="size-3" />
      {ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`}
    </span>
  )
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

/** 脚本运行安全：`system.allowUnsafeVM`。
 *
 *  【为什么从「系统」搬到这里】
 *  这个开关唯一的作用是「允不允许自定义音源脚本以 VM 模式运行」——
 *  它管的就是本页这些脚本，放在「系统」里用户根本联想不到。
 *  按归属归类：谁的对象，就放在谁的页面。 */
function ScriptSafetySection() {
  const { toast } = useToast()
  const { draft, set, submit, busy, config, error } = useConfigForm(
    ['system.allowUnsafeVM'],
    { 'system.allowUnsafeVM': false },
  )

  if (error) return <div className="text-sm text-danger">{error}</div>
  if (!config) return <div className="text-sm text-dim">加载中…</div>

  return (
    <section className="rounded-2xl border border-line bg-panel p-5 shadow-card">
      <h3 className="text-sm font-medium text-ink">脚本运行安全</h3>
      <div className="mt-3">
        <SwitchField
          label="允许不安全 VM 模式"
          description="部分音源脚本需要原生 VM 才能运行。开启等于让这些脚本在本机执行任意代码，仅对可信来源开启。"
          checked={!!draft['system.allowUnsafeVM']}
          onChange={(v) => set('system.allowUnsafeVM', v)}
        />
      </div>
      <div className="mt-4 flex justify-end">
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            try {
              const n = await submit()
              toast(n === 0 ? { title: '无变更' } : { title: '已保存', description: `${n} 项`, variant: 'success' })
            } catch (e: unknown) {
              toast({ title: '保存失败', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
            }
          }}
        >
          {busy ? '保存中…' : '保存'}
        </Button>
      </div>
    </section>
  )
}

/** 音源组：自定义音源 CRUD（导入/启用/禁用/排序/删除）+ 脚本运行安全。
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
      <ScriptSafetySection />

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
                {/* 第一行只放「源名 + 速度」。
                 *
                 * 【为什么版本要挪到第二行】
                 * 版本号有的极长（实测「v9.3 93特供版 DeepSeek优化」），
                 * 和源名挤在同一行时会把名字压成「全…」——
                 * 而用户扫列表时先看的是「这是哪个源」，不是版本。
                 * 现在名字独占第一行（只让出速度标识那点宽度），
                 * 版本与平台一起放第二行，长了也只是换行、不影响识别。 */}
                <div className="flex items-center gap-2">
                  {/* min-w-0 让 truncate 生效；速度标识 shrink-0 保证不被压变形 */}
                  <span className="min-w-0 truncate text-sm font-medium text-ink">{s.name}</span>
                  <span className="shrink-0">
                    <SpeedBadge ms={s.speedMs} />
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  {s.version && <Badge>v{s.version}</Badge>}
                  {s.isPublic && <Badge>公开</Badge>}
                  {(s.supportedSources ?? s.platforms ?? []).map((p) => <Badge key={p}>{p}</Badge>)}
                </div>
              </div>
              {/* 右侧操作区。窄屏隐藏「上移/下移」两个排序按钮 ——
               *  实测 430px 视口下这一行只有 430px，右侧四个控件要吃掉 164px，
               *  与左侧信息列等宽，把源名挤到只剩 164px（差 11px 显示不全）。
               *  排序在手机上极少用（且可用导入顺序表达），隐藏它换取源名完整显示。
               *  md 及以上恢复显示，桌面端操作不变。 */}
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost" size="icon" aria-label="上移"
                  className="hidden md:inline-flex"
                  onClick={() => reorder(i, -1)} disabled={i === 0}
                >
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  variant="ghost" size="icon" aria-label="下移"
                  className="hidden md:inline-flex"
                  onClick={() => reorder(i, 1)} disabled={i === sources.length - 1}
                >
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
