# v2.46 交接：HTTPS 混合内容全量修复 + 镜像改本地构建（2026-11-05）

> **状态：已上线。** 代码 `main` = `4c1d399`；镜像 `ghcr.io/335459215/lxserver:2.46.1`
> （**仅存在于 NAS 本地**，GHCR 上只到 2.46.0 —— 见文末「发布方式变更」）；
> NAS 容器已跑 `v2.46.1`（9528），仍由群晖 Container Manager 的 Compose 项目部署
> （项目目录 `/volume1/docker/lxserver`）。
> **验收**：桌面 15/15 + 安卓 PWA 13/13，截图见 `docs/v2461-deploy/`。

---

## 一、用户报的症状

> 安卓 Chrome 把网页「添加到桌面」当 PWA 用。登录进去时顶部不显示不安全；
> **一点歌播放，就显示不安全链接。**

## 二、根因：Mixed Content（混合内容）

页面本体是 HTTPS（证书与反代都没问题 —— v2.43.0 修封面时已确认过），
但各音源解析出的**播放直链是明文 `http://`**，前端把它直接塞进 `<audio src>`，
HTTPS 页面里就成了混合内容。登录页只有本站资源所以没事，一点歌就触发。

实测（2026-11-04，用线上账号逐首解析）实际会遇到的 15 个 CDN 主机：

| 音源 | 主机 | 原 scheme |
|---|---|---|
| wy 网易云 | `m701` / `m801` / `m8.music.126.net` | http |
| tx / mg / kg / kw | `car-er` / `kw-er` / `kw-bj` / `kw-lv` / `bd-er` / `bd-lv` / `bd-lw.kuwo.cn` | http |
| kg 酷狗 | `fsandroid.tx.kugou.com`、`fs.youthandroid2.kugou.com` | http |
| mg 咪咕 | `freetyst.nf.migu.cn` | http（部分 https） |
| 自定义源 | `music.haitangw.cc`、`api.liuyunidc.cn`、`yy.zddyr.top` | https |

**关键结论：这 15 个主机全部同时支持 https** —— 同一 path 只换 scheme，
返回 200 且 `Content-Type` 与字节数完全一致。所以不需要任何服务端代理。

## 三、修复（只做「客户端升级」，不做服务端代理）

用户明确否决了服务端代理方案（理由：音频全量过 NAS 上行，外网远程听会吃掉上传带宽）。

### 1. 新增 `web/src/lib/audioUrl.ts`

`secureAudioUrl(url)`：把**已实测支持 https** 的 CDN 主机升级成 https，其余**原样返回**。

白名单 `HTTPS_AUDIO_HOSTS`：`music.126.net`、`kuwo.cn`、`kugou.com`、
`music.163.com`、`migu.cn`、`gtimg.cn`、`y.qq.com`、`haitangw.cc`、
`liuyunidc.cn`、`zddyr.top`。

与 `coverUrl.ts` 同一套路、刻意分成两个模块：音频主机域比图片多得多、变更也更频繁，
分开改不会连带影响封面缓存键的语义。

> **为什么保留「未知主机原样返回」**：乱升级会把只支持 http 的主机弄成**不能播**，
> 那比一条地址栏提示更糟。宁可按已知清单精确升级。

### 2. 接入播放链路（`web/src/lib/player.tsx`）

三处统一走 `secureAudioUrl()`：在线解析结果 `el.src`、本地音乐 `song.url`、
缓存下载 URL（服务端代理不区分 scheme，但统一后日志/排查少绕一圈）。

### 3. 顺带修掉三处裸封面地址

v2.43.0 的封面护栏有遗漏 —— 这三个列表直接用了裸字段，绕过了 `coverUrl()`：

| 文件 | 原写法 | 改成 |
|---|---|---|
| `pages/Dashboard.tsx`（今日热播列表） | `song.img` | `coverUrl(song)` |
| `pages/player/SearchPage.tsx`（歌手网格） | `s.picUrl` | `secureImageUrl(s.picUrl)` |
| `pages/player/ArtistPage.tsx`（专辑网格） | `a.img` | `secureImageUrl(a.img)` |

这三处是酷我 `img1.kuwo.cn`、酷狗 `imge.kugou.com` 的明文封面反复刷
mixed-content 警告的来源。改完整个前端不再有任何裸 `http` 图片地址。

