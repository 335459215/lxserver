import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Download,
  FileText,
  Link2,
  Loader2,
  Plus,
  Power,
  PowerOff,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { api, isAdmin, useAuth, type SourceBatchResult } from '@/lib/auth'
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
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

interface PickedScriptFile {
  file: File
  name: string
  size: number
}

/** 与服务端 SOURCE_BATCH_LIMIT 保持一致；超过就让用户分批，避免一次拉满 VM。 */
const MAX_IMPORT_ITEMS = 50
/** 与服务端 SOURCE_MAX_BYTES 保持一致。 */
const MAX_SCRIPT_BYTES = 2 * 1024 * 1024
/** 与服务端 SOURCE_BATCH_TOTAL_TIMEOUT_MS 保持一致（90s）。
 *  前端到点仍未收到响应，直接按超时收口，不等浏览器默认那几分钟。 */
const BATCH_TIMEOUT_MS = 90_000
/** 服务端单条预算（SOURCE_IMPORT_ITEM_TIMEOUT_MS）。用于把提示说清楚。 */
const ITEM_TIMEOUT_MS = 25_000

function prettySize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 导入音源 Dialog（v2.49 批量版）。
 *
 *  支持三条路径：
 *    1. 多个链接：一行一个，空行忽略；重复链接自动去重；
 *    2. 多个本地脚本：一次多选 .js/.mjs/.cjs/.json，单文件 ≤2MB；
 *    3. 粘贴单个脚本内容（保留老用法，先验证再导入）。
 *
 *  【为什么批量结果不直接弹 toast 就完事】
 *  一次导入十几个源，用户必须知道「哪几个进来了、哪几个因为重复/VM/抓取失败没进来」，
 *  否则只能对着列表猜。结果面板逐条给出状态与原因，失败项还能照着改。
 */
