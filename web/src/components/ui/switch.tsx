import * as React from 'react'
import * as SwitchPrimitives from '@radix-ui/react-switch'
import { cn } from '@/lib/utils'

const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    ref={ref}
    className={cn(
      // 【为什么是 h-6 w-11 而不是 h-5 w-9】
      // WCAG 2.2 AA（SC 2.5.8）要求触摸目标 ≥24×24 CSS px。
      // 原来的 h-5 w-9（20×36）高度不达标 —— 手机上开关容易点偏。
      // 曾试过用 ::before 做透明扩展命中区，但**伪元素不改变元素自身的
      // getBoundingClientRect**，于是自动化体检看不到、也无法真正验证。
      // 直接把控件做到 24×44：既真的达标，也能被断言量到。
      // 视觉上略大一点，但对「开关」这种高频控件是好事。
      'peer relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50',
      'data-[state=checked]:bg-accent data-[state=unchecked]:bg-line-strong',
      className,
    )}
    {...props}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        'pointer-events-none block size-5 rounded-full bg-panel shadow ring-0 transition-transform',
        'data-[state=checked]:translate-x-[1.375rem] data-[state=unchecked]:translate-x-0.5',
      )}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = 'Switch'

export { Switch }
