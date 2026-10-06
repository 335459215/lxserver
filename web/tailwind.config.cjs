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
    extend: {},
  },
  plugins: [],
}
