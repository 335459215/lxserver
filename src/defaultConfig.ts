
const config: LX.Config = {
  serverName: 'lxserver', // 同步服务名称
  'debug.enabled': false, // 是否启用 DEBUG 模式 (开发人员使用)
  'proxy.enabled': false, // 是否使用代理转发请求到本服务器
  'proxy.header': 'x-real-ip', // 代理转发的请求头 原始IP
  bindIP: '0.0.0.0', // 绑定IP
  port: 9527, // 端口
  'user.enablePath': true, // 是否开启用户路径
  'user.enableRoot': false, // 是否开启根路径
  'user.enablePublicRestriction': true, // 是否启用公开用户权限限制
  'user.enablePublicNonAdminLocalMusic': false, // 是否开启非管理员访问本地音乐
  'user.enablePublicNonAdminBrowserDownload': true, // 是否开启非管理员浏览器下载
  'user.enablePublicNonAdminServerCache': false, // 是否开启非管理员服务器缓存
  'user.enablePublicFavorites': false, // 是否开启公开收藏和歌曲
  'user.enablePublicNonAdminAccess': false, // 是否开启非管理员访问公开收藏和歌曲
  'user.enableCustomMusicDir': false, // 是否启用自定义歌曲目录
  'user.enableLoginCacheRestriction': false, // 是否启用登录用户缓存限制
  'user.enableCacheSizeLimit': false, // 是否启用缓存空间限制
  'user.cacheSizeLimit': 2000, // 缓存空间限制大小 (MB)

  maxSnapshotNum: 10, // 公共最大备份快照数
  'list.addMusicLocationType': 'top', // 公共添加歌曲到我的列表时的位置 top | bottom，参考客户端的「设置 → 列表设置 → 添加歌曲到列表时的位置」
  disableTelemetry: false, // 是否禁用数据收集（仅用于开源项目改进，不含敏感信息）

  users: [
    // 用户配置例子
    // 提示：你也可以通过环境变量 LX_USER_<用户名>={"password":"123","enableCustomMusicDir":true} 的 JSON 格式来配置高级选项
    // {
    //   name: 'user1', // 用户名，必须，不能与其他用户名重复
    //   password: '123.def', // 是连接密码，必须，不能与其他用户密码重复，若在外网，务必增加密码复杂度
    //   maxSnapshotNum: 10, // 可选，最大备份快照数
    //   'list.addMusicLocationType': 'top', // 可选，添加歌曲到我的列表时的位置 top | bottom，参考客户端的「设置 → 列表设置 → 添加歌曲到列表时的位置」
    //   enableCustomMusicDir: false, // 可选，是否启用此用户自定义歌曲目录
    //   customMusicDir: '', // 可选，自定义歌曲目录绝对路径
    //   allowOperateCustomMusicDir: false, // 可选，是否允许操作目录歌曲（如删除、洗版）
    //   allowWriteCustomMusicDir: false, // 可选，是否允许写入歌曲文件（如关联、更新元信息、嵌入歌词）
    //   enableAutoDownload: false, // 可选，是否启用此用户自动下载歌曲功能
    // },
  ],

  // 【v2.25.0 已删除 'frontend.password'】
  // 它曾是「与账号无关的部署管理密码」，明文存在浏览器 localStorage 里，
  // 与账号体系并行导致用户要记两套凭据。现在管理员 = config.users[].isAdmin，
  // 外部工具凭据 = 用户在「设置 → 令牌」里生成的持久化 token。
  // 这里刻意**不再写回该键**：老配置文件里残留的值会在读取时被忽略。

  // WebDAV 配置
  'webdav.enable': false,
  'webdav.url': '',
  'webdav.username': '',
  'webdav.password': '',
  'webdav.syncPath': '/lx-sync', // 增量同步远程路径
  'webdav.backupPath': '/lx-sync-backups', // 全量备份远程路径
  'sync.interval': 60, // 同步间隔（分钟）默认1小时
  'sync.backupInterval': 24, // 全量备份间隔（小时）默认24小时
  'webdav.excludeCache': false, // 是否排除缓存目录 (data/<user>/cache) 的同步与备份
  'webdav.excludeMusic': false, // 是否排除音乐下载目录 (data/<user>/music) 的同步与备份


  // 本地配置备份（config.js 每日一份本地副本）
  'configBackup.enable': true, // 是否启用本地配置备份
  'configBackup.retentionDays': 7, // 本地备份保留天数
  'configBackup.dir': '', // 备份目录，留空则用 <data>/backups，相对路径基于 data 目录，绝对路径直接使用

  // 歌单快照额外备份路径（留空则存于用户数据目录 list/snapshot，相对路径基于 data 目录，绝对路径直接使用）
  'snapshot.backupPath': '',

  // Web播放器配置
  // 【v2.25.0 已删除 'player.enableAuth' / 'player.password'】
  // 那是给旧版播放器（挂在 / 的静态页）做的 Cookie 门禁。旧版已于 v2.23.0 删除，
  // 新版前端由登录门守着，且这两项**没有任何调用方**。
  // 保留一个空配置项只会让「到底哪套在生效」变得难以判断。

  // 代理配置
  'proxy.all.enabled': false,
  'proxy.all.address': '',

  // 细分代理：音乐平台 / 自定义音源 / 应用。
  // enabled 为 undefined 表示该类别「沿用上面的统一开关」，显式 true/false 才独立生效。
  'proxy.music.enabled': undefined,
  'proxy.music.address': '',
  'proxy.customSource.enabled': undefined,
  'proxy.customSource.address': '',
  'proxy.app.enabled': undefined,
  'proxy.app.address': '',

  // 下载文件属主同步。
  // 服务器常以 root 运行，下载的音频/歌词/索引文件默认属主为 root，
  // 以固定 PUID 运行的外部工具（如 Music Tag Web）将无权修改这些文件。
  // 开启后，文件写盘时 chown 到下方 UID/GID 并设为 664；
  // UID/GID 未配置（<=0）时退化为 666，保证外部工具始终可编辑。
  'download.syncOwnership': true,
  'download.ownerUid': 1026,
  'download.ownerGid': 100,

  // 访问路径配置
  'admin.path': '/admin', // 后台管理路径
  'player.path': '/', // 播放器路径，默认为根路径 /
  'music.url.crossPlatform': true, // 不分平台解析: 按歌名+歌手在其它有自定义源的平台并发搜替身
  'music.url.race': true, // 自定义源并发竞速(关闭则回退按 order.json 串行轮询)
  'music.url.raceStagger': 180, // 竞速错峰间隔(ms)
  'music.url.crossStagger': 150, // 平台候选之间的错峰间隔(ms): 原平台立刻启动,跨平台候选依次跟进
  'music.url.maxParallelPlatforms': 3, // 平台候选同时在途的上限
  'music.url.priorityGrace': 350, // 优先级宽限(ms): 低优先级先返回时给更靠前在途候选反超的时间
  'music.url.maxParallel': 4, // 同一平台同时在途的自定义源上限
  'music.url.sourceRetries': 1, // 每个自定义源自身的尝试次数
  'music.url.retryDelay': 900, // 单源两次尝试之间的间隔(ms)
  'music.url.validate': true, // 校验音源返回的音频链接是否真的可用(403/404 视为该源失败并继续竞速)
  'music.url.stickyTtl': 600, // 解析结果粘滞缓存时长(秒), 0 关闭
  'music.url.breakerEnabled': true, // 死源熔断
  'music.url.breakerThreshold': 3, // 连续失败达到该次数后熔断
  'music.url.breakerCooldown': 300, // 熔断冷却时长(秒)
  'music.url.speedTune': true, // 同优先级内按实测响应速度微调音源顺序(不覆盖 order.json 的显式排序)
  'singer.sourcePriority': ['tx', 'wy'], // 歌手信息源优先级
  'artist.maxFetchPages': 20, // 歌手歌曲最大抓取页数
  'cache.namingPattern': 'simple', // 缓存命名规则
  'system.allowUnsafeVM': false, // 是否允许运行 VM 模式自定义源脚本
}

export default config
