import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-accent text-white hover:bg-accent-hover',
        secondary: 'bg-panel2 text-ink hover:bg-line',
        outline: 'border border-line bg-panel text-ink hover:bg-panel2',
        ghost: 'text-dim hover:text-ink hover:bg-panel2',
        destructive: 'bg-danger text-white hover:bg-danger/90',
        link: 'text-accent underline-offset-4 hover:underline',
      },
      size: {
        // 【移动端高度统一抬到 44px（Apple HIG / Material 的推荐触摸目标）】
        // 桌面端保持紧凑（h-9=36 / h-8=32），移动端用 `max-md:` 抬到 h-11(44)。
        // 为什么值得改：手机上「播放全部」「搜索」「退出」这类主操作
        // 用 32~36px 高时，拇指点击的失误率明显上升；
        // 而 44px 是两家平台规范一致推荐的数值，且不会让界面显得笨重
        // （只在 <768px 生效）。
        // ⚠️ 注意 `sm` 变体原本是 h-8(32px)，在移动端连 WCAG 2.2 AA 的
        //    24px 下限都只是勉强够 —— 这里一并抬到 44。
        default: 'h-9 max-md:h-11 px-4 py-2',
        sm: 'h-8 max-md:h-11 rounded-md px-3 text-xs',
        lg: 'h-10 max-md:h-11 rounded-lg px-8',
        icon: 'h-9 w-9 max-md:h-11 max-md:w-11',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

/** asChild 时把样式透传给子元素（Radix Slot），用于「按钮外观的链接」等场景 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
