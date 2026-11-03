import * as React from 'react'
import { cn } from '@/lib/utils'
import { Input, Switch } from '@/components/ui'

/** 表单字段：标签 + 描述 + 控件，统一间距 */
export function Field({
  label,
  description,
  children,
  className,
}: {
  label: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label className="text-xs font-medium text-dim">{label}</label>
      {description && <p className="text-[11px] leading-snug text-faint">{description}</p>}
      {children}
    </div>
  )
}

/** 开关字段：标签 + 描述 + Switch，行内布局 */
export function SwitchField({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  // 【为什么这里要 useId + aria-labelledby】
  // Switch 是 Radix 的 button[role=switch]，本身没有文字内容；视觉上的
  // 标签是**兄弟节点**，屏幕阅读器与自动化体检都读不到关联 —— 全站 7 处
  // 开关因此都是「无名称控件」（读屏只会念「开关，未选中」，不说是哪一个）。
  // 用 aria-labelledby 指过去，描述也一并挂上，不动视觉一个像素。
  const labelId = React.useId()
  const descId = React.useId()
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-line bg-panel2/40 p-3">
      <div className="min-w-0 flex-1">
        <div id={labelId} className="text-sm font-medium text-ink">
          {label}
        </div>
        {description && (
          <p id={descId} className="mt-0.5 text-[11px] leading-snug text-faint">
            {description}
          </p>
        )}
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        className="mt-0.5 shrink-0"
        aria-labelledby={labelId}
        aria-describedby={description ? descId : undefined}
      />
    </div>
  )
}

/** 文本/数字输入字段 */
export function InputField({
  label,
  description,
  value,
  onChange,
  placeholder,
  type = 'text',
  mono,
}: {
  label: string
  description?: string
  value: string | number
  onChange: (v: string) => void
  placeholder?: string
  type?: 'text' | 'password' | 'number'
  mono?: boolean
}) {
  return (
    <Field label={label} description={description}>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={mono ? 'font-mono' : ''}
      />
    </Field>
  )
}
