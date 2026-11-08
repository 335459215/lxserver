import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-50 bg-zinc-950/25 backdrop-blur-[2px]', className)}
    {...props}
  />
))
DialogOverlay.displayName = 'DialogOverlay'

const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2',
        // 【移动端留出侧边距】w-full 让弹窗在小屏上左右贴边（实测 375/390 下 left=0/right=0），
        // 圆角弹窗贴边既不像「弹出来的层」，也把右上角关闭按钮挤到离屏幕边缘 16px 处。
        // 小屏收 1rem 边距、sm 起恢复全宽（桌面本来就有 max-w-lg 约束）。
        'max-sm:w-[calc(100%-2rem)]',
        'rounded-2xl border border-line bg-panel p-6 shadow-pop',
        className,
      )}
      {...props}
    >
      {children}
      {/* 关闭按钮：原来只有 p-1(24px)，移动端低于 Apple HIG 的 44pt、也不好点。
          现在桌面 32×32、移动 40×40（实测 40×40 是「好点」与「不抢标题」的平衡点）。
          位置从 right-4/top-4 收到 right-2/top-2：按钮盒子变大后若保持原来偏移，
          图标会显得往内缩；收一点让图标视觉位置基本不变。 */}
      <DialogPrimitive.Close className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-md text-faint transition-colors hover:text-ink focus:outline-none focus:ring-2 focus:ring-accent/30 max-md:right-1 max-md:top-1 max-md:size-10">
        <X className="size-4" />
        <span className="sr-only">关闭</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = 'DialogContent'

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-1.5 text-left', className)} {...props} />
)

const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-base font-semibold text-ink', className)}
    {...props}
  />
))
DialogTitle.displayName = 'DialogTitle'

const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-dim', className)}
    {...props}
  />
))
DialogDescription.displayName = 'DialogDescription'

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('mt-5 flex flex-row justify-end gap-2', className)} {...props} />
)

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
}
