# v2.49.3 交接：首页/列表页精简 + 音源页改造 + 同名源按版本去重 + 音源可用性审计

> **状态：已部署并验收通过，未推送 GitHub。**
> 镜像 `ghcr.io/335459215/lxserver:2.49.3`（`16353f610c2f…`）；
> NAS 容器已跑 `v2.49.3`（9528），compose 已切。
> 本地提交 `4971aac` + tag `v2.49.3`。

---

## 一、本轮用户的 6 条需求与落点

| # | 需求 | 改动 |
|---|---|---|
| 1 | 首页删掉飙升榜与「权威聚合排行榜」 | `Dashboard.tsx` 删两段 section（约 9.1KB）+ 连带删掉背后的取数/时间戳/visibilitychange 强刷 |
| 2 | 首页 4 个大选项变小、排一行 | `QuickTile` 移动端 91px 高 → 67px；容器 `grid-cols-2 lg:grid-cols-4` → 全断点 `grid-cols-4`；副标题小屏隐藏 |
| 3 | 歌单页每个歌单别太大 | `PlaylistCard` 封面 56→40px、`p-3`→`p-2`、标题 `text-sm`→`13px`、卡片高 73→58px |
| 4 | 「喜欢」歌单页：封面/三个按钮/间距都缩小 | 封面 128/176 → 96/112px；三个主按钮 `size=lg`→`sm` + `rounded-full`→`rounded-md`；外壳 `p-6 md:p-8`→`p-4 md:p-5`；外层 gap 24→16px；信息区 `mt-4`→`mt-3` |
| 5 | 排行榜「播放全部」变小 + 改样式 | 方块 outline → **实心主色胶囊**（`h-7 rounded-full bg-accent text-[11px]`），84×28 |
| 6 | 底部导航删掉「更多」 | `MobileTabBar.tsx` 删按钮 + 整个抽屉 + `MORE_NAV` 常量 + `more` state，Tab 从 5 → 4 项 |
| 7 | 音源页：检测/导入源按钮变小，加全部启用/全部关闭 | 四个按钮统一 `h-7 rounded-md text-[11px]`；新增 `toggleAll()`（复用逐条 toggle 并发 + 乐观更新 + 失败回滚） |
| 8 | VM 安全框改单行开关，去掉保存按钮，开关即存 | `ScriptSafetySection` 从「卡片+标题+说明段+开关+保存」压成**一行**；`handleToggle` 改完就地 `submit()` |
| 9 | 同名源去重按版本，新版本覆盖 | `customSourceDedupe.isNewerVersion()` + `DuplicateHit.action`；handler 走覆盖分支，**保留原 enabled/uploadTime** |

## 二、同名源按版本去重（行为变化，需要知道）

原来的语义是「同名 → 一律跳过」。现在：

| 场景 | 结果 |
|---|---|
| 同名 + 待导入版本**更新** | **覆盖**旧脚本与元数据（`code: OVERWRITTEN`） |
| 同名 + 版本相同 / 更旧 | 跳过（绝不降级） |
| 同名 + 任一侧版本无法解析 | 跳过（保守，避免反复覆盖） |
| 内容哈希相同（不同文件名同一份脚本） | 跳过（与版本无关） |
| 同链接 + 版本更新 | 覆盖 |
| 同链接 + 版本不新 | 跳过 |

版本解析规则：去前导 `v/V` → 取开头数字段按 `.` 切 → 逐段数值比较、缺位补 0。
能处理 `v9.3 93特供版 DeepSeek优化`、`v260925`、`3`、`1.7.17` 这些真实形态。
**覆盖时保留用户的 `enabled` 与 `uploadTime`** —— 换个版本不该把源自动关掉。

单测 7 条钉住（`test/customSourceBatch.test.ts`）：
常规比较、带 v 前缀与非 semver 后缀、无法比较时保守 false、
同名新版本 overwrite / 同版本 skip / 旧版本 skip、内容相同优先 skip、同链接覆盖。

## 三、音源「不可用」审计（详见 `docs/v2493-ui/SOURCE-AUDIT.md`）

**19 个源：12 可用 / 7 真不可用。其中 1 个是我们的 bug。**

### 我们修掉的 3 个真问题

