import * as React from 'react'
import * as ToastPrimitive from '@radix-ui/react-toast'
import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

const toastVariants = cva(
  'pointer-events-auto relative flex w-full items-center justify-between gap-3 rounded-lg border p-4 shadow-lg transition-all',
  {
    variants: {
      variant: {
        default: 'border-slate-800 bg-slate-900 text-slate-100',
        success: 'border-emerald-800 bg-slate-900 text-emerald-300',
        destructive: 'border-red-900 bg-slate-900 text-red-300',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

const ToastProvider = ToastPrimitive.Provider
const ToastViewport = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Viewport
    ref={ref}
    className={cn('fixed bottom-0 right-0 z-[100] flex max-h-screen w-full max-w-sm flex-col gap-2 p-4', className)}
    {...props}
  />
))
ToastViewport.displayName = 'ToastViewport'

interface ToastProps extends React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root>,
  VariantProps<typeof toastVariants> {}

const Toast = React.forwardRef<React.ComponentRef<typeof ToastPrimitive.Root>, ToastProps>(
  ({ className, variant, ...props }, ref) => (
    <ToastPrimitive.Root ref={ref} className={cn(toastVariants({ variant }), className)} {...props} />
  ),
)
Toast.displayName = 'Toast'

const ToastAction = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Action
    ref={ref}
    className={cn('inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-slate-700 px-3 text-xs font-medium hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500', className)}
    {...props}
  />
))
ToastAction.displayName = 'ToastAction'

const ToastClose = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Close
    ref={ref}
    className={cn('absolute right-1 top-1 rounded-md p-1 text-slate-500 opacity-70 hover:opacity-100 focus:outline-none', className)}
    {...props}
  >
    <X className="size-4" />
  </ToastPrimitive.Close>
))
ToastClose.displayName = 'ToastClose'

const ToastTitle = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Title ref={ref} className={cn('text-sm font-semibold', className)} {...props} />
))
ToastTitle.displayName = 'ToastTitle'

const ToastDescription = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Description ref={ref} className={cn('text-sm opacity-80', className)} {...props} />
))
ToastDescription.displayName = 'ToastDescription'

type ToastPayload = {
  title: string
  description?: string
  variant?: 'default' | 'success' | 'destructive'
}

/** 轻量全局 toast 上下文：业务侧 `const { toast } = useToast(); toast({ title: '已保存' })`。
 * 对齐计划「弹窗统一」里对提示类弹窗的收敛（替换旧版 47 个 *-modal 中的纯提示弹窗） */
const ToastContext = React.createContext<{ toast: (t: ToastPayload) => void }>({ toast: () => {} })

export function useToast() {
  return React.useContext(ToastContext)
}

let toastSeq = 0 // 仅作列表 key，非安全用途，递增即可且不受 HTTP 环境（无 crypto.randomUUID）影响

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<Array<ToastPayload & { id: number }>>([])
  const toast = React.useCallback((t: ToastPayload) => {
    const id = ++toastSeq
    setItems((prev) => [...prev, { ...t, id }])
  }, [])
  const value = React.useMemo(() => ({ toast }), [toast])
  return (
    <ToastContext.Provider value={value}>
      <ToastProvider swipeDirection="right" duration={4000}>
        {children}
        {items.map((it) => (
          <Toast
            key={it.id}
            variant={it.variant}
            open
            onOpenChange={(open) => {
              if (!open) setItems((prev) => prev.filter((x) => x.id !== it.id))
            }}
          >
            <div className="grid gap-1">
              <ToastTitle>{it.title}</ToastTitle>
              {it.description && <ToastDescription>{it.description}</ToastDescription>}
            </div>
            <ToastClose />
          </Toast>
        ))}
        <ToastViewport />
      </ToastProvider>
    </ToastContext.Provider>
  )
}

export { Toast, ToastAction, ToastClose, ToastTitle, ToastDescription }
