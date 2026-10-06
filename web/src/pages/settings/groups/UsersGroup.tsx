import { useEffect, useState } from 'react'
import { api } from '@/lib/auth'
import { Stack } from '@/components/ui'

interface UserRow {
  name: string
  enableCustomMusicDir?: boolean
  allowOperateCustomMusicDir?: boolean
}

/** 用户组（只读列表）：
 * 注意 /api/users 现仍返回明文密码（计划明确：修它必须与新用户管理同批，
 * 否则打断旧后台 UI）——新 UI 有意不展示密码字段，仅读取名称与权限开关。
 * 增删改在后续切片接入时一并切到不含密码的新契约。 */
export default function UsersGroup() {
  const [users, setUsers] = useState<UserRow[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    api
      .users()
      .then((d) => alive && setUsers(d))
      .catch((e) => alive && setError(String(e.message || e)))
    return () => {
      alive = false
    }
  }, [])

  if (error) return <div className="text-sm text-danger">{error}</div>
  if (!users) return <div className="text-sm text-dim">加载中…</div>

  return (
    <Stack gap={3}>
      <div className="rounded-2xl border border-line bg-panel p-5">
        <h3 className="text-sm font-medium text-ink">
          用户（{users.length}）
        </h3>
        <p className="mt-1 text-xs text-faint">
          增删改与权限编辑将在用户管理面板迁移时接入；当前为只读视图。
        </p>
        <div className="mt-3 divide-y divide-line">
          {users.map((u) => (
            <div key={u.name} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="font-mono text-ink">{u.name}</span>
              <span className="flex gap-2 text-[11px]">
                {u.enableCustomMusicDir ? (
                  <span className="rounded bg-ok/10 px-1.5 py-0.5 text-ok">自定义目录</span>
                ) : null}
                {u.allowOperateCustomMusicDir ? (
                  <span className="rounded bg-accent-soft px-1.5 py-0.5 text-accent">可写目录</span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Stack>
  )
}
