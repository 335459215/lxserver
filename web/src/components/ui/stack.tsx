import * as React from 'react'
import { cn } from '@/lib/utils'

type GapSize = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8

const gapClass: Record<GapSize, string> = {
  0: 'gap-0',
  1: 'gap-1',
  2: 'gap-2',
  3: 'gap-3',
  4: 'gap-4',
  5: 'gap-5',
  6: 'gap-6',
  8: 'gap-8',
}

interface StackProps extends React.HTMLAttributes<HTMLDivElement> {
  gap?: GapSize
}

/** 纵向堆叠：取代各处自写 flex flex-col gap-x */
export function Stack({ gap = 4, className, ...props }: StackProps) {
  return <div className={cn('flex flex-col', gapClass[gap], className)} {...props} />
}

/** 横向排列：对齐方式用 items-* 传 className */
export function HStack({ gap = 2, className, ...props }: StackProps) {
  return <div className={cn('flex flex-row items-center', gapClass[gap], className)} {...props} />
}
