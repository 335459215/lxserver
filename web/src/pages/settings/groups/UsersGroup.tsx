import { useEffect, useState } from 'react'
import { KeyRound, Plus, Trash2, UserPlus } from 'lucide-react'
import { adminFetch, api, useAuth } from '@/lib/auth'
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

interface UserRow {
  name: string
  enableCustomMusicDir?: boolean
  customMusicDir?: string
  allowOperateCustomMusicDir?: boolean
  allowWriteCustomMusicDir?: boolean
  enableAutoDownload?: boolean
}

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'accent' | 'ok' }) {
  const cls = {
    neutral: 'bg-panel2 text-dim',
    accent: 'bg-accent-soft text-accent',
    ok: 'bg-ok/10 text-ok',
  }[tone]
  return <span className={`rounded px-1.5 py-0.5 text-[11px] ${cls}`}>{children}</span>
}

function AddUserDialog({ onDone }: { onDone: () => void }) {
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await adminFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify({ name, password }),
      })
      if (res.ok) {
        toast({ title: '用户已创建', description: name, variant: 'success' })
        setName('')
        setPassword('')
        onDone()
      } else {
        const text = await res.text()
        toast({ title: '创建失败', description: text, variant: 'destructive' })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" /> 添加用户
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加用户</DialogTitle>
          <DialogDescription>新建一个同步账号；密码写入后不再回读。</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="mt-2 space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-dim" htmlFor="new-name">用户名</label>
            <Input id="new-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="yueyue" autoFocus />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-dim" htmlFor="new-pw">密码</label>
            <Input
              id="new-pw"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button">取消</Button>
            </DialogClose>
            <Button type="submit" disabled={busy || !name || !password}>
              {busy ? '创建中…' : '创建'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EditUserDialog({ user, onDone }: { user: UserRow; onDone: () => void }) {
  const { toast } = useToast()
  const [name, setName] = useState(user.name)
  const [password, setPassword] = useState('')
  const [enableCustomMusicDir, setEnableCustomMusicDir] = useState(!!user.enableCustomMusicDir)
  const [customMusicDir, setCustomMusicDir] = useState(user.customMusicDir ?? '')
  const [allowOperate, setAllowOperate] = useState(!!user.allowOperateCustomMusicDir)
  const [allowWrite, setAllowWrite] = useState(!!user.allowWriteCustomMusicDir)
  const [autoDownload, setAutoDownload] = useState(!!user.enableAutoDownload)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await adminFetch('/api/users', {
        method: 'PUT',
        body: JSON.stringify({
          name: user.name,
          newName: name !== user.name ? name : undefined,
          ...(password ? { password } : {}),
          enableCustomMusicDir,
          customMusicDir,
          allowOperateCustomMusicDir: allowOperate,
          allowWriteCustomMusicDir: allowWrite,
          enableAutoDownload: autoDownload,
        }),
      })
      if (res.ok) {
        toast({ title: '已保存', variant: 'success' })
        onDone()
      } else {
        const text = await res.text()
        toast({ title: '保存失败', description: text, variant: 'destructive' })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="编辑">
          <KeyRound className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑用户</DialogTitle>
          <DialogDescription>密码留空则不修改；改名会同步迁移用户目录。</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="mt-2 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-dim" htmlFor="edit-name">用户名</label>
            <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-dim" htmlFor="edit-pw">新密码</label>
            <Input
              id="edit-pw"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="留空则不修改"
            />
          </div>
          <Collapse type="single" collapsible defaultValue={enableCustomMusicDir ? 'adv' : undefined}>
            <CollapseItem value="adv">
              <CollapseTrigger className="text-xs">高级 · 自定义音乐目录</CollapseTrigger>
              <CollapseContent>
                <Stack gap={3} className="pt-2">
                  <label className="flex items-center justify-between gap-3 text-sm text-ink">
                    <span>启用自定义音乐目录</span>
                    <Switch checked={enableCustomMusicDir} onCheckedChange={setEnableCustomMusicDir} />
                  </label>
                  {enableCustomMusicDir && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-dim" htmlFor="music-dir">目录路径</label>
                      <Input id="music-dir" value={customMusicDir} onChange={(e) => setCustomMusicDir(e.target.value)} placeholder="/volume2/MEDIA/music/yueyue" />
                    </div>
                  )}
                  <label className="flex items-center justify-between gap-3 text-sm text-ink">
                    <span>允许操作自定义目录</span>
                    <Switch checked={allowOperate} onCheckedChange={setAllowOperate} />
                  </label>
                  <label className="flex items-center justify-between gap-3 text-sm text-ink">
                    <span>允许写入目录</span>
                    <Switch checked={allowWrite} onCheckedChange={setAllowWrite} />
                  </label>
                  <label className="flex items-center justify-between gap-3 text-sm text-ink">
                    <span>启用自动下载</span>
                    <Switch checked={autoDownload} onCheckedChange={setAutoDownload} />
                  </label>
                </Stack>
              </CollapseContent>
            </CollapseItem>
          </Collapse>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button">取消</Button>
            </DialogClose>
            <Button type="submit" disabled={busy || !name}>
              {busy ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteUserDialog({ user, onDone }: { user: UserRow; onDone: () => void }) {
  const { toast } = useToast()
  const [deleteData, setDeleteData] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      const res = await adminFetch('/api/users', {
        method: 'DELETE',
        body: JSON.stringify({ name: user.name, deleteData }),
      })
      if (res.ok) {
        toast({ title: '已删除用户', description: user.name, variant: 'success' })
        onDone()
      } else {
        const text = await res.text()
        toast({ title: '删除失败', description: text, variant: 'destructive' })
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
          <DialogTitle>删除用户「{user.name}」？</DialogTitle>
          <DialogDescription>此操作不可撤销。勾选下方可一并删除该用户的同步数据目录。</DialogDescription>
        </DialogHeader>
        <label className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-line bg-panel2/60 p-3 text-sm text-ink">
          <span>同时删除数据目录</span>
          <Switch checked={deleteData} onCheckedChange={setDeleteData} />
        </label>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" type="button">取消</Button>
          </DialogClose>
          <Button variant="destructive" onClick={submit} disabled={busy}>
            {busy ? '删除中…' : '确认删除'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 用户组（阶段 B）：完整 CRUD。GET 不再含明文密码（同批修复），
 * 编辑流程改为"密码留空则不修改"。 */
export default function UsersGroup() {
  const { auth } = useAuth()
  const [users, setUsers] = useState<UserRow[] | null>(null)
  const [error, setError] = useState('')

  const load = () =>
    api
      .users()
      .then(setUsers)
      .catch((e) => setError(String(e.message || e)))

  useEffect(() => {
    void load()
  }, [])

  if (!auth.admin.ok) return <div className="text-sm text-dim">需要管理员权限。</div>
  if (error) return <div className="text-sm text-danger">{error}</div>
  if (!users) return <div className="text-sm text-dim">加载中…</div>

  return (
    <Stack gap={3}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-ink">同步账号</h3>
          <p className="mt-0.5 text-xs text-dim">共 {users.length} 个账号；密码只在创建/修改时写入，不回读。</p>
        </div>
        <AddUserDialog onDone={load} />
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-panel shadow-card">
        <div className="divide-y divide-line">
          {users.map((u) => {
            const isPublic = u.name === '_open'
            return (
              <div key={u.name} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-sm text-ink">{u.name}</span>
                    {isPublic && <Badge tone="accent">公开</Badge>}
                    {u.enableCustomMusicDir && <Badge tone="neutral">自定义目录</Badge>}
                    {u.allowWriteCustomMusicDir && <Badge tone="ok">可写</Badge>}
                    {u.enableAutoDownload && <Badge tone="neutral">自动下载</Badge>}
                  </div>
                  {u.enableCustomMusicDir && u.customMusicDir && (
                    <div className="mt-0.5 truncate font-mono text-xs text-faint" title={u.customMusicDir}>
                      {u.customMusicDir}
                    </div>
                  )}
                </div>
                {!isPublic && (
                  <div className="flex items-center gap-1">
                    <EditUserDialog user={u} onDone={load} />
                    <DeleteUserDialog user={u} onDone={load} />
                  </div>
                )}
              </div>
            )
          })}
          {users.length === 0 && <div className="px-4 py-8 text-center text-sm text-faint">暂无用户，点右上角添加</div>}
        </div>
      </div>

      <p className="text-xs text-faint">
        <UserPlus className="mr-1 inline size-3" />
        公开账号「_open」由「设置 → 公开收藏」开关控制，不可在此增删。
      </p>
    </Stack>
  )
}