function ImportSourceDialog({ onDone }: { onDone: () => void }) {
  const { toast } = useToast()
  const [tab, setTab] = useState<'links' | 'files' | 'paste'>('links')
  const [urlText, setUrlText] = useState('')
  const [useProxy, setUseProxy] = useState(false)
  const [picked, setPicked] = useState<PickedScriptFile[]>([])
  const [script, setScript] = useState('')
  const [fileName, setFileName] = useState('')
  const [allowUnsafeVM, setAllowUnsafeVM] = useState(false)
  const [metadata, setMetadata] = useState<{ name?: string; version?: string; platforms?: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [step, setStep] = useState<'input' | 'validated'>('input')
  const [result, setResult] = useState<SourceBatchResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  /** 导入进行中每秒 +1，用于显示「已等待 N 秒 / 超时 90s」。
   *
   *  【为什么要有这个计数】服务端虽然加了硬截止，但最坏情况仍要等 20~25 秒；
   *  界面上只有一个静止的「导入中…」，用户无法判断是「在跑」还是「卡死了」。
   *  显示秒数后，「还在动」本身就是反馈；超过预算立刻停表并给出超时提示。 */
  useEffect(() => {
    if (!busy) return
    const started = Date.now()
    setElapsed(0)
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000))
    }, 500)
    return () => window.clearInterval(timer)
  }, [busy])

  /** 给任意请求套绝对超时：服务端正常会在 90s 内返回，这里兜底防止浏览器一直挂。 */
  const withClientTimeout = async <T,>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), ms)
    try {
      return await run(controller.signal)
    } finally {
      window.clearTimeout(timer)
    }
  }

  const urlLines = urlText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const uniqueUrls = Array.from(new Set(urlLines))
  const duplicateUrlCount = urlLines.length - uniqueUrls.length

  /** 把服务端返回的错误文案读出来（统一是 { success:false, error }） */
  const readError = async (res: Response, fallback: string) => {
    try {
      const data = await res.json()
      return data?.error || data?.message || fallback
    } catch {
      return fallback
    }
  }

  /** 批量导入收尾：只更新弹窗内的结果面板。
   *
   *  【为什么不再弹 toast】
   *  toast 的 viewport 是 fixed bottom-0 z-[100]，弹窗期间会**压住结果列表底部和
   *  「完成」按钮**（375×667 / 390×844 实测都盖住了）。而结果面板就在眼前、
   *  信息比 toast 更全（逐条状态+原因），再弹一条只是重复且挡路。
   *  失败时的完整原因同样在面板里，用户还能照着改链接重试。 */
  const finishBatch = (data: SourceBatchResult) => {
    setResult(data)
    if (data.summary.imported > 0) onDone()
  }

  /** 批量链接导入：服务端逐条抓取（协议白名单 / 逐跳重定向校验 / 2MB 上限 / 20s 超时） */
  const importLinks = async () => {
    if (!uniqueUrls.length || busy) return
    if (uniqueUrls.length > MAX_IMPORT_ITEMS) {
      toast({ title: '链接太多了', description: `一次最多 ${MAX_IMPORT_ITEMS} 条，请分批导入`, variant: 'destructive' })
      return
    }
    if (duplicateUrlCount > 0) {
      toast({ title: `已自动忽略 ${duplicateUrlCount} 条重复链接`, description: '同一批次里相同的链接只导入一次' })
    }
    setBusy(true)
    setResult(null)
    try {
      const res = await withClientTimeout(
        (signal) => api.sources.importBatch(uniqueUrls, useProxy, allowUnsafeVM, signal),
        BATCH_TIMEOUT_MS,
      )
      const data = (await res.json().catch(() => null)) as SourceBatchResult | null
      if (!res.ok || !data?.success) {
        toast({ title: '批量导入失败', description: await readError(res, '链接导入失败'), variant: 'destructive' })
        return
      }
      finishBatch(data)
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === 'AbortError'
      toast({
        title: aborted ? '导入超时' : '批量导入失败',
        description: aborted
          ? `超过 ${BATCH_TIMEOUT_MS / 1000} 秒仍未完成，已中止。请检查链接是否可访问，或勾选「使用代理」后重试。`
          : e instanceof Error
            ? e.message
            : '网络错误',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  /** 「+」多选文件：只在前端拦明显的类型/体积问题，脚本能否运行交给服务端验证 */
  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!list.length) return

    const next = [...picked]
    let rejected = 0
    for (const file of list) {
      if (!/\.(js|mjs|cjs|json)$/i.test(file.name)) {
        rejected++
        continue
      }
      if (file.size > MAX_SCRIPT_BYTES) {
        rejected++
        continue
      }
      const key = `${file.name}::${file.size}::${file.lastModified}`
      if (next.some((item) => `${item.name}::${item.size}::${item.file.lastModified}` === key)) continue
      next.push({ file, name: file.name, size: file.size })
    }
    if (next.length > MAX_IMPORT_ITEMS) {
      toast({ title: '文件太多了', description: `一次最多 ${MAX_IMPORT_ITEMS} 个，已保留前 ${MAX_IMPORT_ITEMS} 个`, variant: 'destructive' })
    }
    setPicked(next.slice(0, MAX_IMPORT_ITEMS))
    if (rejected > 0) {
      toast({
        title: `已忽略 ${rejected} 个文件`,
        description: '只支持 .js / .mjs / .cjs / .json，且单文件不超过 2MB',
        variant: 'destructive',
      })
    }
  }

  const importFiles = async () => {
    if (!picked.length || busy) return
    setBusy(true)
    setResult(null)
    try {
      const files = await Promise.all(
        picked.map(async (item) => ({ filename: item.name, content: await item.file.text() })),
      )
      const res = await withClientTimeout(
        (signal) => api.sources.uploadBatch(files, allowUnsafeVM, signal),
        BATCH_TIMEOUT_MS,
      )
      const data = (await res.json().catch(() => null)) as SourceBatchResult | null
      if (!res.ok || !data?.success) {
        toast({ title: '批量导入失败', description: await readError(res, '文件导入失败'), variant: 'destructive' })
        return
      }
      finishBatch(data)
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === 'AbortError'
      toast({
        title: aborted ? '导入超时' : '读取文件失败',
        description: aborted
          ? `超过 ${BATCH_TIMEOUT_MS / 1000} 秒仍未完成，已中止。请减少文件数量后重试。`
          : e instanceof Error
            ? e.message
            : '请确认选的是文本脚本文件',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  /** 验证粘贴的脚本内容 */
  const validate = async (content: string) => {
    if (!content.trim()) return
    setBusy(true)
    try {
      const res = await api.sources.validate(content, allowUnsafeVM)
      if (res.ok) {
        const data = await res.json()
        if (data.valid === false) {
          toast({ title: '验证未通过', description: data.error || '脚本无法加载', variant: 'destructive' })
          return
        }
        setMetadata(data.metadata || data)
        setStep('validated')
        toast({ title: '验证通过', variant: 'success' })
      } else {
        toast({ title: '验证失败', description: await readError(res, '验证失败'), variant: 'destructive' })
      }
    } finally {
      setBusy(false)
    }
  }

  /** 粘贴内容导入：也走批量接口，这样和链接/文件一样按内容哈希去重 */
  const importContent = async () => {
    setBusy(true)
    setResult(null)
    try {
      const res = await api.sources.uploadBatch(
        [{ filename: fileName || 'pasted-source.js', content: script }],
        allowUnsafeVM,
      )
      const data = (await res.json().catch(() => null)) as SourceBatchResult | null
      if (!res.ok || !data?.success) {
        toast({ title: '导入失败', description: await readError(res, '导入失败'), variant: 'destructive' })
        return
      }
      finishBatch(data)
    } catch (e) {
      toast({ title: '导入失败', description: e instanceof Error ? e.message : '网络错误', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const reset = () => {
    setTab('links')
    setUrlText('')
    setPicked([])
    setScript('')
    setFileName('')
    setMetadata(null)
    setStep('input')
    setResult(null)
  }

  const batchButtonLabel = (count: number, unit: string) => {
    if (busy) return `导入中… ${elapsed}s`
    return count > 0 ? `导入 ${count} 个${unit}` : `导入${unit}`
  }

  return (
    <Dialog onOpenChange={(open) => !open && reset()}>
      <DialogTrigger asChild>
        {/* 【v2.49.3 缩小】与「全部检测/全部启用/全部关闭」保持同一档：
            h-7 + text-[11px] + rounded-md + gap-1。原来 size="sm" 在这排里最显眼，
            而它并不是本页最高频的动作。 */}
        <Button size="sm" className="h-7 gap-1 rounded-md px-2 text-[11px]">
          <Plus className="size-3.5" /> 导入源
        </Button>
      </DialogTrigger>
      {/* max-h 里减掉安全区：PWA 全屏时刘海/手势条会吃掉视口，90dvh 仍可能把
          弹窗顶出可视范围；减掉 --safe-* 再留 1rem 余量，弹窗永远完整可见。 */}
      <DialogContent className="max-h-[calc(100dvh-var(--safe-top)-var(--safe-bottom)-1rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>导入自定义音源</DialogTitle>
          <DialogDescription>
            粘贴多条音源链接（每行一个），或一次选择多个脚本文件；重复的源会自动跳过。
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'links' | 'files' | 'paste')} className="mt-2">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="links"><Link2 className="mr-1.5 size-3.5" /> 批量链接</TabsTrigger>
            <TabsTrigger value="files"><FileText className="mr-1.5 size-3.5" /> 本地文件</TabsTrigger>
            <TabsTrigger value="paste">粘贴脚本</TabsTrigger>
          </TabsList>

          <TabsContent value="links" className="space-y-3">
            {/* 【移动端字号必须是 16px】iOS Safari 聚焦 font-size < 16px 的输入框会
                自动放大整页且不缩回。桌面保留紧凑的 12px（等宽字体看链接更整齐）。
                placeholder 用 text-faint：默认的浏览器灰只有 ~2.5:1，户外看不清。 */}
            <textarea
              className="h-40 w-full rounded-lg border border-line bg-panel p-3 font-mono text-base text-ink placeholder:text-faint focus-visible:border-accent focus-visible:outline-none md:text-xs"
              placeholder={'https://example.com/source-a.js\nhttps://example.com/source-b.js\n\n（每行一个链接，空行自动忽略）'}
              aria-label="音源脚本链接，每行一个"
              spellCheck={false}
              value={urlText}
              onChange={(e) => setUrlText(e.target.value)}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <p className="text-dim">
                每行一个链接{urlLines.length > 0 && ` · 共 ${urlLines.length} 条`}
                {duplicateUrlCount > 0 && <span className="text-faint">（其中 {duplicateUrlCount} 条重复将自动忽略）</span>}
              </p>
              {/* 触摸目标：整行补到 40px 高（原 label 只有 16px，是本次审查里唯一明确
                  低于 WCAG 2.2 24px 的控件）。checkbox 保持 16px，靠 padding 扩热区。 */}
              <label
                className="flex min-h-10 shrink-0 cursor-pointer select-none items-center gap-2 py-2 text-dim"
                title="勾选后由服务端经代理拉取；默认直连（NAS 上代理拉自定义源会 ECONNRESET）"
              >
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-accent"
                  checked={useProxy}
                  onChange={(e) => setUseProxy(e.target.checked)}
                />
                使用代理
              </label>
            </div>
          </TabsContent>

          <TabsContent value="files" className="space-y-3">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".js,.mjs,.cjs,.json,text/javascript,application/javascript"
              className="hidden"
              onChange={onPickFiles}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-panel2/40 px-4 py-8 text-center transition-colors hover:border-accent/40 hover:bg-accent-soft/40"
            >
              <FileText className="size-6 text-accent" />
              <span className="text-sm font-medium text-ink">选择脚本文件（可多选）</span>
              <span className="text-xs text-faint">支持 .js / .mjs / .cjs / .json · 单文件 ≤ 2MB</span>
            </button>
            {picked.length > 0 && (
              <div className="rounded-lg border border-line bg-panel2/40 p-2">
                <p className="px-1 text-xs text-dim">已选 {picked.length} 个文件</p>
                <ul className="mt-1 max-h-40 space-y-1 overflow-auto">
                  {picked.map((item, index) => (
                    <li key={`${item.name}-${item.size}-${item.file.lastModified}`} className="flex items-center gap-2 rounded-md bg-panel px-2 py-1.5">
                      <FileText className="size-3.5 shrink-0 text-faint" />
                      <span className="min-w-0 flex-1 truncate text-xs text-ink" title={item.name}>{item.name}</span>
                      <span className="shrink-0 text-[11px] text-faint">{prettySize(item.size)}</span>
                      <button
                        type="button"
                        aria-label={`移除 ${item.name}`}
                        className="shrink-0 rounded p-0.5 text-faint hover:bg-danger/10 hover:text-danger"
                        onClick={() => setPicked((prev) => prev.filter((_, i) => i !== index))}
                      >
                        <X className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </TabsContent>

          <TabsContent value="paste" className="space-y-3">
            <textarea
              className="h-48 w-full rounded-lg border border-line bg-panel p-3 font-mono text-base text-ink placeholder:text-faint focus-visible:border-accent focus-visible:outline-none md:text-xs"
              placeholder="// 粘贴音源脚本..."
              aria-label="粘贴音源脚本内容"
              value={script}
              onChange={(e) => {
                setScript(e.target.value)
                setFileName('')
                if (step === 'validated') setStep('input')
              }}
            />
            {step === 'validated' && metadata && (
              <div className="rounded-lg border border-ok/30 bg-ok/5 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-ink">
                  <CheckCircle2 className="size-4 text-ok" />
                  {metadata.name ?? '未知名称'}
                  {metadata.version && <span className="text-dim">v{metadata.version}</span>}
                </div>
                {metadata.platforms && metadata.platforms.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {metadata.platforms.map((p) => <Badge key={p}>{p}</Badge>)}
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <label className="mt-4 flex min-h-10 items-center gap-2 py-1 text-xs text-dim">
          <Switch checked={allowUnsafeVM} onCheckedChange={setAllowUnsafeVM} />
          允许不安全 VM（仅可信源）
        </label>

        {result && (
          <div className="mt-4 rounded-xl border border-line bg-panel2/40 p-3">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="flex items-center gap-1 font-medium text-ok"><CheckCircle2 className="size-3.5" /> 成功 {result.summary.imported}</span>
              <span className="text-dim">跳过 {result.summary.skipped}</span>
              <span className={result.summary.failed > 0 ? 'flex items-center gap-1 font-medium text-danger' : 'text-dim'}>
                {result.summary.failed > 0 && <AlertTriangle className="size-3.5" />} 失败 {result.summary.failed}
              </span>
            </div>
            <ul className="mt-2 max-h-56 space-y-1 overflow-auto">
              {result.results.map((item) => (
                <li key={item.index} className="flex items-start gap-2 rounded-md bg-panel px-2 py-1.5 text-xs">
                  <span
                    className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      item.status === 'imported'
                        ? 'bg-ok/10 text-ok'
                        : item.status === 'skipped'
                          ? 'bg-panel2 text-dim'
                          : 'bg-danger/10 text-danger'
                    }`}
                  >
                    {item.status === 'imported' ? '已导入' : item.status === 'skipped' ? '跳过' : '失败'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink" title={item.input}>{item.name || item.input}</span>
                    {item.name && item.name !== item.input && (
                      <span className="block truncate text-[10px] text-faint" title={item.input}>{item.input}</span>
                    )}
                  </span>
                  {item.reason && <span className="max-w-[50%] shrink-0 text-right text-[11px] leading-5 text-faint" title={item.reason}>{item.reason}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 进行中提示：明确告诉用户「还会等多久」，而不是只有一个转圈的按钮。
            elapsed 由上面的 setInterval 每秒推进，超过服务端单条预算时改口径为
            「正在等待服务端返回」—— 让用户知道不是界面卡死。 */}
        {busy && !result && (
          <p className="mt-3 text-xs text-faint" role="status" aria-live="polite">
            {elapsed < ITEM_TIMEOUT_MS / 1000
              ? `正在抓取并解析脚本…已等待 ${elapsed} 秒（单条最多 ${ITEM_TIMEOUT_MS / 1000} 秒，整批最多 ${BATCH_TIMEOUT_MS / 1000} 秒）`
              : `仍在等待服务端返回…已等待 ${elapsed} 秒，达到 ${BATCH_TIMEOUT_MS / 1000} 秒会自动中止`}
          </p>
        )}

        <DialogFooter>
          {result ? (
            <DialogClose asChild>
              <Button>完成</Button>
            </DialogClose>
          ) : (
            <>
              <DialogClose asChild>
                <Button variant="ghost" type="button">取消</Button>
              </DialogClose>
              {tab === 'links' && (
                <Button onClick={() => void importLinks()} disabled={busy || uniqueUrls.length === 0}>
                  {batchButtonLabel(uniqueUrls.length, '链接')}
                </Button>
              )}
              {tab === 'files' && (
                <Button onClick={() => void importFiles()} disabled={busy || picked.length === 0}>
                  {batchButtonLabel(picked.length, '文件')}
                </Button>
              )}
              {tab === 'paste' && (
                step === 'validated' ? (
                  <Button onClick={() => void importContent()} disabled={busy}>
                    {busy ? '导入中…' : '确认导入'}
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => void validate(script)} disabled={busy || !script.trim()}>
                    {busy ? '处理中…' : '验证脚本'}
                  </Button>
                )
              )}
            </>
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
 *  按归属归类：谁的对象，就放在谁的页面。
 *
 *  【v2.49.3：整块大卡片 → 一行开关】
 *  原来是「标题 + 说明段落 + 开关 + 保存按钮」的一张 section 卡片，占了近半屏，
 *  而它本质上只控制一个布尔值。现在压成**一行**：左边一句说明，右边一个开关。
 *  并且**去掉保存按钮**：开关一动就地提交（见 handleToggle），
 *  少一次「改完还要记得点保存」的心智负担 —— 用户明确要求「开了就保存，关了也保存」。 */
function ScriptSafetySection() {
  const { toast } = useToast()
  const { draft, set, submit, busy, config, error } = useConfigForm(
    ['system.allowUnsafeVM'],
    { 'system.allowUnsafeVM': false },
  )

  if (error) return <div className="text-xs text-danger">{error}</div>
  if (!config) return <div className="text-xs text-dim">加载中…</div>

  /** 开关一动立刻提交。失败则提示（draft 会保持新值，用户可以再点一次）。 */
  const handleToggle = async (v: boolean) => {
    set('system.allowUnsafeVM', v)
    try {
      await submit()
      toast({ title: v ? '已开启不安全 VM 模式' : '已关闭不安全 VM 模式', variant: 'success' })
    } catch (e: unknown) {
      toast({ title: '保存失败', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    }
  }

  return (
    <div className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-line bg-panel px-3 py-2">
      <div className="min-w-0">
        <span className="block text-[13px] font-medium text-ink">允许不安全 VM 模式</span>
        <span className="block text-[11px] text-faint">
          需原生 VM 的脚本才能运行；等于允许其在本机执行任意代码，仅对可信源开启
        </span>
      </div>
      <span className="flex shrink-0 items-center gap-2">
        {busy && <span className="text-[11px] text-faint">保存中…</span>}
        <Switch checked={!!draft['system.allowUnsafeVM']} onCheckedChange={(v) => void handleToggle(v)} />
      </span>
    </div>
  )
}

/** 音源组：自定义音源 CRUD（导入/启用/禁用/排序/删除）+ 脚本运行安全。
 * 增删改会作废服务端粘滞缓存与熔断状态（服务端 toggle/delete handler 已处理）。 */
export default function SourcesGroup() {
  const { auth } = useAuth()
  const { toast } = useToast()
  const [sources, setSources] = useState<SourceRow[] | null>(null)
  /** 每源最近一次的检测结果（只存内存：这是「此刻测的」，不该当成持久事实） */
  const [probes, setProbes] = useState<Record<string, { ok: boolean; ms: number; error?: string }>>({})
  const [probingId, setProbingId] = useState<string | null>(null)
  /** 全量检测进度。null = 没在跑；{done,total} = 正在跑 */
  const [probeAll, setProbeAll] = useState<{ done: number; total: number } | null>(null)
  // 用 ref 而不是 state 表示「要不要停」：循环里读的是最新值，
  // 而 setState 的更新要下一轮渲染才可见，拿它当循环条件会停不下来。
  const stopAllRef = useRef(false)

  /** 对一个源做真实性检测。
   *
   *  【为什么要用户手动点、不自动全测】
   *  每个源都要真跑一次解析（含上游请求），十几个源全测要几十秒且会给
   *  上游平台施加无谓压力。用户关心的是「某个源现在还能不能用」，
   *  按需点一个最省钱也最快。 */
  const runProbe = async (s: SourceRow) => {
    const platform = (s.supportedSources ?? s.platforms ?? [])[0]
    if (!platform) return
    setProbingId(s.id)
    try {
      const r = await api.sources.probe(s.id, s.name, platform)
      setProbes((prev) => ({ ...prev, [s.id]: { ok: !!r.ok, ms: r.ms, error: r.error } }))
    } catch (e) {
      setProbes((prev) => ({
        ...prev,
        [s.id]: { ok: false, ms: 0, error: e instanceof Error ? e.message : '检测失败' },
      }))
    } finally {
      setProbingId(null)
    }
  }

  /** 一键全测：**串行**跑完所有源，边跑边出结果。
   *
   *  【为什么是串行而不是并发】
   *  每个检测都是一次真实解析（含对上游平台的请求）。并发 14 个会把上游
   *  打到限流，结果反而全是失败——测出来的「不可用」是假的。串行虽然慢
   *  （非可用源通常几秒内返回失败，可用源 1 秒左右），但结果可信。
   *
   *  【为什么要有停止】
   *  最坏情况 14 个源 × 20s 超时 = 几分钟。用户随时想中断必须能中断，
   *  否则只能刷页面。
   */
  const runProbeAll = async (list: SourceRow[]) => {
    const targets = list.filter((s) => (s.supportedSources ?? s.platforms ?? []).length > 0)
    if (!targets.length) return
    stopAllRef.current = false
    setProbeAll({ done: 0, total: targets.length })
    let okCount = 0
    let done = 0
    for (const s of targets) {
      if (stopAllRef.current) break
      const platform = (s.supportedSources ?? s.platforms ?? [])[0]
      setProbingId(s.id)
      try {
        const r = await api.sources.probe(s.id, s.name, platform)
        if (r.ok) okCount++
        setProbes((prev) => ({ ...prev, [s.id]: { ok: !!r.ok, ms: r.ms, error: r.error } }))
      } catch (e) {
        setProbes((prev) => ({
          ...prev,
          [s.id]: { ok: false, ms: 0, error: e instanceof Error ? e.message : '检测失败' },
        }))
      }
      done++
      setProbeAll({ done, total: targets.length })
    }
    setProbingId(null)
    setProbeAll(null)
    const stopped = done < targets.length
    toast({
      title: stopped ? `已停止（测完 ${done}/${targets.length}）` : '全部检测完成',
      description: `可用 ${okCount} 个 · 不可用 ${done - okCount} 个`,
      variant: okCount === done ? 'success' : undefined,
    })
  }
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

  /** 全部启用 / 全部关闭（v2.49.3）。
   *
   *  【为什么复用逐条 toggle 而不是新加一个后端接口】
   *  `toggle` 本身是幂等的布尔写入，服务端每个请求都会作废该源的粘滞缓存与熔断状态；
   *  这里并发发 N 个请求，语义与用户手点 N 次完全一致，不会产生新的服务端分支。
   *  代价是 N 次 HTTP —— 音源数量是个位数到十几个，完全可以接受；
   *  换来的是不必为一个纯 UI 便利动作新增 API、鉴权与测试。
   *
   *  【为什么要 toggleAllBusy】并发 N 个请求期间，按钮必须禁用，
   *  否则连点会把 enabled 写到互相矛盾的中间态。 */
  const [toggleAllBusy, setToggleAllBusy] = useState(false)
  const toggleAll = async (enabled: boolean) => {
    if (!sources || toggleAllBusy) return
    const targets = sources.filter((s) => s.enabled !== enabled)
    if (targets.length === 0) {
      toast({ title: enabled ? '全部音源已启用' : '全部音源已关闭' })
      return
    }
    setToggleAllBusy(true)
    // 乐观更新：整列一起变，避免 N 个请求回来时逐条跳变
    setSources((prev) => prev?.map((s) => ({ ...s, enabled })) ?? null)
    try {
      const results = await Promise.allSettled(targets.map((s) => api.sources.toggle(s.id, enabled)))
      const failed = results.filter((r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok)).length
      if (failed > 0) {
        toast({
          title: `${failed} 个源切换失败`,
          description: '已重新拉取列表，请稍后重试',
          variant: 'destructive',
        })
        void load()
      } else {
        toast({
          title: enabled ? `已启用 ${targets.length} 个源` : `已关闭 ${targets.length} 个源`,
          variant: 'success',
        })
      }
    } finally {
      setToggleAllBusy(false)
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

      {/* 【v2.49.3 响应式修正】原来是「标题 + 说明」与四个按钮并排（justify-between）。
          移动端 390px 下四个按钮合计约 320px，把左侧文字压到只剩 30px 宽 ——
          实测那句「自定义音源 共 0 个源；增删改会作废解析器粘滞缓存…」
          被挤成**竖排单字**，非常难看。
          改成：<sm 时标题独占一行、按钮换行到下面并靠右；≥sm 才回到左右并排。 */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-ink">自定义音源</h3>
          <p className="mt-0.5 text-xs text-dim">共 {sources.length} 个源；增删改会作废解析器粘滞缓存与熔断状态。</p>
        </div>
        {/* 【v2.49.3】这一排按钮整体降一档尺寸（h-7 / text-[11px] / 圆角 rounded-md）：
            原来 size="sm"（h-8）+ 默认圆角，四个按钮并排在窄屏上会把标题挤到换行。
            新增「全部启用 / 全部关闭」——逐个点开 5 个源的开关太费事，
            而这两个动作没有副作用（只是 enabled 布尔），用一次批量请求即可。 */}
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {/* 全部检测：串行跑，边跑边出结果；跑的时候按钮变成「停止」 */}
          <Button
            variant="outline" size="sm"
            className="h-7 gap-1 rounded-md px-2 text-[11px]"
            onClick={() => {
              if (probeAll) {
                stopAllRef.current = true
              } else {
                void runProbeAll(sources)
              }
            }}
            disabled={probingId !== null && !probeAll}
            title="逐个检测所有音源（串行，避免把上游打到限流）"
          >
            {probeAll ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                停止（{probeAll.done}/{probeAll.total}）
              </>
            ) : (
              <>
                <Activity className="size-3.5" />
                全部检测
              </>
            )}
          </Button>
          <Button
            variant="outline" size="sm"
            className="h-7 gap-1 rounded-md px-2 text-[11px]"
            disabled={toggleAllBusy || sources.length === 0}
            onClick={() => void toggleAll(true)}
            title="启用全部音源"
          >
            <Power className="size-3.5" />
            全部启用
          </Button>
          <Button
            variant="outline" size="sm"
            className="h-7 gap-1 rounded-md px-2 text-[11px]"
            disabled={toggleAllBusy || sources.length === 0}
            onClick={() => void toggleAll(false)}
            title="关闭全部音源"
          >
            <PowerOff className="size-3.5" />
            全部关闭
          </Button>
          <ImportSourceDialog onDone={load} />
        </div>
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
                  {/* 检测结果：可用=绿、失败=红、未检测时不渲染（不占位）。
                      和 SpeedBadge 的区别要说清楚：SpeedBadge 是「播放时顺带测到的耗时」，
                      这个是「你刚点检测、它真的解析成功了/失败了」，两者含义不同，故并列。 */}
                  {probes[s.id] && (
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${
                        probes[s.id].ok ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger'
                      }`}
                      title={
                        probes[s.id].ok
                          ? probes[s.id].ms < 10
                            ? '检测通过：几乎瞬时返回 —— 极可能是源内部缓存命中了，这个耗时不能代表真实取链速度'
                            : `检测通过：真实解析成功，耗时 ${probes[s.id].ms}ms`
                          : `检测失败：${probes[s.id].error || '未知原因'}`
                      }
                    >
                      {/* <10ms 就别报毫秒数了：实测「长青SVIP音源」连续两次都是 1ms，
                          那是源内部缓存直接返回，写成「可用 · 1ms」会让人以为它最快。 */}
                      {probes[s.id].ok
                        ? probes[s.id].ms < 10
                          ? '可用 · 缓存'
                          : `可用 · ${probes[s.id].ms < 1000 ? `${probes[s.id].ms}ms` : `${(probes[s.id].ms / 1000).toFixed(1)}s`}`
                        : '不可用'}
                    </span>
                  )}
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
                {/* 检测：真跑一次解析，测出「这个源现在还能不能用、要多久」。
                    手机上也保留 —— 它正是这一页最常用的动作。 */}
                <Button
                  variant="ghost" size="icon" aria-label={`检测音源 ${s.name}`}
                  title="检测：真实解析一次，测可用性与延迟"
                  onClick={() => void runProbe(s)}
                  disabled={probingId !== null || !(s.supportedSources ?? s.platforms ?? []).length}
                >
                  {probingId === s.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Activity className="size-4" />
                  )}
                </Button>
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
