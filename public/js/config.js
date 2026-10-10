// 此文件中 buildHash 与 version 都是构建期由 scripts/update-build-hash.js 写入：
//   - buildHash：静态资源内容哈希（用于 HTML 里的 ?v= 缓存失效）
//   - version：从仓库根 version 文件同步（release.yml 用它当 Release 版本号）
// 其余配置由服务端在运行时动态注入 (环境变量 > config.js > defaultConfig.ts)
// 服务端拦截 /js/config.js 请求, 读取此处内容并合并服务端配置后返回
window.CONFIG = {
    buildHash: 'd32c9c9',
    version: 'v2.22.1',
};
