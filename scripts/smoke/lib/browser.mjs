import { chromium } from 'playwright'
import { FIXTURE_PASSWORD, FIXTURE_USER } from './fixture.mjs'
import { ADMIN_PASSWORD } from './fixture.mjs'
import { log } from './util.mjs'

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 834, height: 1112 },
  mobile: { width: 390, height: 844 },
}

export async function launchBrowser({ headless = true } = {}) {
  const browser = await chromium.launch({
    headless,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
      '--disable-dev-shm-usage',
    ],
  })
  return browser
}

/**
 * 播放器页面上下文：预置 fixture 用户登录态 + 搜索平台固定为 kw（否则默认聚合，
 * 会把 5 个平台一起打，4 个走 mock 502，噪声很大）。
 */
export async function openPlayer(browser, { baseUrl, token, playerPath = '/', viewport = 'desktop', context: userContext } = {}) {
  const context = userContext ?? await browser.newContext({
    viewport: VIEWPORTS[viewport] ?? VIEWPORTS.desktop,
    permissions: [],
  })
  await context.addInitScript(({ token, user }) => {
    if (token) localStorage.setItem('lx_user_token', token)
    localStorage.setItem('lx_sync_user', user)
    localStorage.setItem('lx_search_source', 'kw')
    localStorage.setItem('lx_settings', JSON.stringify({ searchSource: 'kw', defaultEntry: 'search' }))
    // 首次访问会弹「项目使用声明」遮罩（common_ui.checkProjectAgreement），
    // 它拦截所有点击。功能性用例预置已接受，遮罩本身由 UI-Y04 专门验证。
    localStorage.setItem('lx_agreement_accepted', 'true')
  }, { token, user: FIXTURE_USER })
  const page = await context.newPage()
  return { context, page }
}

export async function openAdmin(browser, { baseUrl, adminPath = '/admin/', viewport = 'desktop' } = {}) {
  const context = await browser.newContext({
    viewport: VIEWPORTS[viewport] ?? VIEWPORTS.desktop,
  })
  await context.addInitScript(({ pw }) => {
    localStorage.setItem('lx_auth', pw)
  }, { pw: ADMIN_PASSWORD })
  const page = await context.newPage()
  return { context, page }
}

/**
 * 等待播放器 app.js 就绪。
 *
 * app.js 是 defer 脚本，goto 返回时它还没执行完，直接调 window.switchTab 之类会拿到
 * undefined；这两函数是各功能模块的公共入口，它们出现即代表脚本已跑完。
 */
export async function waitForAppReady(page, timeoutMs = 30000) {
  await page.waitForFunction(() => typeof window.switchTab === 'function' && typeof window.doSearch === 'function', null, { timeout: timeoutMs })
}

/** 收集页面错误与 console.error，UI 用例用它判定"页面有没有悄悄坏掉" */
export function collectPageErrors(page) {
  const errors = []
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text()
      // CDN/网络类噪声（mock 环境下必然出现）不计入
      if (/Failed to load resource|net::ERR|ERR_(NAME|CONNECTION|BLOCKED)/i.test(text)) return
      // 无头 Chrome 没有可见标签页，Wake Lock 必然拒绝；真实浏览器上不存在
      if (/Wake Lock permission request denied|NotAllowedError/i.test(text)) return
      errors.push(`console.error: ${text}`)
    }
  })
  return errors
}

export async function waitForAudioPlaying(page, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const el = document.getElementById('audio-player')
      if (!el) return { el: false }
      return { el: true, paused: el.paused, currentTime: el.currentTime, src: el.currentSrc || el.src, error: el.error?.code ?? null }
    })
    if (state.el && (!state.paused || state.currentTime > 0.2)) return state
    await new Promise((r) => setTimeout(r, 400))
  }
  const state = await page.evaluate(() => {
    const el = document.getElementById('audio-player')
    return el ? { paused: el.paused, currentTime: el.currentTime, src: el.currentSrc, error: el.error?.code ?? null } : null
  })
  throw new Error(`音频未开始播放: ${JSON.stringify(state)}`)
}

export function perfMark(page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0]
    const paint = performance.getEntriesByType('paint')
    return {
      domContentLoaded: nav?.domContentLoadedEventEnd ?? null,
      loadEventEnd: nav?.loadEventEnd ?? null,
      firstContentfulPaint: paint.find((p) => p.name === 'first-contentful-paint')?.startTime ?? null,
      transferSize: nav?.transferSize ?? null,
      encodedBodySize: nav?.encodedBodySize ?? null,
    }
  })
}

export async function resourceSummary(page) {
  return page.evaluate(() => {
    const entries = performance.getEntriesByType('resource')
    let js = 0, css = 0, other = 0, jsBytes = 0, cssBytes = 0
    for (const e of entries) {
      if (e.initiatorType === 'script' || /\.js($|\?)/.test(e.name)) { js++; jsBytes += e.transferSize || 0 }
      else if (/\.css($|\?)/.test(e.name)) { css++; cssBytes += e.transferSize || 0 }
      else other++
    }
    return { total: entries.length, js, css, other, jsBytes, cssBytes }
  })
}

export { log }
