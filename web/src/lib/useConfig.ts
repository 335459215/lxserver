import { useCallback, useEffect, useState } from 'react'
import { adminFetch, api } from './auth'

/** 配置读写 hook：加载 /api/config，保存只发变更的 key（POST 仅处理支持的 key）。
 * 保存后重载——服务端会规范化某些值（如 user.enableRoot 互斥校验）。 */
export function useConfig() {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')

  const reload = useCallback(() => {
    return api
      .config()
      .then(setConfig)
      .catch((e) => setError(String(e.message || e)))
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const save = useCallback(
    async (patch: Record<string, unknown>) => {
      const res = await adminFetch('/api/config', {
        method: 'POST',
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`保存失败 (${res.status})${text ? ': ' + text : ''}`)
      }
      await reload()
    },
    [reload],
  )

  return { config, error, reload, save }
}

/** POST /api/config 实际接受的 key 白名单（其余 GET 能读到但写不进）。
 * 用于区分可编辑 vs 只读字段。来源：server.ts POST /api/config handler。 */
export const EDITABLE_CONFIG_KEYS = new Set([
  'serverName',
  'frontend.password',
  'debug.enabled',
  'list.addMusicLocationType',
  'proxy.enabled',
  'proxy.header',
  'user.enablePath',
  'user.enableRoot',
  'user.enablePublicRestriction',
  'user.enablePublicNonAdminLocalMusic',
  'user.enablePublicNonAdminBrowserDownload',
  'user.enablePublicNonAdminServerCache',
  'user.enablePublicFavorites',
  'user.enablePublicNonAdminAccess',
  'user.enableCustomMusicDir',
  'user.enableLoginCacheRestriction',
  'user.enableCacheSizeLimit',
  'user.cacheSizeLimit',
  'maxSnapshotNum',
  'system.allowUnsafeVM',
])
