import fs from 'node:fs'
import zlib from 'node:zlib'
import path from 'node:path'
import { REPO_ROOT } from '../lib/paths.mjs'
import { openPlayer, waitForAppReady, waitForAudioPlaying, perfMark, resourceSummary } from '../lib/browser.mjs'
import { log } from '../lib/util.mjs'

/**
 * 性能基线（阶段 0 交付物之一，对应 docs/stage0/perf-baseline.md）。
 *
 * 这组用例既是「记录现状」也是「验收闸门」：每个数字都带预算，
 * 阶段 A 之后的新前端跑同一组（--surface new）必须全部落在预算内。
 * 预算按阶段 0 实测值定，宁松不假 —— 松了只是提醒，紧了会让套件变成 flaky。
 */

const KB = 1024
const file = (p) => fs.readFileSync(path.join(REPO_ROOT, p))
const gzipSize = (buf) => zlib.gzipSync(buf, { level: 9 }).length

/** 旧前端的实测值附近留余量：旧版只是「记录现状」，不是要它变快 */
export const PERF_BUDGETS_OLD = {
  playerJsRawKB: 900, // app.js 单文件（实测 707KB 原始 / 164KB gzip）
  playerJsGzipKB: 200,
  firstScreenTransferKB: 900, // 首屏 JS+CSS 实际传输量（gzip 后）
  domContentLoadedMs: 6000,
  appReadyMs: 12000,
  firstContentfulPaintMs: 8000,
  firstScreenRequests: 80,
  heapIdleMB: 260,
  heapPlayingMB: 420,
}

/** 新前端（阶段 A 起）的目标值：打包后一个入口，砍掉 29 个零散 JS 与重复请求 */
export const PERF_BUDGETS_NEW = {
  playerJsRawKB: 900,
  playerJsGzipKB: 200,
  firstScreenTransferKB: 400,
  domContentLoadedMs: 3000,
  appReadyMs: 8000,
  firstContentfulPaintMs: 4000,
  firstScreenRequests: 35,
  heapIdleMB: 200,
  heapPlayingMB: 300,
}

export const budgetsFor = (surface) => (surface === 'new' ? PERF_BUDGETS_NEW : PERF_BUDGETS_OLD)

function assertBudget(name, value, budget, unit) {
  if (value > budget) throw new Error(`${name} 超预算: ${value}${unit} > ${budget}${unit}`)
  return `${name}=${value}${unit} (预算 ${budget}${unit})`
}

