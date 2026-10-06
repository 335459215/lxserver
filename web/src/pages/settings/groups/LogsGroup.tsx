/* eslint-disable react-hooks/set-state-in-effect -- load() 内 setLoading 是 UI 反馈，
   实际数据 setState 在 fetch 之后；此规则对此模式误报 */
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { adminFetch } from '@/lib/auth'
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Stack, useToast } from '@/components/ui'

const LOG_TYPES = [
  { value: 'app', label: '应用日志' },
  { value: 'access', label: '访问日志' },
  { value: 'login', label: '登录日志' },
  { value: 'token', label: '令牌日志' },
  { value: 'subsonic', label: 'Subsonic' },
  { value: 'errors', label: '错误日志' },
]

const LINE_OPTIONS = [50, 100, 200, 500]

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
    </Stack>
  )
}