1. **沙箱 `console` 缺标准方法**（`userApi.ts`）
   `lx-animemusic` 初始化里调 `console.groupEnd()` → `TypeError` → 整个源加载失败。
   补齐 `trace/dir/table/group/groupCollapsed/groupEnd/timeLog/count/countReset/assert/clear`，
   全部不抛异常。**修复前该源不可用，修复后 2.0s 可用。**

2. **检测盲取首个平台**（`customSourceHandlers.handleProbe`）
   `supportedSources[0]` 的顺序来自脚本 `Object.keys()`，与「服务端能不能搜」无关。
   改为从「该源实际注册的平台」里挑第一个可搜的；一个都没有则返回
   `unprobeable: true`，UI 用**灰色「无法检测」**而不是红色「不可用」。

3. **初始化超时文案甩锅用户**（`userApi.ts`）
   `聚合API接口 (CF)` 上游 429 → 我们原来提示「请确保脚本调用了 lx.send」。
   改为列出三类真实原因，并附上抓到的脚本错误。

### 顺手修的两个显示问题
- 版本号 `vv3.2.15`（`@version` 自带 v，模板又加一个）→ 渲染前剥前缀
- 390px 下源名被两个徽章挤成「独…」「墨…」→ 徽章下移第二行，源名独占首行

### 7 个真不可用的原因（都不是我们解析失败）
- 野花🌷 / 野草🌾：`*.tempmusics.tk` **DNS NXDOMAIN**（域名注销）
- HYWmusic_beta_公益测试：源自报「卡密已过期」
- 长青SVIP(二改) / 屿溪-终章 / 安妮独家音源：源自报「当前版本已停止服务」（作者远程停服）
- 聚合API接口 (CF)：上游 `api.music.lerd.dpdns.org` **HTTP 429**

> **易错点记录**：probe 返回 `success: true` 只代表「这次检测请求成功」，
> 不代表源可用；可用性看 `ok`。我第一次审计就因为看 `success` 得出「19 个全可用」的错误结论。

## 四、验证数据

- 单测 **368/368**（含新增 7 条版本去重 + 6 条超时）
- `check-overflow.py`：**182/182，0 处问题**
- `check-mobile-ux.py`：**0 处可用性问题**
- 线上 probe：12 可用 / 7 不可用，与修复前对比 `lx-animemusic` 由 FAIL → OK
- UI 实测（390×844）：4 磁贴一行（84×67，docH 1541 无变化）、Tab 4 项无「更多」、
  源页四按钮 44px 触摸高、VM 开关行 71px、版本号无 `vv`
- 截图：`docs/v2493-ui/{home,playlist,favorites,sources}-*.png`

## 五、部署过程记录（重要）

**DSM Container Manager 的「停止」再次失败**（等待超时，容器仍 Up → 「构建」按钮禁用）。
连续两个版本都这样，已改走 SSH：

```bash
/usr/local/bin/docker stop lxserver
cd /volume1/docker/lxserver && /usr/local/bin/docker compose -p lxserver up -d
```

容器带 `com.docker.compose.project=lxserver` 标签，`up -d` 会按 compose.yaml 里
新的 `image:` 重建，与 DSM「构建」等价。**下次部署直接用这条路，别先试 UI。**

本轮因需要多次重建（每次改完要生效），共构建 4 次镜像。
清理后保留 `2.49.3` + `2.49.2` 两个镜像与 `src2493` 源码包。

## 六、回滚

```bash
sed -i 's|lxserver:2.49.3|lxserver:2.49.2|' /volume1/docker/lxserver/compose.yaml
cd /volume1/docker/lxserver && /usr/local/bin/docker compose -p lxserver up -d
```

⚠️ 回滚到 2.49.2 会丢掉：首页精简、音源页改造、按版本去重、console 修复。
其中 **console 修复**会让 `lx-animemusic` 重新变回不可用。

## 七、待办

- **播放卡顿 / 预加载缓存** — 用户已提出，本轮未做。需要独立一轮：
  涉及播放器内核（`web/src/lib/player.tsx`）、流式代理、缓存目录与清理策略，
  风险与工作量都远大于本轮 UI 调整。建议下一轮单独立项，先做
  「预取下一首 URL + 服务端磁盘缓存热歌」的最小闭环。
- **推送 GitHub**：`git push origin main && git push origin v2.49.3`
