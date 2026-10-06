import { useEffect, useState } from 'react'

declare const __APP_VERSION__: string

interface RuntimeConfig {
  version?: string
  serverName?: string
  'player.enableAuth'?: boolean
  'admin.path'?: string
}

/** 运行时配置：动态接口（no-cache），不再依赖旧版的正则改写 config.js 通道 */
function useRuntimeConfig(): RuntimeConfig | null {
  const [cfg, setCfg] = useState<RuntimeConfig | null>(null)
  useEffect(() => {
    let alive = true
    fetch('config.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (alive) setCfg(data)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return cfg
}

/** 阶段 A 占位壳：验证工具链（Vite/React19/Tailwind/预压缩）与挂载路径，
 *  后续阶段在此外壳内接入组件库（阶段 A 下半）与鉴权/设置中心（阶段 B） */
export default function App() {
  const cfg = useRuntimeConfig()
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <main className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
        <h1 className="text-lg font-semibold tracking-wide">lxserver 管理台</h1>
        <p className="mt-1 text-sm text-slate-400">新前端地基（阶段 A 脚手架）</p>
        <dl className="mt-5 space-y-2 text-sm">
          <div className="flex justify-between border-b border-slate-800 pb-2">
            <dt className="text-slate-400">前端构建版本</dt>
            <dd className="font-mono">{__APP_VERSION__}</dd>
          </div>
          <div className="flex justify-between border-b border-slate-800 pb-2">
            <dt className="text-slate-400">服务端版本</dt>
            <dd className="font-mono">{cfg?.version ?? '…'}</dd>
          </div>
          <div className="flex justify-between border-b border-slate-800 pb-2">
            <dt className="text-slate-400">服务器名称</dt>
            <dd>{cfg?.serverName ?? '…'}</dd>
          </div>
        </dl>
        <a
          href="/"
          className="mt-6 inline-block rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500"
        >
          返回旧版播放器
        </a>
      </main>
    </div>
  )
}
