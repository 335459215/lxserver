/* eslint-disable react-hooks/set-state-in-effect -- load() 内 setLoading 是 UI 反馈，
实际数据 setState 在 fetch 之后；此规则对此模式误报（与 LogsGroup 同一处理） */
import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, KeyRound, Plus, Trash2 } from 'lucide-react'
import { adminFetch, useAuth } from '@/lib/auth'
import {
  Button,
  Collapse,
  CollapseContent,
  CollapseItem,
  CollapseTrigger,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Stack,
  Switch,
  useToast,
} from '@/components/ui'

// ===== 访问令牌（v2.25.0）=====
//
// 【这是干什么的】给**外部工具**用的长期凭据 —— MCP 服务器、脚本、第三方客户端。
// 与 Emby / Jellyfin 同一个思路：网页用「账号 + 密码」登录，外部工具用令牌。
//
// 【为什么不复用网页那个 token】网页 token 存在 localStorage 里、7 天过期、
// 退出登录即失效。它适合浏览器，不适合「配一次用一年」的外部工具。
// 这里生成的是持久化令牌（默认永不过期，可选有效期），存在
// `data/users/<user>/tokens.json`，且**每个令牌独立可禁用/删除**，
// 这样泄漏一个不会牵连其它（也能在日志里看出是哪个令牌在用）。
//
// 【与旧设计的区别】此前「管理员」是一把与账号无关的部署密码（frontend.password），
// 明文存 localStorage、无法单独吊销、也看不出是谁在用。v2.25.0 整条删除，
// 换成这里这套「按账号、可命名、可吊销、带使用日志」的令牌。

interface TokenRow {
  name: string
  token: string
  createdAt?: number
  expiresAt?: number | null
  lastUsed?: number
  disabled?: boolean
}

/** 打码：只露前 10 位与后 4 位。列表里够辨认，截图外泄也不至于直接能用 */
function maskToken(t: string): string {
  if (!t) return ''
  if (t.length <= 16) return t
  return `${t.slice(0, 10)}…${t.slice(-4)}`
}

function fmtTime(ts?: number | null): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function expiryText(t: TokenRow): string {
  if (!t.expiresAt) return '永不过期'
  const left = t.expiresAt - Date.now()
  if (left <= 0) return `已过期（${fmtTime(t.expiresAt)}）`
  const days = Math.ceil(left / 86400000)
  return `${days} 天后过期`
}

