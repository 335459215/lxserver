import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Tailwind class 合并：条件 class + 冲突去重（组件库全件通用） */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
