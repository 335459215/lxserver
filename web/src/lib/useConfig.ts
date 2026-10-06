import { useCallback, useEffect, useMemo, useState } from 'react'
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

/** 可编辑配置表单 hook：draft = 配置基线 + overrides（无 effect 内 setState）。
 * 用法：const { draft, set, submit, busy, config, error } = useConfigForm(keys, defaults) */
export function useConfigForm(
  keys: string[],
  defaults: Record<string, unknown> = {},
) {
  const { config, error, save } = useConfig()
  const [overrides, setOverrides] = useState<Record<string, unknown>>({})
  const [busy, setBusy] = useState(false)

  const draft = useMemo(() => {
    const base: Record<string, unknown> = {}
    for (const k of keys) {
      base[k] = config?.[k] ?? defaults[k] ?? false
    }
    return { ...base, ...overrides }
  }, [config, overrides, keys, defaults])

  const set = useCallback((key: string, value: unknown) => {
    setOverrides((o) => ({ ...o, [key]: value }))
  }, [])

  const submit = useCallback(async (): Promise<number> => {
    // 只发有变更的 key；密码类空串不发
    const patch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(overrides)) {
      if (k.endsWith('.password') && !v) continue
      if (config && config[k] !== v) patch[k] = v
    }
    if (Object.keys(patch).length === 0) return 0
    setBusy(true)
    try {
      await save(patch)
      setOverrides({})
      return Object.keys(patch).length
    } finally {
      setBusy(false)
    }
  }, [overrides, config, save])

  return { draft, set, submit, busy, config, error }
}
