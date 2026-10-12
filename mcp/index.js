#!/usr/bin/env node
/**
 * lxserver MCP 服务器
 * ====================
 *
 * 让 AI agent（Claude Desktop / Cursor / 任何 MCP 客户端）用**访问令牌**控制 lxserver：
 * 搜索歌曲、看榜单与热搜、解析播放直链、读歌单与收藏、查播放历史、看服务器状态。
 *
 * 【为什么需要令牌，而不是账号密码】
 * 与 Emby / Jellyfin 一个思路：网页用账号密码登录，外部工具用长期令牌。
 * 令牌在 lxserver 的「设置 → 令牌」里生成，可命名、可单独吊销、可设有效期，
 * 服务端日志里能看出是哪个令牌在用。把账号密码塞进 AI 工具的配置文件里显然不合适。
 *
 * 【用法】环境变量：
 *   LXSERVER_URL    服务器地址，如 http://192.168.1.28:9528（默认 http://127.0.0.1:9527）
 *   LXSERVER_TOKEN  在「设置 → 令牌」里生成的令牌（必填）
 *
 * 令牌按以下顺序尝试（与服务端一致）：
 *   1. Authorization: Bearer <token>   2. x-user-token: <token>   3. ?auth=<token>
 * 本文件用第 1 种（标准做法）。
 *
 * 【设计取舍】
 *   - 只读为主：暴露的都是「查询」类能力。写操作（改配置、删用户）刻意不暴露 ——
 *     让 AI 改服务端配置的风险远大于收益，需要时让人自己去界面点。
 *   - 搜索类工具默认 20 条并截断字段：MCP 的返回值会进模型上下文，
 *     把平台返回的原始大对象（含几十个字段）原样塞进去会白白烧 token。
 *   - 每个工具都带 description：模型靠它决定何时调用，写清楚比写短重要。
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const BASE_URL = (process.env.LXSERVER_URL || 'http://127.0.0.1:9527').replace(/\/+$/, '')
const TOKEN = process.env.LXSERVER_TOKEN || ''

if (!TOKEN) {
  // 走 stderr 而不是 stdout：stdout 是 MCP 协议通道，往里写非协议内容会让客户端解析失败
  console.error('[lxserver-mcp] 缺少 LXSERVER_TOKEN 环境变量。请在 lxserver 的「设置 → 令牌」里生成一个。')
  process.exit(1)
}

/**
 * 统一的 HTTP 调用。
 *
 * 刻意不用 fetch 的自动 JSON 解析：部分端点（/api/music/search）返回**裸数组**，
 * 部分返回对象，还有歌词接口在「无歌词」时返回 500 + 纯文本。
 * 这里统一按文本读回再尝试解析，让每个工具自己决定怎么理解。
 */
