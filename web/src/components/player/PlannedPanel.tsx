import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui'
import { cn } from '@/lib/utils'

interface PlannedPanelProps {
  icon: LucideIcon
  title: string
  note: string
  /** 指路按钮：避免页面成为死胡同（通常是去搜索） */
  action?: { to: string; label: string }
  className?: string
}

/** 阶段 C 分步接入的「计划中」面板：诚实标注状态，并给一个当前可用的去向 */
export function PlannedPanel({ icon: Icon, title, note, action, className }: PlannedPanelProps) {
  return (
    <div className={cn('rounded-2xl border border-dashed border-line bg-panel/60 p-10 text-center', className)}>
      <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-panel2 text-faint">
        <Icon className="size-5" />
      </span>
      <p className="mt-3 text-sm font-medium text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-dim">{note}</p>
      {action && (
        <Button asChild variant="outline" size="sm" className="mt-4">
          <Link to={action.to}>{action.label}</Link>
        </Button>
      )}
    </div>
  )
}
