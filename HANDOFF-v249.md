# v2.49.0 交接：音源批量导入 + 去重（2026-11-08）

> **状态：已上线。** 代码 `main` = tag `v2.49.0`；镜像 `ghcr.io/335459215/lxserver:2.49.0`
> （`sha256:a41d7e6d10c8…`）；NAS 容器 `lxserver` 已跑 `v2.49.0`（9528），
> compose 已切到 `2.49.0`。单测 355/355，服务端与前端构建均通过；
> 部署截图在 `docs/v249-deploy/`。

---

## 一、用户需求

> 「在添加音源时，支持一次性选择多个音源文件，或者一次性添加多个音源链接？
> 也就是每一行一个音源链接。然后让它支持去重。」

即：**音源脚本批量导入**，而不是本地音乐文件/普通歌曲导入。

## 二、实现

### 1. 前端：`web/src/pages/settings/groups/SourcesGroup.tsx`

「导入源」弹窗改成三个 Tab：

| Tab | 能力 |
|---|---|
| 批量链接 | 多行 textarea，每行一个链接；空行忽略；同一批重复链接先在前端去掉 |
| 本地文件 | `<input type="file" multiple>`，一次多选 `.js/.mjs/.cjs/.json`，单文件 ≤2MB |
| 粘贴脚本 | 保留原有单脚本验证/导入流程 |

导入完成后显示逐条结果：**已导入 / 跳过 / 失败 + 原因**，不再只弹一个 toast。
一次最多 50 个源，文件批量总大小 ≤50MB。

### 2. 后端：`src/server/customSourceHandlers.ts`

新增两个接口（`src/server/server.ts` 接入路由）：

- `POST /api/custom-source/import-batch`：`{ urls: string[], useProxy?, allowUnsafeVM? }`
- `POST /api/custom-source/upload-batch`：`{ files: [{ filename, content }], allowUnsafeVM? }`

逐条处理、逐条返回，单条失败不回滚整批。批量内和已有源都做去重。

### 3. 去重纯逻辑：`src/server/customSourceDedupe.ts`

三重判重，优先级 `id > 内容哈希 > 原始链接`：

1. **同名源**：`sourceIdFromName()` 生成 id，同名即跳过；
2. **同内容**：脚本正文 SHA-256 相同即跳过（换文件名也能识别）；
3. **同链接**：URL 去 fragment、主机小写等规范化后相同即跳过。

与已有源比对时：当前账号的源参与三重判重；公开源只参与「内容/链接」判重
（id 置空），保留用户用同名私有源覆盖公开源的既有用法。

## 三、验证

### 单测

`npm run test:unit`：**355/355 通过**，其中新增 `test/customSourceBatch.test.ts` 6 条。

### 构建

- `npm run build`（服务端）通过
- `web && npm run build` 通过
- 本地接口实测：
  - 批量文件 3 条 → 导入 1 / 跳过 1（同名）/ 失败 1（空脚本）
  - 批量链接 5 条 → 导入 2 / 跳过 2（重复、同内容）/ 失败 1（404）
  - 51 条 → 400「一次最多导入 50 个音源」

### 线上

- 容器：`lxserver|ghcr.io/335459215/lxserver:2.49.0|Up`
- `/server/version`：`v2.49.0`
- 健康检查 `http://127.0.0.1:9528/`：200
- 真实账号 `yueyue` 打开「设置 → 音源 → 导入源」：三个 Tab、多选文件、结果面板均正常
- 线上批量接口空请求返回 400「请至少选择一个脚本文件」，路由已生效

## 四、改动的文件

```
src/server/customSourceDedupe.ts            新增（判重纯逻辑）
src/server/customSourceHandlers.ts          + 批量导入 handler / 判重辅助
src/server/server.ts                        + 两个批量接口路由
web/src/lib/auth.tsx                        + importBatch / uploadBatch 与结果类型
web/src/pages/settings/groups/SourcesGroup.tsx 导入源弹窗改批量版
test/customSourceBatch.test.ts              新增（6 条）
docs/api/reference.md                       补两个批量接口
version / package.json                      v2.48.5 -> v2.49.0
```

## 五、已知限制

1. 单条批量导入是**串行**的：50 条全部超时的最坏情况会等较久（正常源不会）。
2. 同名源不支持在批量里直接覆盖更新版本，会按重复跳过；需要更新时先删旧源再导入。
3. 公开源只按内容/链接判重，不按 id 判重，这是刻意保留的私有覆盖能力。

## 六、回滚

```bash
# NAS 上
sed -i 's|ghcr.io/335459215/lxserver:2.49.0|ghcr.io/335459215/lxserver:2.48.5|' \
  /volume1/docker/lxserver/compose.yaml
# DSM Container Manager -> 项目 lxserver -> 停止 -> 操作 -> 构建
```

旧镜像 `2.48.5` 与源码包 `src2485.tar.gz` 均保留。
