# v2.49.5 交接：播放页移动端重做（2026-11-09）

> **状态：已部署并验收通过。**
> 镜像 `ghcr.io/335459215/lxserver:2.49.5`；
> NAS 容器已跑 `v2.49.5`（9528），compose 已切。
> 本地提交 `790233f` + tag `v2.49.5`。

---

## 一、需求原话

> 「播放页面没有适配移动端，需要优化。可以看 Plex 的音乐客户端，还有飞牛音乐客户端。」

## 二、改前的真实状态（截图实测，非猜测）

在 390×844 上真实播放一首歌后测量：

| 指标 | 改前 |
|---|---|
| 页面总高 | **1200px**（视口 862px）→ 必须滚动才看到歌词 |
| 封面 | 224px，**不居中**（黑胶右移 32~48px 顶出容器，被裁出黑色直角边） |
| 元信息胶囊 | **6 个**，折成 5 行（音源/音质/倍速/睡眠/时长/下载/分享） |
| 触摸目标 <44px | 8 个（返回 30、胶囊 24、下载/分享 24、Tab 36…） |
| 歌词区 | 固定 26rem(416px)，被挤到页面最下方 |

对照 Plex / 飞牛的设计：全屏播放器 = **一屏装下、封面是主角、歌词紧邻控制、低频操作收起**。

## 三、做了什么

### 1. 根因：不是「忘了写响应式」，而是**高度分配方式错了**

原来移动端只是把桌面两列**纵向堆起来**，所以必然溢出。改法有三层：

1. **根容器给确定高度**（这是关键，我在这儿反复栽了 3 次）：
   ```
   h-[calc(100dvh - --header-h - --mobile-tabbar-h - --safe-bottom - 2rem)]
   ```
2. **歌词区 `flex-1 min-h-[7rem]`** 吃掉剩余空间，而不是写死 42dvh / 26rem；
3. 封面 `w-[min(52vw,26vh,13.5rem)]` —— **把视口高度也纳入约束**，矮屏自动变小，
   这样「上方内容」会跟着变矮，flex 才能真的分配出空间给歌词。

> 走过的弯路（别再犯）：我先后用「固定 42dvh」「calc 减 21rem」「calc 减 26rem」
> 三次估算「上方内容有多高」，每次都错（实测是 473px ≈ 29.5rem，且会随封面/字号变化）。
> **任何依赖「上方内容固定高度」的算法都会失效**，必须让 CSS 自己用 flex 分配。

### 2. 封面与黑胶
- 黑胶唱片 `hidden sm:block` —— 窄屏不露出被裁切的黑色直角；
- 封面居中（`mx-auto` + section 加 `w-full min-w-0`，避免被文字列压扁成 72px）。

### 3. 低频操作收进「更多」
- 移动端元信息只留 **音源 + 音质**（用户最常看），其余收进「更多」底部抽屉：
  下载本曲 / 分享卡片 / 播放倍速 / 睡眠定时 / 时长，全部**整行 ≥48px**；
- 桌面端不变（`hidden sm:contents` 展开全部 6 个）。

### 4. 其他收紧
- 顶部把手改绝对定位居中（省一行高度）；返回按钮保留 30px 视觉但外围可点区够大；
- 标题移动端 `text-lg`；进度条与控制的 gap 从 4 收到 2.5；
- 胶囊行 `mt-3 → mt-2`、gap `2 → 1.5`。

## 四、验证（本地 5 种 + 线上 3 种尺寸，均真实播放）

| 视口 | 改前溢出 | 改后溢出 | 封面 | 歌词区 |
|---|---|---|---|---|
| 390×844 | +330px | **+1px** | 201px 居中 | 133px（3~4 行） |
| 430×932 | — | **+1px** | 214px | 208px |
| 375×667 | +183px | **+1px** | 171px | 64px（2~3 行） |
| 360×640 | — | **+1px** | 164px | 64px |
| 1440×900 | +55px（原有） | +55px | 254px | 616px |

- 横向溢出全部 **0**
- 胶囊数：移动 1~3 个（音源/音质/更多），桌面 4 个
- 线上 2.49.5 实测与本地一致
- `check-overflow.py` **182/182**、`check-mobile-ux.py` **0 处问题**
- 单测 **378/378**

> 桌面端那 +55px 是**改动前就有**的（`/now-playing` 桌面版本来就略高于视口），
> 本轮没动桌面布局，未引入新问题。

## 五、顺手修掉一个会随机炸构建的真 bug（重要）

**Dockerfile.local 的 Alpine 仓库版本混用**：

```dockerfile
# 原来
RUN sed -i 's|dl-cdn.alpinelinux.org|mirrors.aliyun.com|g' /etc/apk/repositories \
 && echo "https://mirrors.aliyun.com/alpine/latest-stable/community" >> /etc/apk/repositories
```

基础镜像 `FROM alpine` 是 **v3.24**，但 community 被硬编码成 **latest-stable**。
一旦 latest-stable 滚动到 v3.25，两套索引对不上，表现为：

- `g++ / make / py3-pip: no such package`
- 或 `ffmpeg 缺 libX11.so.6`

报错看着像网络抖动/依赖缺失，**实际是版本混用** —— 这也解释了为什么同一个
Dockerfile 时好时坏（v2.49.4 就因此失败过一次，当时误判为「镜像源抖动」）。

**修法**：读基础镜像自己的 `/etc/alpine-release` 拼同版本 community，并显式 `apk update`：

```dockerfile
RUN set -eux; \
    ver="$(cat /etc/alpine-release | cut -d. -f1,2)"; \
    sed -i 's|dl-cdn.alpinelinux.org|mirrors.aliyun.com|g' /etc/apk/repositories; \
    grep -q "/v${ver}/community" /etc/apk/repositories \
      || echo "https://mirrors.aliyun.com/alpine/v${ver}/community" >> /etc/apk/repositories; \
    cat /etc/apk/repositories; apk update
```

先在 NAS 上单独跑基础层验证（PROBE_OK，45 个包正常装完），再跑完整构建，通过。

## 六、测试脚本同步

`verify-mobile-nav.py` 原来断言「更多」Tab 存在（5 项）。v2.49.3 已按用户要求删除，
脚本随之过期。改为断言 **4 项 + 「更多」确实不存在**（防止回归时被加回来）。

结果 30/31，唯一 FAIL 仍是那条**已知脚本假设**：
Headless 下滚动条宽度为 0，`right=390` 断言不成立 —— 与产品无关。

## 七、回滚

```bash
sed -i 's|lxserver:2.49.5|lxserver:2.49.4|' /volume1/docker/lxserver/compose.yaml
cd /volume1/docker/lxserver && /usr/local/bin/docker compose -p lxserver up -d
```

⚠️ 回滚会让移动端播放页退回「1200px 需滚动 + 6 个胶囊折 5 行」的状态。

## 八、已知边界

1. **375×667 / 360×640 这类矮屏，歌词区只剩 64px（2~3 行）**。
   这是「一屏不滚动」的必然代价：封面已缩到 164~171px，再压缩就失去「大封面」的意义。
   若觉得歌词太小，可以让矮屏改为**允许滚动**（把根容器 `h-` 换成 `min-h-`），
   两者不可兼得 —— 目前选的是「不滚动」。
2. 桌面端 `/now-playing` 原有 +55px 溢出未处理（本轮范围外，且不影响使用）。
3. 播放页仍未做「封面旋转/歌词全屏」等 Plex 的进阶形态，本轮只解决适配问题。

## 九、待办

- 推送：`git push origin main && git push origin v2.49.5`