export const perfCases = [
  {
    id: 'PERF-01-播放器包体积预算',
    group: '性能',
    title: 'app.js / index.html 原始体积与 gzip 体积在预算内',
    async run(ctx) {
      const PERF_BUDGETS = budgetsFor(ctx.surface)
      const appJs = file('public/music/app.js')
      const indexHtml = file('public/music/index.html')
      const jsDir = path.join(REPO_ROOT, 'public/music/js')
      const extra = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js'))
      const extraRaw = extra.reduce((n, f) => n + fs.statSync(path.join(jsDir, f)).size, 0)

      const results = [
        assertBudget('app.js 原始', Math.round(appJs.length / KB), PERF_BUDGETS.playerJsRawKB, 'KB'),
        assertBudget('app.js gzip', Math.round(gzipSize(appJs) / KB), PERF_BUDGETS.playerJsGzipKB, 'KB'),
      ]
      return {
        appJsRawKB: +(appJs.length / KB).toFixed(1),
        appJsGzipKB: +(gzipSize(appJs) / KB).toFixed(1),
        indexHtmlRawKB: +(indexHtml.length / KB).toFixed(1),
        musicJsExtraFiles: extra.length,
        musicJsExtraRawKB: +(extraRaw / KB).toFixed(1),
        budgets: results,
      }
    },
  },

  {
    id: 'PERF-02-首屏可交互时间',
    group: '性能',
    title: 'domContentLoaded / load / FCP / app 就绪时间在预算内',
    async run(ctx) {
      const PERF_BUDGETS = budgetsFor(ctx.surface)
      const { context, page } = await openPlayer(ctx.browser, { baseUrl: ctx.baseUrl, token: ctx.token })
      try {
        const t0 = Date.now()
        await page.goto(ctx.playerUrl, { waitUntil: 'domcontentloaded' })
        await waitForAppReady(page)
        const appReadyMs = Date.now() - t0
        await page.waitForTimeout(1200)
        const nav = await perfMark(page)
        const results = [
          assertBudget('domContentLoaded', Math.round(nav.domContentLoaded ?? 0), PERF_BUDGETS.domContentLoadedMs, 'ms'),
          assertBudget('loadEventEnd', Math.round(nav.loadEventEnd ?? 0), PERF_BUDGETS.domContentLoadedMs, 'ms'),
          assertBudget('FCP', Math.round(nav.firstContentfulPaint ?? 0), PERF_BUDGETS.firstContentfulPaintMs, 'ms'),
          assertBudget('app 就绪', appReadyMs, PERF_BUDGETS.appReadyMs, 'ms'),
        ]
        return { ...nav, appReadyMs, budgets: results }
      } finally {
        await context.close()
      }
    },
  },

  {
    id: 'PERF-03-首屏请求数与传输量',
    group: '性能',
    title: '首屏请求数、JS/CSS 传输量在预算内',
    async run(ctx) {
      const PERF_BUDGETS = budgetsFor(ctx.surface)
      const { context, page } = await openPlayer(ctx.browser, { baseUrl: ctx.baseUrl, token: ctx.token })
      try {
        // 只数「首屏真正需要的请求」：app 就绪之后的轮询（cache/stats、tasks/status 等）
        // 是后台行为，算进来会让数字随等待时长漂移。
        const requests = []
        page.on('request', (r) => requests.push({ url: r.url(), at: Date.now() }))
        const t0 = Date.now()
        await page.goto(ctx.playerUrl, { waitUntil: 'domcontentloaded' })
        await waitForAppReady(page)
        const readyAt = Date.now()
        await page.waitForTimeout(1500)
        const res = await resourceSummary(page)
        const firstScreen = requests.filter((r) => r.at - t0 <= readyAt - t0)
        const background = requests.length - firstScreen.length
        const results = [
          assertBudget('首屏请求数', firstScreen.length, PERF_BUDGETS.firstScreenRequests, ' 个'),
          assertBudget('JS+CSS 传输量', Math.round((res.jsBytes + res.cssBytes) / KB), PERF_BUDGETS.firstScreenTransferKB, 'KB'),
        ]
        return { firstScreenRequests: firstScreen.length, backgroundRequests: background, ...res, jsPlusCssKB: +((res.jsBytes + res.cssBytes) / KB).toFixed(1), budgets: results }
      } finally {
        await context.close()
      }
    },
  },

  {
    id: 'PERF-04-静态资源重复请求是否重复压缩',
    group: '性能',
    title: '记录 serveStatic 对同一资源的重复 gzip 行为（阶段 A 预压缩要治理的对象）',
    async run(ctx) {
      // 阶段 A 要做「构建期预压缩」，这里记录改造前的数字作为对照。
      // 不设预算：这是行为记录，不是回归判定；NAS 弱 CPU 上 1~2MB bundle
      // 每次请求重压 30~80ms，才是 stage0 要量化的理由。
      // 注意：fetch 会透明解压，所以量的是 content-length（线上字节数），不是 buffer 长度。
      const timings = []
      for (let i = 0; i < 3; i++) {
        const t = Date.now()
        const res = await fetch(`${ctx.baseUrl}/app.js`, { headers: { 'Accept-Encoding': 'gzip' } })
        await res.arrayBuffer()
        timings.push({
          round: i + 1,
          status: res.status,
          encoding: res.headers.get('content-encoding'),
          wireBytesKB: +((Number(res.headers.get('content-length')) || 0) / KB).toFixed(1),
          ms: Date.now() - t,
        })
      }
      const rawKB = +(file('public/music/app.js').length / KB).toFixed(1)
      return {
        gzipRequests: timings,
        appJsRawKB: rawKB,
        note: 'wireBytesKB(164KB) ≈ 磁盘 gzip 体积，而原始文件 707KB：每次请求都在重新读文件 + 重压，无缓存',
      }
    },
  },

  {
    id: 'PERF-05-播放中内存占用',
    group: '性能',
    title: '首屏后与播放中的 JS 堆内存在预算内',
    async run(ctx) {
      const PERF_BUDGETS = budgetsFor(ctx.surface)
      const { context, page } = await openPlayer(ctx.browser, { baseUrl: ctx.baseUrl, token: ctx.token })
      try {
        await page.goto(ctx.playerUrl, { waitUntil: 'domcontentloaded' })
        await waitForAppReady(page)
        await page.waitForTimeout(1500)
        const idle = await page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null))
        assertBudget('首屏后堆内存', idle ?? 0, PERF_BUDGETS.heapIdleMB, 'MB')

        await page.waitForSelector('#cs-w-search-source .cs-trigger', { state: 'visible' })
        await page.click('#cs-w-search-source .cs-trigger')
        await page.locator('.cs-dropdown .cs-option', { hasText: '酷我' }).first().click()
        await page.click('#search-input')
        await page.fill('#search-input', '冒烟测试')
        await page.click('button[onclick="doSearch()"]')
        await page.waitForSelector('#gl-row-0', { timeout: 45000 })
        await page.click('#gl-row-0 button[title="播放"]')
        await waitForAudioPlaying(page, 45000)
        await page.waitForTimeout(1500)
        const playing = await page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null))
        assertBudget('播放中堆内存', playing ?? 0, PERF_BUDGETS.heapPlayingMB, 'MB')
        return { idleHeapMB: idle, playingHeapMB: playing, note: 'performance.memory 是 Chrome 近似值，用于纵向对比而非绝对值' }
      } finally {
        await context.close()
      }
    },
  },
]

export default perfCases
