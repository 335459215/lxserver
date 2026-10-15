import { Check } from 'lucide-react'
import { useConfigForm } from '@/lib/useConfig'
import { Button, InputField, Stack, SwitchField, useToast } from '@/components/ui'
import { QUALITY_TIERS, qualityLabel } from '@/lib/quality'
import { usePlayer } from '@/lib/player'
import { cn } from '@/lib/utils'

const KEYS = [
  'music.url.crossPlatform', 'music.url.race', 'music.url.raceStagger',
  'music.url.crossStagger', 'music.url.maxParallelPlatforms', 'music.url.priorityGrace',
  'music.url.maxParallel', 'music.url.validate', 'music.url.stickyTtl',
  'music.url.sourceRetries', 'music.url.retryDelay',
  'music.url.breakerEnabled', 'music.url.breakerThreshold', 'music.url.breakerCooldown',
  // 从「系统」组按归属搬过来的：这三项都直接作用于播放行为
  'debug.enabled', 'list.addMusicLocationType', 'maxSnapshotNum',
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
  'list.addMusicLocationType': 'top',
  maxSnapshotNum: 10,
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-panel p-5 shadow-card">
      <h3 className="text-sm font-medium text-ink">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  )
}

/** 播放音质：客户端偏好（localStorage），不进服务端配置。
 *
 *  【为什么从「外观」搬到「播放」】
 *  原先它挂在外观组，理由是「和强调色一样属于这台设备的个人偏好」——
 *  这是按**存储位置**归类，而不是按**用户找它的地方**归类。用户想调音质时
 *  第一反应是点「播放」，不会想到去「外观」里翻（实测反馈正是
 *  「设置里播放下不能选音质，反而在外观下」）。偏好存哪儿是内部实现，
 *  不该决定它出现在哪个菜单。 */
function QualitySection() {
  const { preferredQuality, setQuality } = usePlayer()
  const { toast } = useToast()

  return (
    <section className="rounded-2xl border border-line bg-panel p-5 shadow-card">
      <h3 className="text-sm font-medium text-ink">播放音质</h3>
      <p className="mt-0.5 text-xs text-dim">
        解析时优先请求该档位；该档位不可得时自动向下兼容，不会因此播放失败。
        {preferredQuality ? ` 当前首选「${qualityLabel(preferredQuality)}」。` : ''}
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {QUALITY_TIERS.map((t) => {
          const active = t.value === preferredQuality
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => {
                setQuality(t.value)
                toast({ title: `音质已切换为「${t.label}」` })
              }}
              aria-pressed={active}
              className={cn(
                'flex items-start gap-3 rounded-xl border p-3 text-left transition-colors',
                active
                  ? 'border-accent/40 bg-accent-soft'
                  : 'border-line bg-panel hover:border-line-strong hover:bg-panel2',
              )}
            >
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                {active ? (
                  <Check className="size-4 text-accent" />
                ) : (
                  <span className="size-1.5 rounded-full bg-line-strong" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-1.5">
                  <span className="text-sm font-medium text-ink">{t.label}</span>
                  <span className="font-mono text-[10px] text-faint">{t.short}</span>
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-dim">
                  {t.desc} · {t.approx}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

/** 播放组：播放音质 + 通用播放行为 + 跨平台竞速 + 链接校验/粘滞缓存 + 死源熔断。
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
    <Stack gap={5}>
      {/* 音质是纯客户端偏好，不参与下面的配置表单提交，故放在 <form> 之外 */}
      <QualitySection />

      <form onSubmit={onSave}>
        <Stack gap={5}>
          {/* [v2.24.0] 「播放器访问」整节已移除。
              它配的是 player.enableAuth / player.password —— 一套与账号体系并行的
              「Web 播放器密码」，由旧版播放器（挂在 / 的静态页）使用。
              旧版已于 v2.23.0 删除，而新版前端本来就由登录门守着，
              再加一层播放器密码只会让用户登录两次，与「统一账密登录」相悖。
              服务端 /api/music/auth* 端点保留（外部工具可能仍在用），
              只是前端不再展示、不再调用。 */}

          <Section title="通用">
            <Stack gap={3}>
              <SwitchField
                label="调试模式"
                description="开启后输出详细调试日志与音源内部日志（NAS 日志量增大）"
                checked={draft['debug.enabled'] as boolean}
                onChange={(v) => set('debug.enabled', v)}
              />
              <InputField
                label="添加歌曲到列表的位置"
                description="top（插到最前）/ bottom（追加到末尾）"
                value={draft['list.addMusicLocationType'] as string}
                onChange={(v) => set('list.addMusicLocationType', v)}
                placeholder="top / bottom"
              />
              <InputField
                label="最大快照数"
                type="number"
                value={draft.maxSnapshotNum as number}
                onChange={(v) => set('maxSnapshotNum', Number(v))}
              />
            </Stack>
          </Section>

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
    </Stack>
  )
}
