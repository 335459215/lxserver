# v2.49.2 交接：链接导入加绝对超时（2026-11-08）

> **状态：已部署并验收通过，未推送 GitHub。**
> 镜像 `ghcr.io/335459215/lxserver:2.49.2`（`caf34d583f6a…`）；
> NAS 容器已跑 `v2.49.2`（9528），compose 已切到 `2.49.2`。
> 本地提交 `dcd9d20` + tag `v2.49.2`。

---

## 一、用户需求（原话）

> 「你要加超时，不能一直让它等着。像这种链接式的，多少秒之内还不解析出来，
> 就直接显示超时，而不是一直卡着。」

## 二、根因：原来的超时是假的

`customSourceFetch.ts` 原来只有一行：

```ts
req.setTimeout(plan.timeoutMs, () => { req.destroy(...) })
```

Node 的 `req.setTimeout` **只在 socket 分配之后**才开始计时，于是：

| 场景 | 旧行为 |
|---|---|
| DNS 解析卡住（`EAI_AGAIN`/无响应 DNS） | 计时器根本没启动 → **永不超时** |
| 连接后每 20 秒内有 1 字节活动 | 计时器**被反复重置** → 可以等无限久 |
| 多次 302 重定向 | 每跳各有一个 20s → 10 跳 = 200s |
| 脚本 VM 初始化（`lx.send('inited')` 永不返回） | 外层**没有任何截止时间** |
| 批量 50 条串行 | 无总预算 → 最坏 20 分钟 |

实测证据：NAS 容器抓 `raw.githubusercontent.com` 时，
一次 UI 点击等了 **48 秒**才返回、另一次 **34 秒**返回 `read ETIMEDOUT`，
期间界面一直「导入中…」。

## 三、修法：两层绝对截止 + 三块预算

### 1. `customSourceFetch.ts` — 真超时

- 计时器在 `mod.get()` **之前**挂上，覆盖 DNS + TCP + TLS + 首字节 + 读完 body；
- `setTimeout(deadline - now)` 到点直接 `req.destroy()`，与 socket 是否建立无关；
- `fetchSourceScript` 进入第一跳前算好**整次抓取的 deadline**，逐跳只传剩余预算 ——
  重定向再多也不累加。

### 2. 三块预算常量（`customSourceUrl.ts`）

| 常量 | 值 | 含义 |
|---|---|---|
| `SOURCE_FETCH_TIMEOUT_MS` | 20s | 单次抓取（含所有重定向） |
| `SOURCE_IMPORT_ITEM_TIMEOUT_MS` | 25s | 单条端到端（抓取 + 代理 agent + VM 试运行） |
| `SOURCE_BATCH_TOTAL_TIMEOUT_MS` | 90s | 整批总预算 |

新增 `withTimeout(promise, ms, msg)`：给任意 Promise 套硬截止，
用于 VM 初始化这类「内部超时未必覆盖」的环节。

### 3. `customSourceHandlers.ts` — 每处都兜住

- 单条导入（`handleImport`）：抓取 + VM 试运行整段在 25s 内；
- 批量导入：每条 `min(25s, 整批剩余)`，整批到 90s 后**剩余条目直接标记 `BATCH_TIMEOUT`**，已完成的照常返回；
- 单条预算被整批压缩时，文案改为
  「整批已接近 90 秒上限，本条只剩 N 秒」，不再出现与「单条 25 秒」矛盾的秒数。

### 4. 前端可感知（`SourcesGroup.tsx`）

- 按钮显示 `导入中… 12s`（每秒推进）；
- 状态行：`正在抓取并解析脚本…已等待 12 秒（单条最多 25 秒，整批最多 90 秒）`；
- 超过 25s 改为「仍在等待服务端返回…达到 90 秒会自动中止」；
- 前端另有 `AbortController` 兜底 90s，**服务端不返回也不会让浏览器一直挂**；
- `role="status" aria-live="polite"`，读屏能听到进度。

## 四、验证

### 单测（361/361）

新增 6 条，钉住：
- `withTimeout` 对「永不 resolve 的 Promise」必定在预算内 reject（实测 66ms / 60ms 预算）；
- 内部先完成时正常返回；
- 内部错误**透传**，不被伪装成超时；
- 自定义超时文案生效；
- 常量关系：单条 < 整批，且等于 25s / 90s；
- `describeTimeout` / `describeFetchError` 都能把 `read ETIMEDOUT`、`connect ETIMEDOUT`、
  `TIMEOUT:` 三种写法识别为「超时」。

### 挂起场景实测（本地，用真黑洞服务）

用 Node 起一个「接受 TCP 但永不写字节」的服务模拟卡死：

| 用例 | 预期 | 实测 |
|---|---|---|
| 单条挂起 | 20s 切断 | **20.0s**，`TIMEOUT: 抓取超时（超过 20 秒没有完成）` |
| 5 条挂起（串行） | 90s 封顶 | **90.0s**，前 4 条各 20s，第 5 条提示「整批已接近 90 秒上限，本条只剩 10 秒」 |
| 黑洞 IP `10.255.255.1` | 快速失败 | 2.1s `ECONNREFUSED` |
| 不存在域名 | 快速失败 | 0s `ENOTFOUND` |

### 线上实测（NAS 2.49.2）

原来会卡 34~48 秒的 GitHub raw 链接：

```
elapsed=20s
[failed] TIMEOUT: 抓取超时（超过 20 秒没有完成）
```

UI 逐秒推进采样（真实点击）：

```
2.5s  → 已等待 2 秒  / 按钮「导入中… 2s」
5.1s  → 已等待 5 秒
7.6s  → 已等待 7 秒
10.1s → 已等待 10 秒
12.6s → 已等待 12 秒
15.1s → 已等待 15 秒
17.6s → 已等待 17 秒
20.1s → 结束，面板显示「失败 1 / TIMEOUT: 抓取超时（超过 20 秒没有完成）」
```

截图：`docs/v2492-deploy/timeout-progress.png`、`timeout-result.png`。

### 回归

- `check-overflow.py`：**182/182，0 处问题**
- `check-mobile-ux.py`：**0 处可用性问题**
- 容器 `health=200`，日志无 error/exception

## 五、部署过程的一个坑（下次注意）

**DSM Container Manager 这次没能停掉容器**：脚本点「停止」后等了很久仍是 `Up`，
于是「构建」按钮保持禁用，DSM 部署失败（`_dsm_build_v2492.py` exit 1）。

绕过方式（SSH 直接重建，已验证可用）：

```bash
/usr/local/bin/docker stop lxserver
cd /volume1/docker/lxserver && /usr/local/bin/docker compose -p lxserver up -d
```

之所以能这样做：容器带 `com.docker.compose.project=lxserver` 标签，
`config_files=/volume1/docker/lxserver/compose.yaml`，`up -d` 会按新的
`image: ...:2.49.2` 重建 —— 与 DSM 的「构建」等价，且不再依赖 UI。
**注意**：若 compose 里改了端口/卷，仍需 DSM 侧同步，不要只用 SSH 改。

## 六、回滚

```bash
sed -i 's|lxserver:2.49.2|lxserver:2.49.0|' /volume1/docker/lxserver/compose.yaml
cd /volume1/docker/lxserver && /usr/local/bin/docker compose -p lxserver up -d
```

`2.49.0` 镜像与 `src2490.tar.gz` 均保留。

## 七、待办

- **推送 GitHub**：`git push origin main && git push origin v2.49.2`
  （用户要求验收后再推，验收已完成）
- 已知未处理：bundle 单 chunk 751KB（审查报告的 P3，非本轮范围）
