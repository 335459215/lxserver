import * as React from 'react'
import { cn } from '@/lib/utils'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    className={cn(
      'flex h-9 w-full rounded-lg border border-line bg-panel px-3 py-1 text-sm text-ink shadow-[0_1px_2px_rgba(0,0,0,0.02)]',
      'placeholder:text-faint focus-visible:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/15',
      'transition-colors disabled:cursor-not-allowed disabled:opacity-50',
      // 【移动端 16px 下限：防 iOS Safari 自动放大】
      // iOS Safari 在聚焦 font-size < 16px 的输入框时会**自动放大整个页面**，
      // 而且不会自己缩回来 —— 用户必须手动双指缩小才能继续操作。
      // 这是移动端最烦人的经典问题之一，且在桌面浏览器里完全看不出来（桌面不缩放）。
      // 只在 <768px 生效，桌面端保持紧凑的 14px。
      'max-md:text-base',
      className,
    )}
    ref={ref}
    {...props}
  />
))
Input.displayName = 'Input'

export { Input }
