import { openPlayer, openAdmin, collectPageErrors, waitForAppReady, waitForAudioPlaying, perfMark, resourceSummary, VIEWPORTS } from '../lib/browser.mjs'
import { ADMIN_PASSWORD, FIXTURE_USER } from '../lib/fixture.mjs'
import { assert } from '../lib/http.mjs'
import { log } from '../lib/util.mjs'

/**
 * UI 面冒烟用例。全部基于真实 DOM（public/music/index.html 播放器 + public/index.html 后台），
 * 前后端都跑在本地 fixture 数据目录上，不碰真实音乐平台。
 *
 * 两个必须知道的坑：
 *  1) 播放器把所有 <select> 换成了自定义下拉（CustomSelectManager），原 select 被 display:none。
 *     所以要用 #cs-w-<id> 的 trigger + .cs-option 交互，直接 selectOption 会一直等不到可见元素。
 *  2) app.js 是 defer 脚本，goto 之后不能立刻调 window.switchTab，要先等它就绪。
 */

/** 已知缺陷（docs/stage0/defect-ledger.md）。旧前端基线 Expected 命中，新前端必须清零。 */
const KNOWN_DEFECTS = [
  { id: 'D-001', pattern: /goToPage is not defined/i, note: 'batch_pagination.js:523 引用未定义的 goToPage，加载即抛错并中断后续 export' },
  { id: 'D-002', pattern: /\[Dislike\] load failed.*请先登录本地账号/i, note: '首屏 dislike 偶发 401（公开空间上下文的请求早于用户态就绪），控制台报错；刷新后才正常' },
]

function classifyPageErrors(errors) {
  const known = []
  const unknown = []
  for (const e of errors) {
    const hit = KNOWN_DEFECTS.find((d) => d.pattern.test(e))
    if (hit) known.push(`${hit.id}: ${e}`)
    else unknown.push(e)
  }
  return { known, unknown }
}

async function openPage(browser, { viewport = 'desktop' } = {}) {
  const vp = VIEWPORTS[viewport] ?? VIEWPORTS.desktop
  const context = await browser.newContext({ viewport: vp })
  const page = await context.newPage()
  return { context, page }
}

async function gotoPlayer(ctx, { viewport = 'desktop', token = ctx.token } = {}) {
  const { context, page } = await openPlayer(ctx.browser, { baseUrl: ctx.baseUrl, token, viewport })
  const errors = collectPageErrors(page)
  await page.goto(ctx.playerUrl, { waitUntil: 'domcontentloaded' })
  await waitForAppReady(page)
  return { context, page, errors }
}

/** 通过自定义下拉选平台（播放器没有原生 select 可点） */
async function selectSearchSource(page, label = '酷我') {
  await page.waitForSelector('#cs-w-search-source .cs-trigger', { state: 'visible', timeout: 20000 })
  await page.click('#cs-w-search-source .cs-trigger')
  const option = page.locator('.cs-dropdown .cs-option', { hasText: label }).first()
  await option.waitFor({ state: 'visible', timeout: 10000 })
  await option.click()
  await page.waitForFunction((want) => document.getElementById('search-source')?.value === want, 'kw', { timeout: 10000 })
}

/** 执行一次搜索，返回渲染出来的行文本 */
async function runSearch(page, keyword) {
  await page.waitForSelector('#search-input', { state: 'visible', timeout: 30000 })
  await selectSearchSource(page)
  // 搜索框带 readonly + onfocus 移除（移动端键盘规避），必须先聚焦再输入
  await page.click('#search-input')
  await page.fill('#search-input', keyword)
  await page.click('button[onclick="doSearch()"]')
  await page.waitForSelector('#gl-row-0', { timeout: 45000 })
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[id^="gl-row-"]')).map((r) => (r.textContent || '').trim()),
  )
}

/**
 * 播放搜索结果里的第一行。
 *
 * 不能直接点整行：行的水平中心落在「歌手」列上，那一列有自己的
 * onclick（stopPropagation + 用歌手名重新搜索），点整行只会触发按歌手搜索，
 * 播放链路根本不会走。点行内「播放」按钮才是真实用户的播放动作。
 */
