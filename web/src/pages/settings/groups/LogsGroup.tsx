/* eslint-disable react-hooks/set-state-in-effect -- load() 内 setLoading 是 UI 反馈，
   实际数据 setState 在 fetch 之后；此规则对此模式误报 */
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Power, RefreshCw } from 'lucide-react'
import { adminFetch, api } from '@/lib/auth'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  useToast,
} from '@/components/ui'

const LOG_TYPES = [
  { value: 'app', label: '应用日志' },
  { value: 'access', label: '访问日志' },
  { value: 'login', label: '登录日志' },
  { value: 'token', label: '令牌日志' },
  { value: 'errors', label: '错误日志' },
]

const LINE_OPTIONS = [50, 100, 200, 500]

/** 重启服务端（D-009）。
 *
 *  【为什么这个按钮必须存在】
 *  有几个配置项**只在启动时读取一次**，改完不重启不生效：
 *    - `port`：`index.ts` 启动时读一次用于 listen
 *    - `serverCacheLocation`：在 `startServer()` 内消费
 *  而这两个键**不在 `/api/config` POST 的白名单里**（界面上根本改不了），
 *  用户只能手改服务器上的 `config.js`。改完之后此前没有任何入口让它生效，
 *  也没有任何提示说"你需要重启" —— 用户会以为改了没用。
 *
 *  后端 `/api/restart` 一直存在，但新前端从未调用过，等于这个能力被丢掉了。
 *
 *  【为什么不能省掉「等待恢复」】
 *  重启会让所有在途请求断开，页面上的数据全部过期。若只是弹一句"已重启"
 *  就完事，用户点刷新会看到连接错误，以为把服务弄坏了。这里轮询到服务
 *  真的回来再让人操作，并且顺手刷新日志。 */
function RestartSection() {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)

  const doRestart = async () => {
    setBusy(true)
    toast({ title: '正在重启服务…', description: '服务会在几秒内恢复，请稍候' })
    await api.restart()
    const back = await api.waitForServerBack()
    setBusy(false)
    setOpen(false)
    if (back) {
      toast({ title: '服务已重启', variant: 'success' })
      // 整页重载：重启后会话/缓存都可能变了，让所有 hooks 重新取数据最稳
      setTimeout(() => window.location.reload(), 600)
    } else {
      toast({
        title: '服务未在预期时间内恢复',
        description: '请检查容器状态（docker compose ps），必要时手动重启',
        variant: 'destructive',
      })
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-panel p-5 shadow-card">
      <h3 className="flex items-center gap-2 text-sm font-medium text-ink">
        <Power className="size-4 text-danger" />
        重启服务
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-dim">
        以下配置项<b>只在服务启动时读取一次</b>，改动后必须重启才生效：
      </p>
      <ul className="mt-2 space-y-1 text-xs text-dim">
        <li>
          · <code className="font-mono">port</code>（监听端口）
        </li>
        <li>
          · <code className="font-mono">serverCacheLocation</code>（服务器缓存位置）
        </li>
      </ul>
      <p className="mt-2 flex items-start gap-1.5 text-xs text-faint">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        <span>
          这两项在界面上无法修改，需编辑服务器上的 <code className="font-mono">config.js</code>；
          改完回到这里点重启即可。其余设置项都是<b>即时生效</b>，不需要重启。
        </span>
      </p>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="mt-4 text-danger" disabled={busy}>
            <Power className="size-4" />
            {busy ? '重启中…' : '重启服务'}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认重启服务？</DialogTitle>
            <DialogDescription>
              重启期间服务会短暂不可用（通常几秒）。正在进行中的播放、下载与同步任务会被中断。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">取消</Button>
            </DialogClose>
            <Button variant="destructive" onClick={() => void doRestart()}>
              确认重启
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

/** 日志组：终端式只读查看器。/api/logs?type=X&lines=N 返回 { logs: string[] } */
export default function LogsGroup() {
  const { toast } = useToast()
  const [type, setType] = useState('app')
  const [lines, setLines] = useState(100)
  const [logs, setLogs] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await adminFetch(`/api/logs?type=${type}&lines=${lines}`)
      if (res.ok) {
        const data = (await res.json()) as { logs: string[] }
        setLogs(data.logs ?? [])
      } else {
        setLogs([])
      }
    } catch {
      setLogs([])
    } finally {
      setLoading(false)
    }
  }, [type, lines])

  // 首次加载 + 类型/行数变化时重载
  useEffect(() => {
    void load()
  }, [load])

  // 自动刷新（5 秒）
  useEffect(() => {
    if (!autoRefresh) return
    const timer = setInterval(() => void load(), 5000)
    return () => clearInterval(timer)
  }, [autoRefresh, load])

  const download = () => {
    const blob = new Blob([logs.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${type}.log`
    a.click()
    URL.revokeObjectURL(url)
    toast({ title: '已下载', description: `${type}.log` })
  }

  return (
    <Stack gap={4}>
      <div className="flex flex-wrap items-center gap-3">
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LOG_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={String(lines)} onValueChange={(v) => setLines(Number(v))}>
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LINE_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} 行
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </Button>

        <label className="ml-auto flex items-center gap-2 text-xs text-dim">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            className="size-3.5 accent-[var(--accent)]"
          />
          自动刷新（5s）
        </label>

        <Button variant="ghost" size="sm" onClick={download} disabled={logs.length === 0}>
          下载
        </Button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-[#1a1814] shadow-card">
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-2">
          <span className="font-mono text-xs text-zinc-500">{type}.log · 最近 {logs.length} 行</span>
          <span className="flex items-center gap-1.5 text-xs text-zinc-600">
            <span className={`size-1.5 rounded-full ${autoRefresh ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
            {autoRefresh ? 'LIVE' : 'IDLE'}
          </span>
        </div>
        <pre className="max-h-[60vh] overflow-auto p-4 font-mono text-xs leading-relaxed text-zinc-300">
          {logs.length === 0 ? <span className="text-zinc-600">（空）</span> : logs.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all hover:bg-white/5">
              {line || '\u00a0'}
            </div>
          ))}
        </pre>
      </div>

      <p className="text-xs text-faint">
        日志文件存储在 <code className="font-mono">data/logs/</code> 目录，随容器卷持久化。
      </p>

      <RestartSection />
    </Stack>
  )
}
