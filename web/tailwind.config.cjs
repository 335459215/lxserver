/** @type {import('tailwindcss').Config} */

/** 语义色工厂：见下方 colors 处的说明。
 *  name 是 CSS 变量的基名（如 'accent' → --accent / --accent-rgb）。 */
const solidOrAlpha = (name) => ({ opacityValue }) =>
  opacityValue === undefined || opacityValue === null
    ? `var(--${name})`
    : `rgb(var(--${name}-rgb) / ${opacityValue})`

module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // 统一断点（阶段 A 决策）：断点只在配置里定义一次，消除旧版 1024/1025/CSS 三处不一致。
  // xl(1280) 是 v2.14 为「右侧正在播放面板」补的——面板宽 320px，加上左侧栏 224px，
  // 低于 1280 会把主内容挤扁，所以这个档位是必要的，不是随手加的。
  theme: {
    screens: {
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
    },
    extend: {
      // 明亮清爽语义色：全部映射 index.css 的 CSS 变量，组件层不写死色值。
      //
      // 为什么是函数而不是字符串：Tailwind v3 只能对「R G B 通道三元组」合成透明度。
      // 直接把颜色写成 `var(--accent)`（不透明值）时，`bg-accent/60`、`ring-accent/40`
      // 这类带 alpha 的类名会**静默不生成** —— 本项目曾因此让全部半透明面板、
      // hover 强调边框、focus ring 一起失效（产物 CSS 里查无此规则，无任何报错）。
      // 故：不带 alpha 时仍返回 `var(--x)`（保住 @property 的封面取色渐变），
      // 带 alpha 时才切到三元组。三元组定义在 index.css，与颜色值成对出现。
      colors: {
        bg: solidOrAlpha('bg'),
        panel: solidOrAlpha('panel'),
        panel2: solidOrAlpha('panel-2'),
        line: solidOrAlpha('line'),
        'line-strong': solidOrAlpha('line-strong'),
        ink: solidOrAlpha('ink'),
        dim: solidOrAlpha('dim'),
        faint: solidOrAlpha('faint'),
        accent: solidOrAlpha('accent'),
        'accent-hover': solidOrAlpha('accent-hover'),
        'accent-soft': solidOrAlpha('accent-soft'),
        ok: solidOrAlpha('ok'),
        danger: solidOrAlpha('danger'),
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
