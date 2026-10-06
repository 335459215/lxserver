import * as React from 'react'
import * as AccordionPrimitive from '@radix-ui/react-accordion'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

// Collapse 用 Radix Accordion（type="single" collapsible）实现，语义即「可折叠分区」，
// 对应计划里设置中心「组内可折叠分区」的需求
const Collapse = AccordionPrimitive.Root

const CollapseItem = React.forwardRef<
  React.ComponentRef<typeof AccordionPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>
>(({ className, ...props }, ref) => (
  <AccordionPrimitive.Item
    ref={ref}
    className={cn('border-b border-slate-800', className)}
    {...props}
  />
))
CollapseItem.displayName = 'CollapseItem'

const CollapseTrigger = React.forwardRef<
  React.ComponentRef<typeof AccordionPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Header className="flex">
    <AccordionPrimitive.Trigger
      ref={ref}
      className={cn(
        'flex flex-1 items-center justify-between py-3 text-sm font-medium text-slate-200 transition-all',
        'hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500',
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDown className="size-4 shrink-0 text-slate-500 transition-transform duration-200 [[data-state=open]>&]:rotate-180" />
    </AccordionPrimitive.Trigger>
  </AccordionPrimitive.Header>
))
CollapseTrigger.displayName = 'CollapseTrigger'

const CollapseContent = React.forwardRef<
  React.ComponentRef<typeof AccordionPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Content
    ref={ref}
    className="overflow-hidden text-sm data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down"
    {...props}
  >
    <div className={cn('pb-3 pt-0 text-slate-400', className)}>{children}</div>
  </AccordionPrimitive.Content>
))
CollapseContent.displayName = 'CollapseContent'

export { Collapse, CollapseItem, CollapseTrigger, CollapseContent }
