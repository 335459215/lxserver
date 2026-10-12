#!/usr/bin/env node
/**
 * MCP 服务器冒烟测试（不依赖任何 MCP 客户端）
 *
 * 用 SDK 的 Client + StdioClientTransport 把 mcp/index.js 当子进程拉起来，
 * 走完整的 JSON-RPC 握手 → listTools → callTool 流程。
 * 这样测的是「真实协议链路」，而不是直接 import 内部函数。
 *
 * 用法：node mcp/test-smoke.mjs <BASE_URL> <TOKEN>
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.argv[2] || 'http://127.0.0.1:9601'
const TOKEN = process.argv[3] || ''
if (!TOKEN) {
  console.error('用法: node test-smoke.mjs <BASE_URL> <TOKEN>')
  process.exit(1)
}

const here = path.dirname(fileURLToPath(import.meta.url))
let pass = 0
let fail = 0

function check(name, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`PASS  ${name}${detail ? `  [${detail}]` : ''}`)
  } else {
    fail++
    console.log(`FAIL  ${name}${detail ? `  [${detail}]` : ''}`)
  }
}

/** 调一个工具并把返回的 JSON 文本解析回来 */
async function callJson(client, name, args = {}) {
  const res = await client.callTool({ name, arguments: args })
  const text = res.content?.find((c) => c.type === 'text')?.text ?? ''
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(here, 'index.js')],
  env: { ...process.env, LXSERVER_URL: BASE, LXSERVER_TOKEN: TOKEN },
})

const client = new Client({ name: 'smoke-test', version: '1.0.0' }, { capabilities: {} })