### 4. 测试

新增 `test/audioHttps.test.ts`（9 条）：已知主机升级、大写主机名归一、
已是 https 不动、未知域名原样、相对/data:/blob: 原样、空值返回 undefined、
畸形 URL 不抛异常。**全量单测 302/302。**

---

## 四、验收证据（不看代码，看浏览器实际行为）

### 桌面（15/15）
- 服务端下发的前端 bundle 已是新构建（`index-B-xSLQei.js`）
- `<audio>.src` = `https://car-er.kuwo.cn/...flac`（服务端给的是 http，前端升级）
- `paused=false`、`error=null`、进度 10.66/269.75 → 真的在播
- 播放期间外网 `http://` 请求 **0 个**
- 控制台 mixed-content 警告 **0 条**
- 首页四区块回归正常（v2.45.0 的按特性刷新没被影响）

### 安卓 PWA（13/13，412×915 + Android UA + 触摸）
- `isSecureContext === true`
- `manifest.webmanifest` 200，`name = lxserver 音乐`
- 移动端播放地址 https、真的在播
- **`performance.getEntriesByType('resource')` 共 151 条，其中 `http://` 0 条**
  （这比 request 事件更硬：媒体管道发起的请求也会进 resource timing）
- 控制台 mixed-content 警告 0 条

---

## 五、发布方式变更（重要）

**用户要求：关掉远程 CI 编译镜像，以后一律在 NAS 本地构建。**

`.github/workflows/build-image-ghcr.yml` 的 `on.push` 段已删除，只保留
`workflow_dispatch` 作为应急兜底。验证：改动后 3 次 push **没有再触发任何 CI 运行**。
（`electron-build.yml` / `release.yml` 仍只在打 tag 时触发，与本次无关。）

### 本地构建流程（已跑通，有缓存约 2–3 分钟）

```bash
# 1. 本地打包（只含 git 已提交内容）
git archive --format=tar.gz -o src.tar.gz HEAD

# 2. 上传 —— 必须走 SSH stdin，DSM 的 SFTP 子系统被禁用，
#    scp 会卡在密码交互提示上
#    （脚本见 .playwright/_nas_upload_src246.py）

# 3. NAS 上解压 + 构建
cd /volume1/docker/lxbuild/src246
/usr/local/bin/docker build --network=host \
  -t ghcr.io/335459215/lxserver:<版本> -f Dockerfile.local .

# 4. 改 compose 的 image tag → DSM Container Manager → 项目 lxserver
#    → 详情 → 停止 → 操作 → 构建（运行中「构建」是灰禁用的）
```

`Dockerfile.local` = 阿里云 apk 镜像 + npmmirror。**绝不能传 `--build-arg HTTPS_PROXY`**
（代理拉 alpine CDN 会假死，实测 40 分钟走到 apk 第 17 步）。

### 版本号规则（这次踩到了）

版本号唯一来源是仓库根 **`version` 文件**（`vX.Y.Z`），**不是 `package.json`**。
CI 的 prepare job 会取 `max(version 文件, GHCR 已发布最高版, git tag)`，
被占用就自动 +patch。所以只改 `package.json` 不会涨版本。
CI 关掉后这个自动 bump 只在手动触发时生效，**本地构建要自己保证 tag 唯一**。

---

## 六、已知限制

1. **白名单只覆盖已验证主机。** 某个自定义源将来若返回只给 http 的新主机，
   那条地址会保持 http，浏览器自动升级失败时仍会提示。
   处理方式：实测该主机 https 是否可用，可用就加进 `HTTPS_AUDIO_HOSTS`。
2. **GHCR 上停在 2.46.0**（不含封面修复）。需要给外部用户发镜像时，
   到 Actions 页面手动 Run workflow。
3. 播放缓存里已存的旧 blob 不受影响（blob 不走网络，本来就没混合内容问题）。

---

## 七、改动的文件

```
web/src/lib/audioUrl.ts              新增
web/src/lib/player.tsx               3 处接入
web/src/pages/Dashboard.tsx          封面归一化
web/src/pages/player/SearchPage.tsx  封面归一化
web/src/pages/player/ArtistPage.tsx  封面归一化
test/audioHttps.test.ts              新增（9 条）
.github/workflows/build-image-ghcr.yml  关闭 push 触发
version / package.json               2.46.1
```

