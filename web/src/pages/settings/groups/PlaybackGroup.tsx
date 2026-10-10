import { useConfigForm } from '@/lib/useConfig'
import { Button, InputField, Stack, SwitchField, useToast } from '@/components/ui'

const KEYS = [
  'music.url.crossPlatform', 'music.url.race', 'music.url.raceStagger',
  'music.url.crossStagger', 'music.url.maxParallelPlatforms', 'music.url.priorityGrace',
  'music.url.maxParallel', 'music.url.validate', 'music.url.stickyTtl',
  'music.url.sourceRetries', 'music.url.retryDelay',
  'music.url.breakerEnabled', 'music.url.breakerThreshold', 'music.url.breakerCooldown',
] as const

const DEFAULTS: Record<string, unknown> = {
  'music.url.raceStagger': 180,
  'music.url.crossStagger': 150,
  'music.url.maxParallelPlatforms': 3,
  'music.url.priorityGrace': 350,
  'music.url.maxParallel': 4,
  'music.url.sourceRetries': 1,
  'music.url.retryDelay': 900,
  'music.url.stickyTtl': 600,
  'music.url.breakerThreshold': 3,
  'music.url.breakerCooldown': 300,
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-panel p-5 shadow-card">
      <h3 className="text-sm font-medium text-ink">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  )
}

/** 播放组：播放器访问 + 跨平台竞速 + 链接校验/粘滞缓存 + 死源熔断。
 * 这些 music.url.* 即解析器的调参旋钮（race-e2e 9 项是回归门槛） */
export default function PlaybackGroup() {
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
        {/* [v2.24.0] 「播放器访问」整节已移除。
            它配的是 player.enableAuth / player.password —— 一套与账号体系并行的
            「Web 播放器密码」，由旧版播放器（挂在 / 的静态页）使用。
            旧版已于 v2.23.0 删除，而新版前端本来就由登录门守着，
            再加一层播放器密码只会让用户登录两次，与「统一账密登录」相悖。
            服务端 /api/music/auth* 端点保留（Subsonic/外部工具可能仍在用），
            只是前端不再展示、不再调用。 */}

        <Section title="跨平台竞速">
          <Stack gap={3}>
            <SwitchField
              label="不分平台竞速"
              description="原平台外也并发搜索替代歌曲（解析器核心能力）"
              checked={draft['music.url.race'] as boolean}
              onChange={(v) => set('music.url.race', v)}
            />
            <SwitchField
              label="跨平台搜索"
              description="允许在其它平台搜索替身歌曲"
              checked={draft['music.url.crossPlatform'] as boolean}
              onChange={(v) => set('music.url.crossPlatform', v)}
            />
            <div className="grid grid-cols-2 gap-3">
              <InputField label="同平台错峰(ms)" type="number" value={draft['music.url.raceStagger'] as number} onChange={(v) => set('music.url.raceStagger', Number(v))} />
              <InputField label="跨平台错峰(ms)" type="number" value={draft['music.url.crossStagger'] as number} onChange={(v) => set('music.url.crossStagger', Number(v))} />
              <InputField label="最大并发平台" type="number" value={draft['music.url.maxParallelPlatforms'] as number} onChange={(v) => set('music.url.maxParallelPlatforms', Number(v))} />
              <InputField label="优先级宽限(ms)" type="number" value={draft['music.url.priorityGrace'] as number} onChange={(v) => set('music.url.priorityGrace', Number(v))} />
              <InputField label="同平台最大并发" type="number" value={draft['music.url.maxParallel'] as number} onChange={(v) => set('music.url.maxParallel', Number(v))} />
            </div>
          </Stack>
        </Section>

        <Section title="链接校验与粘滞缓存">
          <Stack gap={3}>
            <SwitchField
              label="链接校验"
              description="对返回链接做可用性探测（403/404 视为该源失败继续竞速）"
              checked={draft['music.url.validate'] as boolean}
              onChange={(v) => set('music.url.validate', v)}
            />
            <div className="grid grid-cols-2 gap-3">
              <InputField label="粘滞缓存 TTL(s)" type="number" value={draft['music.url.stickyTtl'] as number} onChange={(v) => set('music.url.stickyTtl', Number(v))} />
              <InputField label="源重试次数" type="number" value={draft['music.url.sourceRetries'] as number} onChange={(v) => set('music.url.sourceRetries', Number(v))} />
              <InputField label="重试延迟(ms)" type="number" value={draft['music.url.retryDelay'] as number} onChange={(v) => set('music.url.retryDelay', Number(v))} />
            </div>
          </Stack>
        </Section>

        <Section title="死源熔断">
          <Stack gap={3}>
            <SwitchField
              label="启用源级熔断"
              description="连续失败的源会被冷却，避免每次都白等"
              checked={draft['music.url.breakerEnabled'] as boolean}
              onChange={(v) => set('music.url.breakerEnabled', v)}
            />
            <div className="grid grid-cols-2 gap-3">
              <InputField label="熔断阈值(次)" type="number" value={draft['music.url.breakerThreshold'] as number} onChange={(v) => set('music.url.breakerThreshold', Number(v))} />
              <InputField label="冷却时间(s)" type="number" value={draft['music.url.breakerCooldown'] as number} onChange={(v) => set('music.url.breakerCooldown', Number(v))} />
            </div>
          </Stack>
        </Section>

        <div className="flex justify-end">
          <Button type="submit" disabled={busy}>{busy ? '保存中…' : '保存配置'}</Button>
        </div>
      </Stack>
    </form>
  )
}
