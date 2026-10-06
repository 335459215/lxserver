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
      // 明亮清爽语义色：全部映射 index.css 的 CSS 变量，组件层不写死色值
      colors: {
        bg: 'var(--bg)',
        panel: 'var(--panel)',
        panel2: 'var(--panel-2)',
        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',
        ink: 'var(--ink)',
        dim: 'var(--dim)',
        faint: 'var(--faint)',
        accent: 'var(--accent)',
        'accent-hover': 'var(--accent-hover)',
        'accent-soft': 'var(--accent-soft)',
        ok: 'var(--ok)',
        danger: 'var(--danger)',
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.03)',
        pop: '0 12px 40px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.05)',
      },
      fontFamily: {
        sans: ['"Spline Sans"', '-apple-system', '"PingFang SC"', '"HarmonyOS Sans SC"', '"Microsoft YaHei UI"', 'sans-serif'],
        mono: ['"Spline Sans Mono"', 'ui-monospace', '"Cascadia Mono"', 'Consolas', 'monospace'],
      },
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