try {
  await client.connect(transport)
  check('MCP 握手成功（stdio 传输建立）', true)

  // ---- 工具清单 ----
  const { tools } = await client.listTools()
  const names = tools.map((t) => t.name)
  check('listTools 返回工具列表', names.length > 0, `${names.length} 个`)
  const expected = [
    'search_music',
    'resolve_play_url',
    'get_lyric',
    'get_hot_search',
    'list_leaderboards',
    'get_leaderboard_songs',
    'list_playlists',
    'get_playlist_songs',
    'get_play_history',
    'get_server_status',
    'list_local_music',
    'list_users',
  ]
  for (const n of expected) {
    check(`工具存在：${n}`, names.includes(n))
  }
  check(
    '每个工具都有 description（模型靠它决定何时调用）',
    tools.every((t) => (t.description || '').length > 10),
  )
  check(
    '每个工具都有 inputSchema',
    tools.every((t) => t.inputSchema && t.inputSchema.type === 'object'),
  )

  // ---- 只读工具逐个调用 ----
  const status = await callJson(client, 'get_server_status')
  check('get_server_status 返回对象', status && typeof status === 'object', `keys=${Object.keys(status || {}).length}`)

  const users = await callJson(client, 'list_users')
  check('list_users 返回用户列表', Array.isArray(users) || !!users?.users, Array.isArray(users) ? `${users.length} 个` : 'ok')

  const hot = await callJson(client, 'get_hot_search', { source: 'kw' })
  check('get_hot_search 返回热搜', Array.isArray(hot?.热搜), `${hot?.热搜?.length ?? 0} 条`)

  const boards = await callJson(client, 'list_leaderboards', { source: 'kw' })
  check('list_leaderboards 返回榜单', Array.isArray(boards?.榜单) && boards.榜单.length > 0, `${boards?.榜单?.length ?? 0} 个`)

  // ---- 搜索（核心链路）----
  const search = await callJson(client, 'search_music', { keyword: '晴天', source: 'kw', limit: 5 })
  const songs = search?.结果 ?? []
  check('search_music 返回歌曲', Array.isArray(songs) && songs.length > 0, `${songs.length} 首`)
  check(
    '搜索结果被裁剪过字段（不是平台原始大对象）',
    songs.length > 0 && Object.keys(songs[0]).length <= 8,
    songs.length ? `字段数=${Object.keys(songs[0]).length}` : 'n/a',
  )
  check('搜索结果含 source 与 songmid（能接着解析）', !!(songs[0]?.source && songs[0]?.songmid), `${songs[0]?.source}/${songs[0]?.songmid}`)

  // ---- 播放直链（搜索 → 解析闭环）----
  if (songs[0]?.source && songs[0]?.songmid) {
    // 注意：解析依赖**自定义音源**。隔离实例里通常没有音源，
    // 此时服务端会返回 500「未找到支持 X 平台的自定义源」—— 这是环境缺失而非 MCP 缺陷。
    // 故这里把「解析失败但错误信息可读」也算通过，只断言**错误被正确传递**。
    let url
    let resolveErr = ''
    try {
      url = await callJson(client, 'resolve_play_url', {
        source: songs[0].source,
        songmid: songs[0].songmid,
        name: songs[0].name,
        singer: songs[0].singer,
        quality: '320k',
      })
    } catch (e) {
      resolveErr = String(e?.message || e)
    }

    if (resolveErr) {
      const noSource = /自定义源/.test(resolveErr)
      check(
        noSource ? 'resolve_play_url 无音源时给出可读错误（环境缺失，非缺陷）' : 'resolve_play_url 错误可读',
        noSource && /未找到支持/.test(resolveErr),
        resolveErr.slice(0, 80),
      )
    } else {
      check(
        'resolve_play_url 返回直链',
        typeof url?.直链 === 'string' && url.直链.startsWith('http'),
        String(url?.直链 || url?.错误 || '').slice(0, 60),
      )
      check('返回值带实得音质', !!url?.实得音质, String(url?.实得音质))
    }

    const lyric = await callJson(client, 'get_lyric', {
      source: songs[0].source,
      songmid: songs[0].songmid,
      name: songs[0].name,
      singer: songs[0].singer,
    })
    check('get_lyric 返回结构（有/无歌词都算通过）', typeof lyric?.有歌词 === 'boolean', `有歌词=${lyric?.有歌词}`)
  }

  // ---- 榜单曲目 ----
  if (boards?.榜单?.[0]?.id) {
    // 上游偶发 Socket Hang Up / ECONNRESET 时重试几次（与本机到音乐 CDN 的链路有关，
    // 不是服务端缺陷）。真失败才计失败。
    let ls = null
    let lastErr = ''
    for (let i = 0; i < 3; i++) {
      try {
        ls = await callJson(client, 'get_leaderboard_songs', {
          source: 'kw',
          bangid: String(boards.榜单[0].id),
          limit: 5,
        })
        break
      } catch (e) {
        lastErr = String(e?.message || e)
        await new Promise((r) => setTimeout(r, 1500))
      }
    }
    check(
      'get_leaderboard_songs 返回曲目',
      Array.isArray(ls?.曲目),
      ls ? `${ls?.曲目?.length ?? 0} 首` : lastErr.slice(0, 70),
    )
  }

  // ---- 歌单 / 历史 / 本地音乐 ----
  const lists = await callJson(client, 'list_playlists')
  check('list_playlists 有返回', lists !== undefined && lists !== null)

  const hist = await callJson(client, 'get_play_history', { limit: 5 })
  check('get_play_history 有返回', Array.isArray(hist?.历史), `${hist?.历史?.length ?? 0} 条`)

  const local = await callJson(client, 'list_local_music')
  check('list_local_music 有返回', typeof local?.文件数 === 'number', `${local?.文件数} 个文件`)

  // ---- 错误处理 ----
  let errOk = false
  try {
    await client.callTool({ name: 'no_such_tool', arguments: {} })
  } catch {
    errOk = true
  }
  check('调用不存在的工具会报错（不是静默返回空）', errOk)
} catch (e) {
  check('MCP 测试整体未抛异常', false, String(e?.message || e).slice(0, 200))
} finally {
  await client.close().catch(() => {})
}

console.log(`\n===== ${pass}/${pass + fail} checks passed =====`)
process.exit(fail > 0 ? 1 : 0)
