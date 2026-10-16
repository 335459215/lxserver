# 阶段 0 — 基线与快速收益

本目录是前端重构 + 存储层升级的**前置工程**，产物在写任何新代码之前完成。
目标只有一个：**让"没丢功能"这件事有客观证据，而不是靠人眼比对。**

## 产物

| 文件 | 内容 | 用途 |
|---|---|---|
| `feature-inventory.md` | 45 项能力清单（契约） | 每项验收方式的来源；冒烟测试的用例即由它派生 |
| `feature-detail-player.md` | 播放器逐项明细（155 项） | 契约的展开；旧实现位置 |
| `feature-detail-admin.md` | 后台逐项明细（121 项） | 同上 |
| `api-and-state-map.md` | 全量 API 面、鉴权方式、会话/缓存状态、落盘文件 | 阶段 B 鉴权统一、阶段 0 Redis 会话层的直接输入 |
| `config-keys.md` | 105 个全局配置键 + 60 个用户设置键 | 设置中心分组；识别两个命名空间的歧义键 |
| `perf-baseline.md` | 现状实测数值 + 可度量验收标准 | 每次阶段交付的量化门槛 |
| `defect-ledger.md` | 缺陷台账 | 移植中发现的缺陷单独排期，**禁止边搬边改** |
| `scripts/smoke/baseline/` | 冒烟测试基线结果（JSON + 摘要） | 新旧两版逐项比对的参照（**不在本目录下**） |

## 三条原则（来自计划）

1. **后端解析器全程不动** —— `race-e2e-test.js` 9 项持续通过。
2. **原样搬运，不顺手改 bug** —— 一律记入 `defect-ledger.md`。
3. **每阶段独立可发布、可回退。**

## ⚠️ 2026-10-16 现状（v2.27.6 核实，读本文前必看）

阶段 0 的**产物仍有效**（契约、缺陷台账、配置键、API 面），但其中大量
`file:line` 定位信息**已经失效**：

- 旧前端 `public/music/**`、`public/index.html`、`public/app.js`、`public/style.css`
  **已全部删除**，现为 `web/` 的 React 前端（构建产物 `public/app/`）。
  受影响：`feature-detail-player.md`、`feature-detail-admin.md`、`feature-inventory.md`、
  `perf-baseline.md`（各自顶部已加历史快照标记）。
- `src/server/subsonic.ts` 与全部 `subsonic.*` 配置键**已于 v2.27.0 删除**。
  受影响：`config-keys.md`（已清理并更新至 v2.27.6）、`api-and-state-map.md`（已清理）、
  `defect-ledger.md`（已标注「随实现消失」）。
- 鉴权头 `x-frontend-auth` 已于 v2.25.0 整条链路删除，管理接口改认 `x-user-token`。
  `api-and-state-map.md` 已修正图例。
- **仍可直接使用**：`config-keys.md`（现行配置键）、`api-and-state-map.md`（API 面与鉴权）、
  `defect-ledger.md`（未修缺陷清单）。

## 冒烟测试

```bash
# 从仓库根目录
node scripts/smoke/run.mjs --help
node scripts/smoke/run.mjs --surface old          # 只跑旧版（/）基线
node scripts/smoke/run.mjs --surface new          # 只跑新版（/app）
node scripts/smoke/run.mjs --surface both         # 跑两版并逐项比对
```

> **注意**：`--surface old` 指向的旧前端已删除，该 surface **当前无法复现**
> （`--surface new` 与 `both` 中的新版部分仍可用）。

测试用**隔离数据目录**（fixture 复制到临时目录，不碰线上 `data/`），
音乐平台请求走**本地 mock 代理**，不产生真实外网流量、不会触发限流。
详见 `scripts/smoke/README.md`。

## 当前状态

- [x] 4 份代码勘查（播放器 / 后台 / API 与会话态 / 配置键）
- [x] 性能基线实测
- [x] 冒烟框架 + fixture + mock 代理
- [x] 旧版基线结果存档
- [ ] Redis 会话层（会话/令牌迁出进程内 Map）
