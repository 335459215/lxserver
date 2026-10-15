import { useConfigForm } from '@/lib/useConfig'
import { Button, InputField, Stack, SwitchField, useToast } from '@/components/ui'

const KEYS = [
  'proxy.all.enabled', 'proxy.all.address',
  'proxy.music.enabled', 'proxy.customSource.enabled', 'proxy.app.enabled',
  // 从「系统 → 代理与安全」按归属搬过来：这两项都是**入站反向代理**相关，
  // 与上面那组「出站代理」是两件不同的事，此前却被拆在两个菜单里，
  // 而且系统组把 proxy.enabled 描述成「Music SDK 外发请求代理总开关」
  // （那是 proxy.all.enabled 的职责），标签是错的。
  'proxy.enabled', 'proxy.header',
] as const

const DEFAULTS: Record<string, unknown> = {
  'proxy.header': 'x-real-ip',
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-panel p-5 shadow-card">
      <h3 className="text-sm font-medium text-ink">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  )
}

/** 网络组：出站代理配置（含细分分类） + 入站反向代理。
 * 注意 music/customSource 在 NAS 上强制直连（needle + tunnel 经代理 ECONNRESET） */
export default function NetworkGroup() {
  const { toast } = useToast()
  const { draft, set, submit, busy, config, error } = useConfigForm([...KEYS], DEFAULTS)

  if (error) return <div className="text-sm text-danger">{error}</div>
  if (!config) return <div className="text-sm text-dim">加载中…</div>

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const n = await submit()
      toast(n === 0 ? { title: '无变更' } : { title: '已保存', description: `${n} 项`, variant: 'success' })
    } catch (e: unknown) {
      toast({ title: '保存失败', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    }
  }

  return (
    <form onSubmit={onSave}>
      <Stack gap={5}>
        <Section title="代理">
          <Stack gap={3}>
            <SwitchField
              label="统一代理开关"
              description="Music SDK 外发请求的代理总开关。设为 false 的分类强制直连。"
              checked={draft['proxy.all.enabled'] as boolean}
              onChange={(v) => set('proxy.all.enabled', v)}
            />
            <InputField
              label="代理地址"
              description="支持 http:// 或 socks5://，留空清除"
              value={draft['proxy.all.address'] as string}
              onChange={(v) => set('proxy.all.address', v)}
              placeholder="http://192.168.1.4:7890"
              mono
            />
            <div className="rounded-lg border border-line bg-panel2/40 p-3">
              <p className="mb-2 text-xs font-medium text-dim">分类覆盖（关闭 = 该类强制直连，开启 = 走统一代理）</p>
              <Stack gap={2}>
                <SwitchField
                  label="music（音乐平台 SDK）"
                  description="国内平台直连更快且 needle 经代理会 ECONNRESET"
                  checked={!!draft['proxy.music.enabled']}
                  onChange={(v) => set('proxy.music.enabled', v)}
                />
                <SwitchField
                  label="customSource（自定义源）"
                  description="自定义源请求直连"
                  checked={!!draft['proxy.customSource.enabled']}
                  onChange={(v) => set('proxy.customSource.enabled', v)}
                />
                <SwitchField
                  label="app（封面/AcoustID/远程导入）"
                  description="需要访问外网的请求走代理"
                  checked={!!draft['proxy.app.enabled']}
                  onChange={(v) => set('proxy.app.enabled', v)}
                />
              </Stack>
            </div>
          </Stack>
        </Section>

        <Section title="反向代理（入站）">
          <Stack gap={3}>
            <SwitchField
              label="信任反代请求头"
              description="部署在 Nginx / 群晖反代后面时开启，用于记录真实客户端 IP。配置了「IP 头」后服务端会自动把它置为 true。"
              checked={draft['proxy.enabled'] as boolean}
              onChange={(v) => set('proxy.enabled', v)}
            />
            <InputField
              label="真实 IP 头名"
              description="反代写入客户端真实 IP 的请求头，如 x-real-ip / x-forwarded-for"
              value={draft['proxy.header'] as string}
              onChange={(v) => set('proxy.header', v)}
              placeholder="x-real-ip"
              mono
            />
          </Stack>
        </Section>

        <div className="flex justify-end">
          <Button type="submit" disabled={busy}>{busy ? '保存中…' : '保存配置'}</Button>
        </div>
      </Stack>
    </form>
  )
}