/** 复制到剪贴板：优先用 Clipboard API，失败退回 execCommand（http 站点上 API 不可用） */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    /* 明文 http 下 navigator.clipboard 为 undefined，走兜底 */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/** 新建令牌对话框。**生成后明文只显示这一次**（服务端不回读） */
function AddTokenDialog({ onDone }: { onDone: () => void }) {
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [expireDays, setExpireDays] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState('')
  const [copied, setCopied] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const days = expireDays.trim() ? Number(expireDays) : null
      const res = await adminFetch('/api/user/token/add', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim() || '未命名令牌',
          expireDays: days && days > 0 ? days : null,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; token?: string; message?: string }
      if (res.ok && data.token) {
        setCreated(data.token)
        onDone()
      } else {
        toast({ title: '生成失败', description: data.message || `HTTP ${res.status}`, variant: 'destructive' })
      }
    } finally {
      setBusy(false)
    }
  }

  const doCopy = async () => {
    const ok = await copyText(created)
    setCopied(ok)
    toast({
      title: ok ? '已复制' : '复制失败',
      description: ok ? '请粘贴到外部工具的配置里' : '请手动选中复制',
      variant: ok ? 'success' : 'destructive',
    })
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" /> 生成令牌
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>生成访问令牌</DialogTitle>
          <DialogDescription>
            给外部工具使用（MCP 服务器、脚本、第三方客户端）。令牌以你的账号身份生效。
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="mt-2 space-y-3">
            <div className="rounded-lg border border-ok/40 bg-ok/5 p-3">
              <p className="text-xs font-medium text-ok">令牌已生成 —— 请立即复制</p>
              <p className="mt-1 text-[11px] text-dim">
                出于安全考虑，服务端**不再回读**明文令牌。关闭本窗口后就看不到了，
                只能重新生成一个。
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-panel2 px-2 py-1.5 font-mono text-[11px] text-ink">
                  {created}
                </code>
                <Button type="button" size="sm" variant="ghost" onClick={doCopy}>
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                </Button>
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button">我已保存</Button>
              </DialogClose>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-2 space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-dim" htmlFor="tk-name">名称</label>
              <Input
                id="tk-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：MCP 服务器"
                autoFocus
              />
              <p className="text-[11px] text-faint">用来辨认用途；日志里会显示这个名字。</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-dim" htmlFor="tk-days">有效期（天）</label>
              <Input
                id="tk-days"
                value={expireDays}
                onChange={(e) => setExpireDays(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="留空 = 永不过期"
                inputMode="numeric"
              />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost" type="button">取消</Button>
              </DialogClose>
              <Button type="submit" disabled={busy}>
                {busy ? '生成中…' : '生成'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default function TokensGroup() {
  const { toast } = useToast()
  const { auth } = useAuth()
  const [tokens, setTokens] = useState<TokenRow[]>([])
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})

  /**
   * 拉取令牌列表。
   *
   * 【注意别在开头同步 setState】本函数被 useEffect 直接调用，
   * 若第一句就是 `setError('')`，那就是「effect 体内同步 setState」——
   * eslint 的 react-hooks/set-state-in-effect 会报 error（级联渲染）。
   * 所以错误状态只在**真正出错时**写，成功时顺手清掉。
   */
  const load = useCallback(async () => {
    try {
      const res = await adminFetch('/api/user/token/config')
      if (!res.ok) {
        setError(`加载失败（HTTP ${res.status}）`)
        return
      }
      const data = (await res.json()) as { config?: { enabled?: boolean; tokens?: TokenRow[] } }
      setEnabled(!!data.config?.enabled)
      setTokens(data.config?.tokens ?? [])
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const toggleEnabled = async (next: boolean) => {
    setEnabled(next)
    const res = await adminFetch('/api/user/token/config', {
      method: 'POST',
      body: JSON.stringify({ enabled: next }),
    })
    if (!res.ok) {
      setEnabled(!next)
      toast({ title: '保存失败', variant: 'destructive' })
      return
    }
    toast({
      title: next ? '令牌认证已启用' : '令牌认证已停用',
      description: next ? '外部工具现在可以用令牌访问' : '所有令牌暂时失效（不会被删除）',
      variant: 'success',
    })
  }

  const toggleOne = async (t: TokenRow, next: boolean) => {
    const res = await adminFetch('/api/user/token/toggle', {
      method: 'POST',
      body: JSON.stringify({ token: t.token, disabled: !next }),
    })
    if (res.ok) {
      toast({ title: next ? `已启用「${t.name}」` : `已停用「${t.name}」`, variant: 'success' })
      void load()
    } else {
      toast({ title: '操作失败', variant: 'destructive' })
    }
  }

  const remove = async (t: TokenRow) => {
    const res = await adminFetch('/api/user/token/remove', {
      method: 'POST',
      body: JSON.stringify({ token: t.token }),
    })
    if (res.ok) {
      toast({ title: `已删除「${t.name}」`, variant: 'success' })
      void load()
    } else {
      toast({ title: '删除失败', variant: 'destructive' })
    }
  }

  if (loading) return <div className="text-sm text-dim">加载中…</div>
  if (error) return <div className="text-sm text-danger">{error}</div>

  return (
    <Stack gap={5}>
      <section className="rounded-2xl border border-line bg-panel p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-ink">访问令牌</h2>
            <p className="mt-1 text-xs text-dim">
              给<strong>外部工具</strong>用的长期凭据：MCP 服务器、脚本、第三方客户端。
              网页登录请直接用账号密码，不需要令牌。
            </p>
          </div>
          <AddTokenDialog onDone={load} />
        </div>

        <div className="mt-4 border-t border-line pt-3">
          <label className="flex items-start justify-between gap-4">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-ink">启用令牌认证</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-faint">
                总开关。停用后所有令牌立即失效（令牌本身保留，重新启用即恢复）。
              </span>
            </span>
            <Switch checked={enabled} onCheckedChange={toggleEnabled} className="mt-0.5 shrink-0" />
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-panel p-4">
        <h2 className="text-sm font-semibold text-ink">
          已有令牌 <span className="text-dim">({tokens.length})</span>
        </h2>

        {tokens.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-line bg-panel2/40 p-6 text-center">
            <KeyRound className="mx-auto size-5 text-faint" />
            <p className="mt-2 text-sm text-dim">还没有令牌</p>
            <p className="mt-1 text-xs text-faint">
              如果要用 MCP 或脚本控制本服务，先生成一个。
            </p>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {tokens.map((t) => (
              <li key={t.token} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink">{t.name}</span>
                    {t.disabled && (
                      <span className="rounded bg-panel2 px-1.5 py-0.5 text-[11px] text-dim">已停用</span>
                    )}
                    {!t.expiresAt && !t.disabled && (
                      <span className="rounded bg-ok/10 px-1.5 py-0.5 text-[11px] text-ok">永久</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setRevealed((r) => ({ ...r, [t.token]: !r[t.token] }))}
                    className="mt-0.5 block max-w-full truncate py-1.5 font-mono text-[11px] text-faint hover:text-dim"
                    title="点击切换显示"
                  >
                    {revealed[t.token] ? t.token : maskToken(t.token)}
                  </button>
                  <p className="mt-0.5 text-[11px] text-faint">
                    创建 {fmtTime(t.createdAt)} · {expiryText(t)} · 最近使用 {fmtTime(t.lastUsed)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Switch checked={!t.disabled} onCheckedChange={(v) => toggleOne(t, v)} />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(t)}
                    aria-label={`删除令牌 ${t.name}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Collapse type="single" collapsible>
        <CollapseItem value="howto">
          <CollapseTrigger>怎么在外部工具里用这个令牌？</CollapseTrigger>
          <CollapseContent>
            <div className="space-y-3 text-xs text-dim">
              <p>令牌放在下面任一个位置都可以（服务端按顺序识别）：</p>
              <div className="space-y-2">
                <div>
                  <p className="font-medium text-ink">1. Authorization 头（推荐，标准做法）</p>
                  <pre className="mt-1 overflow-x-auto rounded bg-panel2 p-2 font-mono text-[11px]">
{`Authorization: Bearer <令牌>`}
                  </pre>
                </div>
                <div>
                  <p className="font-medium text-ink">2. x-user-token 头（网页端用的同一个头）</p>
                  <pre className="mt-1 overflow-x-auto rounded bg-panel2 p-2 font-mono text-[11px]">
{`x-user-token: <令牌>`}
                  </pre>
                </div>
                <div>
                  <p className="font-medium text-ink">3. ?auth= 查询参数（给没法自定义请求头的场景）</p>
                  <pre className="mt-1 overflow-x-auto rounded bg-panel2 p-2 font-mono text-[11px]">
{`/api/backup/download?auth=<令牌>`}
                  </pre>
                  <p className="mt-1 text-faint">
                    下载直链、SSE 进度流这类场景用得到（浏览器无法给 &lt;a download&gt; 加请求头）。
                  </p>
                </div>
              </div>
              <p className="text-faint">
                当前登录账号：<span className="text-ink">{auth.user.username ?? '—'}</span>
                {' '}——令牌以该账号的身份生效。
              </p>
            </div>
          </CollapseContent>
        </CollapseItem>
      </Collapse>
    </Stack>
  )
}
