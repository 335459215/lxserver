/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // 统一断点（阶段 A 决策）：全项目只用 sm/md/lg 三档，消除旧版 1024/1025/CSS 三处不一致
  theme: {
    screens: {
      sm: '640px',
      md: '768px',
      lg: '1024px',
    },
    extend: {
      keyframes: {
        // Collapse（Radix Accordion）内容展开/收起；高度变量由 Radix 注入
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  // Radix 组件的 data-[state=open/closed] 进出场动画依赖本插件
  plugins: [require('tailwindcss-animate')],
}