async function call(path, { method = 'GET', body, query } = {}) {
  const url = new URL(BASE_URL + path)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
    }
  }

  const headers = { Authorization: `Bearer ${TOKEN}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let res
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(120_000), // 解析音源可能走回退链，给足时间
    })
  } catch (e) {
    throw new Error(`无法连接 lxserver（${BASE_URL}）：${e?.message || e}`)
  }

  const text = await res.text()

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `鉴权失败（HTTP ${res.status}）。请检查：① LXSERVER_TOKEN 是否正确；` +
        `② lxserver「设置 → 令牌」里的令牌认证是否已启用；③ 该令牌是否被停用或过期。`,
    )
  }

  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }

  if (!res.ok) {
    const detail = typeof data === 'string' ? data.slice(0, 300) : JSON.stringify(data).slice(0, 300)
    throw new Error(`lxserver 返回 HTTP ${res.status}：${detail}`)
  }
  return data
}

/** MCP 工具的返回值必须是「内容块」数组；这里统一走 JSON 文本块 */
function json(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

/**
 * 把歌曲对象裁成模型真正需要的字段。
 *
 * 平台返回的原始对象有几十个字段（各种 id、hash、url 模板…），
 * 全量塞进上下文既浪费又容易让模型抓错重点。这里只留「能用来搜索/播放/展示」的。
 */
function trimSong(s) {
  if (!s || typeof s !== 'object') return s
  return {
    name: s.name,
    singer: s.singer,
    albumName: s.albumName,
    source: s.source,
    songmid: s.songmid,
    interval: s.interval,
    ...(s.types ? { types: s.types } : {}),
  }
}

const TOOLS = [
  {
    name: 'search_music',
    description:
      '按关键词搜索歌曲/歌手/专辑/歌单。返回结果含 source 与 songmid，' +
      '这两个字段可直接传给 resolve_play_url 拿到播放直链。' +
      '平台：kw=酷我、wy=网易云、tx=QQ音乐、kg=酷狗、mg=咪咕。',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '搜索关键词，如「周杰伦 晴天」' },
        source: {
          type: 'string',
          enum: ['kw', 'wy', 'tx', 'kg', 'mg'],
          description: '平台，默认 kw（酷我）',
        },
        type: {
          type: 'string',
          enum: ['song', 'singer', 'album', 'playlist'],
          description: '搜索类型，默认 song',
        },
        page: { type: 'number', description: '页码，默认 1' },
        limit: { type: 'number', description: '返回条数上限，默认 20（最多 50）' },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'resolve_play_url',
    description:
      '把一首歌解析成可直接播放的音频直链（mp3/flac 等）。' +
      '需要 source 与 songmid —— 先用 search_music 拿到。' +
      '服务端会自动在多个候选音源间竞速并回退，所以可能比请求的音质低，' +
      '返回值里的 type 字段是**实得**音质（不是请求的）。',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: '平台，如 kw' },
        songmid: { type: 'string', description: '歌曲 ID' },
        name: { type: 'string', description: '歌名' },
        singer: { type: 'string', description: '歌手' },
        quality: {
          type: 'string',
          enum: ['128k', '192k', '320k', 'flac', 'flac24bit', 'hires'],
          description: '期望音质，默认 320k',
        },
      },
      required: ['source', 'songmid'],
    },
  },
  {
    name: 'get_lyric',
    description: '获取一首歌的歌词。需要 source 与 songmid。无歌词时返回空提示而非报错。',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string' },
        songmid: { type: 'string' },
        name: { type: 'string' },
        singer: { type: 'string' },
      },
      required: ['source', 'songmid'],
    },
  },
  {
    name: 'get_hot_search',
    description: '获取某平台的实时热搜关键词列表。想知道「现在流行什么」时用。',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: ['kw', 'wy', 'tx', 'kg', 'mg'], description: '默认 kw' },
      },
    },
  },
  {
    name: 'list_leaderboards',
    description: '列出某平台的所有排行榜（榜单名 + 榜单 id）。拿到 id 后用 get_leaderboard_songs 取曲目。',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: ['kw', 'wy', 'tx', 'kg', 'mg'], description: '默认 kw' },
      },
    },
  },
  {
    name: 'get_leaderboard_songs',
    description: '获取指定排行榜的曲目列表。榜 id 从 list_leaderboards 拿。',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: '默认 kw' },
        bangid: { type: 'string', description: '榜单 id，如 93' },
        page: { type: 'number', description: '页码，默认 1' },
        limit: { type: 'number', description: '返回条数上限，默认 20' },
      },
      required: ['bangid'],
    },
  },
  {
    name: 'list_playlists',
    description: '列出服务器上的歌单：内置的「试听列表」「我的收藏」，以及 LX 客户端同步过来的自建歌单。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_playlist_songs',
    description: '获取某个歌单的曲目。listId 从 list_playlists 拿（内置歌单的 id 是 default / love）。',
    inputSchema: {
      type: 'object',
      properties: {
        listId: { type: 'string', description: '歌单 id，如 default（试听列表）、love（我的收藏）' },
        limit: { type: 'number', description: '返回条数上限，默认 50' },
      },
      required: ['listId'],
    },
  },
  {
    name: 'get_play_history',
    description: '获取最近的播放历史（谁在什么时候听了什么）。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '返回条数上限，默认 30' },
      },
    },
  },
  {
    name: 'get_server_status',
    description:
      '获取服务器状态：版本、运行时长、内存/CPU、已载入音源数、WebDAV 是否配置。' +
      '排查「服务正常吗」时先看这个。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_local_music',
    description: '列出服务器音乐目录（挂载进容器的 /server/music）里的本地歌曲文件。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_users',
    description: '列出所有同步账号及其权限（是否管理员、是否启用自定义音乐目录等）。',
    inputSchema: { type: 'object', properties: {} },
  },
]

const server = new Server(
  { name: 'lxserver', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params

  switch (name) {
    case 'search_music': {
      const limit = Math.min(Number(args.limit) || 20, 50)
      const raw = await call('/api/music/search', {
        query: {
          name: args.keyword,
          source: args.source || 'kw',
          type: args.type || 'song',
          page: args.page || 1,
        },
      })
      const list = Array.isArray(raw) ? raw : (raw?.list ?? raw?.data ?? [])
      return json({
        总数: list.length,
        返回条数: Math.min(list.length, limit),
        结果: list.slice(0, limit).map(trimSong),
      })
    }

    case 'resolve_play_url': {
      const data = await call('/api/music/url', {
        method: 'POST',
        body: {
          songInfo: {
            source: args.source,
            songmid: args.songmid,
            name: args.name || '',
            singer: args.singer || '',
          },
          quality: args.quality || '320k',
        },
      })
      return json({
        直链: data?.url ?? null,
        实得音质: data?.type ?? null,
        ...(data?.error ? { 错误: data.error } : {}),
      })
    }

    case 'get_lyric': {
      try {
        const data = await call('/api/music/lyric', {
          query: {
            source: args.source,
            songmid: args.songmid,
            name: args.name || '',
            singer: args.singer || '',
          },
        })
        const lyric = typeof data === 'string' ? data : (data?.lyric ?? '')
        return json({ 有歌词: !!lyric, 歌词: lyric })
      } catch (e) {
        // 服务端在「该曲暂无歌词」时返回 500 + 纯文本，这是既有语义而非故障
        return json({ 有歌词: false, 说明: `该曲暂无歌词（${e.message}）` })
      }
    }

    case 'get_hot_search': {
      const data = await call('/api/music/hotSearch', { query: { source: args.source || 'kw' } })
      const list = data?.list ?? data ?? []
      return json({ 热搜: Array.isArray(list) ? list.slice(0, 50) : list })
    }

    case 'list_leaderboards': {
      const data = await call('/api/music/leaderboard/boards', { query: { source: args.source || 'kw' } })
      const list = data?.list ?? data ?? []
      return json({
        榜单: (Array.isArray(list) ? list : []).map((b) => ({ 名称: b?.name, id: b?.bangid ?? b?.id })),
      })
    }

    case 'get_leaderboard_songs': {
      const limit = Math.min(Number(args.limit) || 20, 100)
      const data = await call('/api/music/leaderboard/list', {
        query: { source: args.source || 'kw', bangid: args.bangid, page: args.page || 1 },
      })
      const list = data?.list ?? data?.songs ?? data ?? []
      return json({
        返回条数: Math.min(list.length, limit),
        曲目: list.slice(0, limit).map(trimSong),
      })
    }

    case 'list_playlists': {
      const data = await call('/api/user/list')
      return json(data)
    }

    case 'get_playlist_songs': {
      const limit = Math.min(Number(args.limit) || 50, 500)
      const data = await call('/api/user/list', { query: { listId: args.listId } })
      const list = Array.isArray(data) ? data : (data?.list ?? data?.songs ?? [])
      return json({
        返回条数: Math.min(list.length, limit),
        曲目: (Array.isArray(list) ? list : []).slice(0, limit).map(trimSong),
      })
    }

    case 'get_play_history': {
      const limit = Math.min(Number(args.limit) || 30, 200)
      const data = await call('/api/music/history/list')
      const list = Array.isArray(data) ? data : (data?.list ?? data?.history ?? [])
      return json({
        返回条数: Math.min(list.length, limit),
        历史: (Array.isArray(list) ? list : []).slice(0, limit).map((h) => ({
          歌名: h?.name,
          歌手: h?.singer,
          平台: h?.source,
          播放时间: h?.playedAt ? new Date(h.playedAt).toISOString() : undefined,
          次数: h?.playCount,
        })),
      })
    }

    case 'get_server_status': {
      const data = await call('/api/status')
      return json(data)
    }

    case 'list_local_music': {
      const data = await call('/api/music/custom/list')
      const list = Array.isArray(data) ? data : (data?.list ?? data?.files ?? [])
      return json({
        文件数: Array.isArray(list) ? list.length : 0,
        文件: Array.isArray(list) ? list.slice(0, 200) : list,
      })
    }

    case 'list_users': {
      const data = await call('/api/users')
      return json(data)
    }

    default:
      throw new Error(`未知工具：${name}`)
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
console.error(`[lxserver-mcp] 已启动，目标：${BASE_URL}`)
