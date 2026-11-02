
### 部署方式（2026-11-02 定稿）：必须走群晖 Container Manager 的「项目」

**不要**在 SSH 里 `docker compose up` —— 那样建出来的容器 DSM 不认，项目页会显示成
`<容器短ID>_lxserver`，而且项目里的「停止/构建」对它无效（本轮踩过）。

正确流程：
1. 改 `/volume1/docker/lxserver/compose.yaml`（镜像 tag 等）；
2. 浏览器打开 DSM → Container Manager → 项目 → `lxserver`；
3. `操作 → 构建`，DSM 会用自带 compose 重建容器。

判定成功的标志：
- `/var/packages/ContainerManager/etc/lxserver.config` 里 `"name":"lxserver"`（没有哈希前缀）；
- `docker ps` 名字是 `lxserver`，标签 `com.docker.compose.project=lxserver`。
