# v2.49.1 交接：前端审查 P1/P2 修复（2026-11-08）

> **状态：已部署并验收通过，未推送 GitHub（按用户要求「验收没问题之后再推送」）。**
> 镜像 `ghcr.io/335459215/lxserver:2.49.1`（`sha256:1f64939cdeab…`）；
> NAS 容器已跑 `v2.49.1`（9528），compose 已切到 `2.49.1`。
> 本地提交 `be43414` + tag `v2.49.1`。
> 部署截图 `docs/v2491-deploy/`。

---

## 一、起点：v2.49.0 前端审查结论

审查报告见 `docs/v249-audit/FRONTEND-AUDIT-v249.md`（16/20 Good）。
本轮只修报告里的 P1/P2，P3（bundle 拆包）未动。

## 二、改动清单

| 报告项 | 文件 | 改法 |
|---|---|---|
| P1 textarea 12px（iOS 聚焦放大） | `SourcesGroup.tsx` | `text-base md:text-xs`：移动 16px、桌面 12px |
| P2 toast 盖住弹窗主操作 | `toast.tsx` / `index.css` / `SourcesGroup.tsx` | viewport 抬到 Tab 栏/播放栏之上；`body:has([role=dialog])` 时移到顶部；批量导入不再额外弹 toast |
| P2 移动端弹窗贴边 | `dialog.tsx` | `max-sm:w-[calc(100%-2rem)]`（16px 边距） |
| P2 触摸目标过小 | `SourcesGroup.tsx` / `tabs.tsx` / `dialog.tsx` | 「使用代理」16→40px；Tab 28→36px；关闭按钮 24→40px（移动）/32px（桌面） |
| P2 桌面 5px 纵向溢出 | `App.tsx` | 根因是侧栏 `100vh-3.5rem` 少算顶栏 1px 边框 + 单位不符，改 `100dvh-var(--header-h)-1px-var(--playerbar-h)` |
| P3 PWA 底部安全区预留 | `App.tsx` | 内容 `pb` 改为 `calc(var(--mobile-tabbar-h)+var(--safe-bottom))` |
| P3 placeholder 对比度 | `SourcesGroup.tsx` | `placeholder:text-faint`（2.5:1 → 5.4:1） |
| 附带 | `SourcesGroup.tsx` | 弹窗 `max-h` 减掉 `--safe-top/--safe-bottom`，PWA 全屏不被顶出 |

> 注意：5px 溢出的根因**不是** `NowPlayingPage`，而是 `App.tsx` 的 `<aside>`：
> 顶栏实际 61px（`--header-h` 3.75rem + 1px 边框），原写死 `3.5rem`，
> 于是**每一页**都比视口高 5px。改完后 `/now-playing`、`/playlist` 等全部归零。

## 三、本地验证

- 服务端 `npm run build`、前端 `npm run build` 通过
- 单测 **355/355**
- `check-overflow.py`：**182/182，0 处问题**（改前 2 处）
- `check-mobile-ux.py`：**0 处可用性问题**
- `verify-mobile-nav.py`：35/36（唯一 FAIL 是 Headless 滚动条宽度为 0 的脚本假设）
- 弹窗实测（本地 + 线上一致）：

| 视口 | 宽 | 边距 | textarea | 代理 label | Tab | 关闭按钮 | toast∩完成 |
|---|---|---|---|---|---|---|---|
| 1440×900 | 672 | 384/384 | 12px | 40 | 36 | 32×32 | 不重叠 |
| 390×844 | 358 | 16/16 | **16px** | 40 | 36 | **40×40** | 不重叠 |
| 375×667 | 343 | 16/16 | **16px** | 40 | 36 | **40×40** | 不重叠 |
| 844×390 | 672 | 86/86 | 12px | 40 | 36 | 32×32 | 不重叠 |

- PWA 安全区（模拟）：`main` 底部到 Tab 栏间距 **10px → 24px**，顶栏 `padding-top` 正确取到 `safe-top`；无横向溢出

## 四、线上验收（NAS 2.49.1）

| 项 | 结果 |
|---|---|
| 容器 | `lxserver \| ghcr.io/…:2.49.1 \| Up` |
| `/server/version` | `v2.49.1` |
| compose | `image: ghcr.io/335459215/lxserver:2.49.1` |
| 健康检查 | `http://127.0.0.1:9528/` → 200；公网 `https://lx.131452188.xyz:51739` → 200 |
| 全路由多视口 | **182/182 通过** |
| 移动 UX | 0 处问题 |
| 移动导航 | 35/36（同上脚本假设） |
| PWA deep | 22/24，2 条为**已知过期断言**（v2.44 起排行榜两接口有意缓存），非缺陷 |
| 真实批量导入 | 2 秒完成：重复链接 `跳过`、404 `失败` 原因准确，源数量前后均为 3（未污染线上数据） |

截图：`docs/v2491-deploy/{desktop,mobile-390,mobile-375,mobile-landscape}-dialog-result.png`、
`live-batch-links-success.png`、DSM 部署过程 12 张。

## 五、验收中发现的**环境问题**（非产品缺陷，但值得记录）

**NAS 容器内访问 `raw.githubusercontent.com` 超时**，而 NAS 主机 `curl` 同一地址 1 秒 200：

```
容器: wget https://raw.githubusercontent.com/... → download timed out
主机: curl -w '%{http_code} %{time_total}' → 200 0.99s
容器: https://cdn.jsdelivr.net/... → OK
容器: http/https www.baidu.com → OK
```

即容器 DNS/路由对该域名的链路与主机不同。**影响**：用 GitHub raw 链接导入音源会失败；
换成 jsdelivr 镜像即正常。若用户常用 raw 链接，需要在容器侧加 DNS 或改用镜像。

之前一次「导入中…卡 48 秒」就是该域名超时导致的，不是并发抢占，也不是本项目代码问题。

## 六、回滚

```bash
sed -i 's|ghcr.io/335459215/lxserver:2.49.1|ghcr.io/335459215/lxserver:2.49.0|' \
  /volume1/docker/lxserver/compose.yaml
# DSM Container Manager -> 项目 lxserver -> 停止 -> 操作 -> 构建
```

`2.49.0` 镜像与 `src2490.tar.gz` 均保留。

## 七、待办

- **推送 GitHub**：`git push origin main && git push origin v2.49.1`（用户要求验收后再推，验收已完成）
- push 后 CI 会自动构建镜像；注意 `test:mutation` 若红会跳过 manifest 发布
