# lxserver MCP 服务器

让 AI agent（Claude Desktop / Cursor / 任何 MCP 客户端）用**访问令牌**控制 lxserver：
搜索歌曲、看榜单与热搜、解析播放直链、读歌单与收藏、查播放历史、看服务器状态。

## 为什么用令牌而不是账号密码

与 Emby / Jellyfin 同一个思路：

| 场景 | 凭据 |
|---|---|
| 网页登录 | 账号 + 密码（登录后换取会话 token） |
| 外部工具（MCP / 脚本 / 第三方客户端） | 「设置 → 令牌」里生成的**长期令牌** |

令牌可命名、可单独吊销、可设有效期，服务端日志里能看出是哪个令牌在用。
把账号密码写进 AI 工具的配置文件里显然不合适 —— 那是全权限、无法单独吊销的凭据。

## 安装

```bash
cd mcp
npm install
```

## 配置

先到 lxserver 的 **设置 → 令牌** 页面：
1. 打开「启用令牌认证」总开关；
2. 点「生成令牌」，起个名字（如 `MCP 服务器`），复制生成的令牌。

然后在 MCP 客户端的配置里填两个环境变量：

```json
{
  "mcpServers": {
    "lxserver": {
      "command": "node",
      "args": ["G:/project/lxmusic/lxserver-src/mcp/index.js"],
      "env": {
        "LXSERVER_URL": "http://192.168.1.28:9528",
        "LXSERVER_TOKEN": "lx_tk_在此粘贴你的令牌"
      }
    }
  }
}
```

| 变量 | 必填 | 说明 |
|---|---|---|
| `LXSERVER_URL` | 否 | 服务器地址，默认 `http://127.0.0.1:9527` |
| `LXSERVER_TOKEN` | **是** | 设置 → 令牌里生成的令牌 |

## 提供的工具

| 工具 | 作用 |
|---|---|
| `search_music` | 按关键词搜索歌曲/歌手/专辑/歌单（五平台） |
| `resolve_play_url` | 把 `source` + `songmid` 解析成可播放的音频直链 |
| `get_lyric` | 取歌词 |
| `get_hot_search` | 某平台的实时热搜 |
| `list_leaderboards` | 列出某平台的所有排行榜 |
| `get_leaderboard_songs` | 取指定榜单的曲目 |
| `list_playlists` | 列出服务器上的歌单（内置 + 同步来的自建歌单） |
| `get_playlist_songs` | 取某个歌单的曲目 |
| `get_play_history` | 最近的播放历史 |
| `get_server_status` | 版本、运行时长、内存/CPU、音源数 |
| `list_local_music` | 服务器音乐目录里的本地文件 |
| `list_users` | 所有同步账号及其权限 |

典型用法是「搜索 → 解析」两步：`search_music` 拿到的每条结果都带 `source` 与 `songmid`，
直接传给 `resolve_play_url` 就能得到播放直链。

## 设计取舍

- **只读为主**：暴露的都是查询能力。写操作（改配置、删用户、清数据）刻意不暴露 ——
  让 AI 改服务端配置的风险远大于收益，需要时让人自己去界面点。
- **字段裁剪**：平台返回的原始歌曲对象有几十个字段（各种 id、hash、url 模板…），
  全量塞进模型上下文既浪费又容易让模型抓错重点。工具只返回
  `name / singer / albumName / source / songmid / interval`。
- **错误可读**：鉴权失败会明确提示去检查哪三件事；上游无音源时如实转达服务端的
  「未找到支持 X 平台的自定义源」，而不是包装成一个含糊的失败。

## 测试

不需要 MCP 客户端即可验证整条协议链路：

```bash
node test-smoke.mjs http://127.0.0.1:9527 <你的令牌>
```

它会用 SDK 的 Client + StdioClientTransport 把 `index.js` 当子进程拉起来，
走完整的 JSON-RPC 握手 → listTools → callTool 流程，共 31 项断言。
