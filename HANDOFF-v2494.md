# v2.49.4 交接：播放预加载（2026-11-09）

> **状态：已部署并验收通过。**
> 镜像 `ghcr.io/335459215/lxserver:2.49.4`（`ab4c4393eefb…`）；
> NAS 容器已跑 `v2.49.4`（9528），compose 已切。
> 本地提交 `v2.49.4` tag；`v2.49.1/2/3` 已推送 GitHub。

---

## 一、需求原话

> 「还有，播放的时候有时候会卡顿，这个你要做缓存，不能一直靠实时网速播放，
> 不然肯定会卡顿。要做提前加载。」

## 二、诊断：缓存一直有，但**从来没有「提前」**

项目里本来就有播放缓存（`web/src/lib/audioCache.ts`，v2.39.0），
但它有两个「事后」特征，导致对卡顿基本无效：

| 现状 | 后果 |
|---|---|
| 当前曲要**播满 15 秒**才开始后台下载整曲 | 等下完歌已经放完了 → 缓存只对「重播」有用 |
| **下一首**直到切歌那一刻才解析 URL | 每次切歌都是「实时解析 → 边下边播」 |
| `<audio preload="metadata">` | 浏览器缓冲极度保守，网络一抖就 `waiting` |

即：**首次听一首歌，全程 100% 受实时网速支配** —— 正是用户说的现象。

## 三、做法

### 1. 新增 `web/src/lib/prefetch.ts`（纯决策，可单测）

只做判断、不碰网络，把容易改错的规则钉死在单测里：

- `nextSongForPrefetch(queue, index, {shuffle, repeat})` —— 下一首是谁
- `shouldPrefetch(env)` —— 现在该不该抓
- `hasEnoughTimeLeft(duration, position, safety)` —— 还来不来得及
- `PREFETCH_START_DELAY_MS = 8000`

### 2. `player.tsx` 接入 `prefetchNext()`

`onPlay` 后起 8 秒定时器 → 解析下一首 URL → 整曲抓进 IndexedDB 播放缓存。
切歌时 `loadAndPlay` 命中缓存 → `blob:` 直接播，**零解析零下载**。

### 3. 五条硬护栏（每条都有单测）

| 护栏 | 原因 |
|---|---|
| 随机播放不预取 | `advance()` 用 `Math.random()`，预取大概率抓错歌，白耗流量还挤掉有用缓存 |
| 单曲循环不预取 | 下一首还是自己，已缓存过 |
| 省流 / 2G / 3G 不预取 | 带宽本来就紧，分一半会让**当前曲更卡**，与目的相反 |
| 同一时刻只跑一个 | 并发两首均分带宽，谁都下不完，切歌时一首都没命中 |
| 剩余时长 < 20s 不启动 | 下到一半就切歌，纯浪费 |

另外继承 `scheduleCacheWrite` 的**替身护栏**：解析命中跨平台替身（`resolvedKey ≠ key`）时
绝不写入本歌的键，避免把别人的录音永久固化进缓存。

### 4. 顺手：`preload="metadata"` → `"auto"`

浏览器主动多缓冲一段，吸收小抖动；只在主动播放时发生，流量代价有限。
设置页「播放缓存」的描述也同步说明它现在承担提前加载。

## 四、验证

### 单测 378/378（新增 `test/prefetch.test.ts` 10 条）
覆盖：顺序取下一首、末尾列表循环/不循环、随机与单曲循环不预测、空队列/越界、
正常放行、关缓存、省流/2G/3G、离线/忙碌/单曲队列、剩余时长边界。

### 端到端（本地 + 线上各跑一遍，都是真实播放）

本地用注入的桩音频（60s 静音 WAV，够长不会被自动切歌）：

```
t=0.1s  /api/music/url      晴天                     ← 解析当前曲
t=8.1s  /api/music/url      晴天 (原唱 周杰伦)        ← 预取触发（第 8 秒）
t=8.1s  /api/music/download …fake.wav                 ← 下载下一首
缓存写入 audio|wy:2668397359|320k
切歌后：/api/music/* 请求 = 0，src = blob:…，界面显示「播放缓存」
```

线上（NAS 2.49.4，真实音源）：

```
t=0.1s   music/url                                        ← 当前曲（晴天，270s）
t=8.12s  music/url                                        ← 预取下一首
t=8.16s  music/download?url=https://m801.music.126.net/…   ← 真实下载
t=12s    缓存条目 = 1
切歌后：音频相关请求 0（只有 lyric 与 history/report 两个非音频请求），src = blob:…
```

### 回归
- `check-overflow.py`：**182/182，0 处问题**
- `check-mobile-ux.py`：**0 处可用性问题**
- 容器 `v2.49.4`，health 200

## 五、构建踩坑（值得记住）

第一次 `docker build` 挂在 `apk add chromaprint`：

```
WARNING: fetching https://mirrors.aliyun.com/alpine/v3.24/main/x86_64/APKINDEX.tar.gz: Operation timed out
ERROR: unable to select packages:
  so:libX11.so.6 (no such package): required by: ffmpeg-libavutil-8.1.3-r0
```

**不是代码问题**，是阿里云 Alpine 镜像的 APKINDEX 拉取超时 → 依赖索引不完整。
验证：NAS 上 `curl` 该 index 200/0.27s → 直接重试即成功。
Dockerfile 里 `(apk add chromaprint || true)` 的 `|| true` 没能兜住，
说明这一层失败发生在更早的 `apk add --update` 依赖求解阶段（会因索引不全连主包一起解不出）。

**下次遇到同类报错先测镜像源，别改 Dockerfile。**

## 六、回滚

```bash
sed -i 's|lxserver:2.49.4|lxserver:2.49.3|' /volume1/docker/lxserver/compose.yaml
cd /volume1/docker/lxserver && /usr/local/bin/docker compose -p lxserver up -d
```

## 七、已知边界（没有假装解决）

1. **首次听一首从未缓存过的歌，仍然边下边播。** 彻底消除需要 MSE 分片缓冲或
   服务端磁盘缓存，属于播放器内核级改造，本轮没做（风险远大于收益）。
   本轮解决的是「切歌」和「重播」这两类最常见的卡顿。
2. **随机播放不预取** —— 技术上可以预取「队列里随机 2~3 首」，但会成倍放大流量，
   等确认用户主要听歌模式后再决定。
3. 预取只抓**当前档位**（`resolvedQuality`）。用户中途换更高音质档位时仍需现下。
4. 「预取字节数」没有单独统计入口；可在设置页用缓存占用间接观察。

## 八、待办

- 推送：`git push origin main && git push origin v2.49.4`
- 若用户仍反馈「第一次听就卡」，下一轮做服务端热歌磁盘缓存（可控、无需动播放器）。