async function playFirstResult(page) {
  await page.waitForSelector('#gl-row-0 button[title="播放"]', { state: 'visible', timeout: 20000 })
  await page.click('#gl-row-0 button[title="播放"]')
}

const cases = [
  {
    id: 'UI-Y04-项目声明遮罩首次必现且可接受',
    group: '外观',
    async run(ctx) {
      // 不带 lx_agreement_accepted 的首次访问：遮罩必须挡住页面，且点「接受」后消失并写入标记
      const context = await ctx.browser.newContext({ viewport: VIEWPORTS.desktop })
      const page = await context.newPage()
      const errors = collectPageErrors(page)
      try {
        await page.goto(ctx.playerUrl, { waitUntil: 'domcontentloaded' })
        await waitForAppReady(page)
        await page.waitForSelector('#project-agreement-modal:not(.hidden)', { state: 'visible', timeout: 20000 })
        await page.click('button[onclick="acceptProjectAgreement()"]')
        await page.waitForSelector('#project-agreement-modal.hidden', { state: 'hidden', timeout: 15000 })
        const stored = await page.evaluate(() => localStorage.getItem('lx_agreement_accepted'))
        if (stored !== 'true') throw new Error(`接受协议未落库: ${stored}`)
        const { unknown } = classifyPageErrors(errors)
        if (unknown.length) throw new Error(`协议流程产生页面错误: ${unknown.slice(0, 3).join(' | ')}`)
        return { 首次必现: true, 接受后关闭: true, stored }
      } finally {
        await context.close()
      }
    },
  },

  {
    id: 'UI-P01-播放器首屏',
    group: '播放器',
    async run(ctx) {
      const { context, page, errors } = await gotoPlayer(ctx)
      try {
        await page.waitForSelector('#btn-play', { state: 'visible', timeout: 30000 })
        await page.waitForSelector('#audio-player', { state: 'attached', timeout: 30000 })
        await page.waitForLoadState('load').catch(() => {})
        const perf = await perfMark(page)
        const res = await resourceSummary(page)
        const title = await page.title()
        if (!title) throw new Error('页面标题为空')
        const { known, unknown } = classifyPageErrors(errors)
        if (unknown.length) throw new Error(`首屏有 ${unknown.length} 条未知页面错误: ${unknown.slice(0, 3).join(' | ')}`)
        return { title, 已知缺陷: known, perf, ...res }
      } finally {
        await context.close()
      }
    },
  },

  {
    id: 'UI-S01-关键词搜索有结果',
    group: '搜索',
    async run(ctx) {
      const { context, page, errors } = await gotoPlayer(ctx)
      try {
        const rows = await runSearch(page, '冒烟测试')
        if (!rows.length) throw new Error('搜索结果为空')
        if (!rows.some((t) => t.includes('冒烟测试曲'))) throw new Error(`搜索结果不含 fixture 曲目: ${rows[0]}`)
        const { unknown } = classifyPageErrors(errors)
        if (unknown.length) throw new Error(`搜索后有 ${unknown.length} 条页面错误: ${unknown.slice(0, 3).join(' | ')}`)
        return { 行数: rows.length, 首行: rows[0].slice(0, 60) }
      } finally {
        await context.close()
      }
    },
  },

  {
    id: 'UI-P04-端到端播放',
    group: '播放器',
    async run(ctx) {
      const { context, page, errors } = await gotoPlayer(ctx)
      try {
        await runSearch(page, '冒烟测试')
        await playFirstResult(page)
        await waitForAudioPlaying(page, 45000)
        const info = await page.evaluate(() => {
          const el = document.getElementById('audio-player')
          return { src: el.currentSrc || el.src, paused: el.paused, currentTime: el.currentTime, duration: el.duration, volume: el.volume, error: el.error?.code ?? null }
        })
        if (!/127\.0\.0\.1|smoke1001/.test(info.src)) throw new Error(`音频地址不是 mock 资源: ${info.src}`)
        if (info.error !== null) throw new Error(`audio 元素报错 code=${info.error}`)
        if (info.paused && info.currentTime <= 0.2) throw new Error('音频未真正播放')
        // 播放地址必须经服务端解析/中转，不能是裸外网地址（SSRF 防护的最小可见证据）
        if (/^https?:\/\/(?!127\.0\.0\.1)/.test(info.src)) throw new Error(`音频绕过了服务端: ${info.src}`)
        const { unknown } = classifyPageErrors(errors)
        if (unknown.length) throw new Error(`播放后有 ${unknown.length} 条页面错误: ${unknown.slice(0, 3).join(' | ')}`)
        return { src: info.src.slice(0, 90), currentTime: Number(info.currentTime.toFixed(2)), duration: info.duration, volume: info.volume }
      } finally {
        await context.close()
      }
    },
  },

  {
    id: 'UI-Y01-主题与外观切换并持久化',
    group: '外观',
    async run(ctx) {
      const { context, page, errors } = await gotoPlayer(ctx)
      try {
        await page.waitForSelector('#tab-settings', { state: 'visible', timeout: 30000 })
        await page.evaluate(() => window.switchTab('settings'))
        await page.waitForSelector('#view-settings:not(.hidden)', { timeout: 15000 })
        // 主题/外观按钮在「显示」子页里，默认显示的是别的子页（按钮尺寸 0x0）
        await page.evaluate(() => window.switchSettingsTab && window.switchSettingsTab('display'))
        await page.waitForSelector('button[onclick="setTheme(\'blue\')"]', { state: 'visible', timeout: 15000 })
        await page.click('button[onclick="setTheme(\'blue\')"]')
        await page.click('button[onclick="setAppearance(\'dark\')"]')
        const applied = await page.evaluate(() => ({
          theme: document.documentElement.getAttribute('data-theme'),
          appearance: document.documentElement.getAttribute('data-appearance'),
          dark: document.documentElement.classList.contains('dark'),
        }))
        if (applied.theme !== 'blue') throw new Error(`配色未生效: ${JSON.stringify(applied)}`)
        if (!applied.dark) throw new Error('深色模式未生效')

        await page.reload({ waitUntil: 'domcontentloaded' })
        await waitForAppReady(page)
        const after = await page.evaluate(() => ({
          theme: document.documentElement.getAttribute('data-theme'),
          dark: document.documentElement.classList.contains('dark'),
          stored: localStorage.getItem('lx_theme'),
        }))
        if (after.theme !== 'blue' || !after.dark) throw new Error(`刷新后主题丢失: ${JSON.stringify(after)}`)
        const { unknown } = classifyPageErrors(errors)
        if (unknown.length) throw new Error(`主题切换产生页面错误: ${unknown.slice(0, 3).join(' | ')}`)
        return { applied, after }
      } finally {
        await context.close()
      }
    },
  },

  {
    id: 'UI-Y02-设置页可打开',
    group: '外观',
    async run(ctx) {
      const { context, page, errors } = await gotoPlayer(ctx)
      try {
        await page.evaluate(() => window.switchTab('settings'))
        await page.waitForSelector('#view-settings:not(.hidden)', { timeout: 15000 })
        await page.evaluate(() => window.switchSettingsTab && window.switchSettingsTab('system'))
        await page.waitForSelector('#settings-panel-system', { state: 'visible', timeout: 15000 })
        if (!await page.isVisible('#settings-panel-system')) throw new Error('设置面板不可见')
        // 设置页有大量自定义下拉/开关，能打开且无未知页面错误就算过
        const { unknown } = classifyPageErrors(errors)
        if (unknown.length) throw new Error(`设置页有 ${unknown.length} 条页面错误: ${unknown.slice(0, 3).join(' | ')}`)
        return { ok: true }
      } finally {
        await context.close()
      }
    },
  },

  {
    id: 'UI-响应式-移动端侧边栏抽屉',
    group: '外观',
    async run(ctx) {
      const { context, page } = await gotoPlayer(ctx, { viewport: 'mobile' })
      try {
        await page.waitForSelector('#main-sidebar', { state: 'attached', timeout: 30000 })
        const width = await page.evaluate(() => window.innerWidth)
        if (width !== VIEWPORTS.mobile.width) throw new Error(`视口宽度异常: ${width}`)
        const collapsed = await page.evaluate(() => document.getElementById('main-sidebar').className)
        if (!/translate-x-full/.test(collapsed)) throw new Error(`移动端侧边栏初始未收起: ${collapsed.slice(0, 80)}`)
        await page.evaluate(() => window.toggleSidebar && window.toggleSidebar())
        await page.waitForTimeout(600)
        const expanded = await page.evaluate(() => document.getElementById('main-sidebar').className)
        if (/translate-x-full/.test(expanded)) throw new Error('点击汉堡后侧边栏未展开')
        return { width, 初始收起: true, 点击后展开: true }
      } finally {
        await context.close()
      }
    },
  },

  {
    id: 'UI-AD01-后台登录（错密码拒绝）',
    group: '后台',
    async run(ctx) {
      const { context, page } = await openPage(ctx.browser)
      try {
        await page.goto(ctx.adminUrl, { waitUntil: 'domcontentloaded' })
        await page.waitForSelector('#access-password', { state: 'visible', timeout: 30000 })
        await page.fill('#access-password', 'wrong-password-smoke')
        await page.click('#login-btn')
        await page.waitForTimeout(2500)
        const state = await page.evaluate(() => ({
          appVisible: !document.getElementById('app')?.classList.contains('hidden'),
          loginVisible: !document.getElementById('login-overlay')?.classList.contains('hidden'),
          error: document.getElementById('login-error')?.textContent || '',
          stored: localStorage.getItem('lx_auth'),
        }))
        if (state.appVisible) throw new Error('错误密码竟然进入了后台')
        if (!state.loginVisible) throw new Error('错误密码后登录遮罩消失')
        if (state.stored === 'wrong-password-smoke') throw new Error('错误密码被写入 localStorage')

        await page.fill('#access-password', ADMIN_PASSWORD)
        await page.click('#login-btn')
        await page.waitForSelector('#app:not(.hidden)', { timeout: 20000 })
        await page.waitForSelector('#view-dashboard:not(.hidden)', { timeout: 20000 })
        return { 错密码已拒绝: true, 正确密码已进入: true, 错误提示: state.error || '(无文案)' }
      } finally {
        await context.close()
      }
    },
  },

  {
    id: 'UI-AD01-仪表盘渲染',
    group: '后台',
    async run(ctx) {
      const { context, page } = await openAdmin(ctx.browser, { baseUrl: ctx.baseUrl, adminPath: ctx.adminPath })
      const errors = collectPageErrors(page)
      try {
        await page.goto(ctx.adminUrl, { waitUntil: 'domcontentloaded' })
        await page.waitForSelector('#view-dashboard.active', { timeout: 30000 })
        await page.waitForTimeout(2500) // 等仪表盘数据请求回来
        const stats = await page.evaluate(() => {
          const text = document.getElementById('view-dashboard')?.textContent || ''
          return {
            有内容: text.trim().length > 20,
            统计卡数量: document.querySelectorAll('#view-dashboard [class*="stat"], #view-dashboard .card').length,
            标题: document.getElementById('page-title')?.textContent || '',
          }
        })
        if (!stats.有内容) throw new Error('仪表盘无内容')
        if (errors.length) throw new Error(`仪表盘有 ${errors.length} 条页面错误: ${errors.slice(0, 3).join(' | ')}`)
        return stats
      } finally {
        await context.close()
      }
    },
  },

  {
    id: 'UI-AD02-用户管理渲染',
    group: '后台',
    async run(ctx) {
      const { context, page } = await openAdmin(ctx.browser, { baseUrl: ctx.baseUrl, adminPath: ctx.adminPath })
      const errors = collectPageErrors(page)
      try {
        await page.goto(ctx.adminUrl, { waitUntil: 'domcontentloaded' })
        await page.waitForSelector('#app:not(.hidden)', { timeout: 30000 })
        await page.click('.nav-item[data-view="users"]')
        await page.waitForSelector('#view-users.active', { timeout: 20000 })
        await page.waitForSelector('#users-list > *', { timeout: 25000 })
        const rows = await page.evaluate((user) => {
          const box = document.getElementById('users-list')
          return { 数量: box.children.length, 含fixture用户: (box.textContent || '').includes(user) }
        }, FIXTURE_USER)
        if (!rows.数量) throw new Error('用户列表为空')
        return rows
      } finally {
        await context.close()
      }
    },
  },

  {
    id: 'UI-AD04-配置页渲染',
    group: '后台',
    async run(ctx) {
      const { context, page } = await openAdmin(ctx.browser, { baseUrl: ctx.baseUrl, adminPath: ctx.adminPath })
      const errors = collectPageErrors(page)
      try {
        await page.goto(ctx.adminUrl, { waitUntil: 'domcontentloaded' })
        await page.waitForSelector('#app:not(.hidden)', { timeout: 30000 })
        await page.click('.nav-item[data-view="config"]')
        await page.waitForSelector('#view-config.active', { timeout: 20000 })
        await page.waitForTimeout(3000) // 配置项很多，等渲染完
        const info = await page.evaluate(() => ({
          控件数: document.querySelectorAll('#view-config input, #view-config select, #view-config textarea').length,
          标题: document.getElementById('page-title')?.textContent || '',
        }))
        if (!info.控件数) throw new Error('配置页无控件')
        if (errors.length) throw new Error(`配置页有 ${errors.length} 条页面错误: ${errors.slice(0, 3).join(' | ')}`)
        return info
      } finally {
        await context.close()
      }
    },
  },

  {
    id: 'UI-AD08-日志页渲染',
    group: '后台',
    async run(ctx) {
      const { context, page } = await openAdmin(ctx.browser, { baseUrl: ctx.baseUrl, adminPath: ctx.adminPath })
      const errors = collectPageErrors(page)
      try {
        await page.goto(ctx.adminUrl, { waitUntil: 'domcontentloaded' })
        await page.waitForSelector('#app:not(.hidden)', { timeout: 30000 })
        await page.click('.nav-item[data-view="logs"]')
        await page.waitForSelector('#view-logs.active', { timeout: 20000 })
        await page.waitForTimeout(3500)
        const 有内容 = await page.evaluate(() => (document.getElementById('view-logs')?.textContent || '').trim().length > 10)
        if (!有内容) throw new Error('日志页无内容')
        return { 有内容 }
      } finally {
        await context.close()
      }
    },
  },

  {
    id: 'UI-AD09-文件管理器可打开',
    group: '后台',
    async run(ctx) {
      const { context, page } = await openPage(ctx.browser)
      try {
        const res = await page.goto(`${ctx.baseUrl}/filemanager.html`, { waitUntil: 'domcontentloaded', timeout: 30000 })
        const status = res?.status() ?? 0
        if (status !== 200) throw new Error(`filemanager.html 返回 ${status}`)
        // elFinder 会把 URL 改写成一个目录形态，页面处于持续重写状态，
        // 因此不追求"完全静止"，只要 body 有实际内容就算打开成功。
        const probe = async () => page.evaluate(() => ({
          len: document.body ? document.body.innerHTML.length : -1,
          url: location.href,
          ready: document.readyState,
        })).catch((e) => ({ err: e.message }))
        let last = await probe()
        const deadline = Date.now() + 20000
        while (Date.now() < deadline && !(last && last.len > 50)) {
          await new Promise((r) => setTimeout(r, 500))
          last = await probe()
        }
        if (!last || last.err) throw new Error(`文件管理器页读取失败: ${JSON.stringify(last)}`)
        if (last.len <= 50) throw new Error(`文件管理器页面为空: ${JSON.stringify(last)}`)
        return { status, bodyBytes: last.len, url: last.url }
      } finally {
        await context.close()
      }
    },
  },

  {
    id: 'UI-Y03-PWA-manifest-与-SW',
    group: '外观',
    async run(ctx) {
      const manifestRes = await ctx.http.get('/manifest.json', { auth: 'none' })
      const manifest = manifestRes.json ?? {}
      if (!Array.isArray(manifest.icons) || !manifest.icons.length) throw new Error('manifest 无图标')
      const swRes = await ctx.http.get('/sw.js', { auth: 'none' })
      const swText = swRes.text ?? ''
      if (!/addEventListener|CACHE|caches\./.test(swText)) throw new Error('sw.js 不像 ServiceWorker')
      return { 图标数: manifest.icons.length, startUrl: manifest.start_url, swBytes: swText.length }
    },
  },
]

export const uiCases = cases
