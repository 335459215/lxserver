declare namespace LX {
  type AddMusicLocationType = 'top' | 'bottom'

  interface User {
    /**
     * 用户名
     */
    name: string

    /**
     * 连接密码
     */
    password: string

    /**
     * 最大备份快照数
     */
    maxSnapshotNum?: number

    /**
     * 添加歌曲到我的列表时的方式
     */
    'list.addMusicLocationType'?: AddMusicLocationType

    /**
     * 是否启用此用户自定义歌曲目录
     */
    enableCustomMusicDir?: boolean

    /**
     * 自定义歌曲目录路径
     */
    customMusicDir?: string

    /**
     * 是否允许操作目录歌曲（如添加、修改、删除歌曲或分类）
     */
    allowOperateCustomMusicDir?: boolean

    /**
     * 是否允许写入歌曲文件（如手动关联、批量更新元数据、批量嵌入歌词）
     */
    allowWriteCustomMusicDir?: boolean

    /**
     * 是否启用此用户自动下载歌曲功能（允许该用户将歌单内容自动同步下载至本地数据目录）
     */
    enableAutoDownload?: boolean

    /**
     * 是否为管理员（v2.24.0 统一登录）。
     *
     * 管理权限此前是一把与账号无关的独立钥匙（frontend.password），现在改为账号属性：
     * 带 `isAdmin: true` 的账号登录后即可进入「设置」。
     *
     * 兼容规则（见 src/server/adminAuth.ts 的 isAdminUser）：
     * **没有任何账号标过 isAdmin 时，首个账号兜底为管理员** ——
     * 否则老配置升级后设置中心会直接打不开。
     */
    isAdmin?: boolean
  }

  interface UserConfig extends User {
    dataPath: string
  }

  interface Config {
    /**
     * 同步服务名称
     */
    'serverName': string

    /**
     * 是否启用 DEBUG 模式 (开发人员使用)
     */
    'debug.enabled'?: boolean

    /**
     * 是否使用代理转发请求到本服务器
     */
    'proxy.enabled': boolean

    /**
     * 代理转发的请求头 原始IP
     */
    'proxy.header': string

    /**
     * 绑定IP
     */
    bindIP: string

    /**
     * 端口
     */
    port: number

    /**
     * 是否开启用户路径 /<userName>
     */

    /**
     * 是否开启用户路径 /<userName>
     */
    'user.enablePath'?: boolean

    /**
     * 是否开启根路径 /
     */
    'user.enableRoot'?: boolean

    /**
     * 是否启用公开用户权限限制
     */
    'user.enablePublicRestriction'?: boolean

    /**
     * 是否开启非管理员访问本地音乐
     */
    'user.enablePublicNonAdminLocalMusic'?: boolean

    /**
     * 是否开启非管理员浏览器下载
     */
    'user.enablePublicNonAdminBrowserDownload'?: boolean

    /**
     * 是否开启非管理员服务器缓存
     */
    'user.enablePublicNonAdminServerCache'?: boolean

    /**
     * 是否开启公开收藏和歌曲
     */
    'user.enablePublicFavorites'?: boolean

    /**
     * 是否开启非管理员访问公开收藏和歌曲
     */
    'user.enablePublicNonAdminAccess'?: boolean

    /**
     * 是否启用登录用户缓存限制
     */
    'user.enableLoginCacheRestriction'?: boolean
    /**
     * 是否启用缓存空间限制
     */
    'user.enableCacheSizeLimit'?: boolean
    /**
     * 缓存空间限制大小 (MB)
     */
    'user.cacheSizeLimit'?: number

    /**
     * 公共最大备份快照数
     */
    maxSnapshotNum: number

    /**
     * 公共添加歌曲到我的列表时的方式 top | bottom，参考客户端的设置-列表设置-添加歌曲到我的列表时的方式
     */
    'list.addMusicLocationType': AddMusicLocationType

    /**
     * 同步用户
     */
    users: UserConfig[]

    // 【v2.25.0 已删除 'frontend.password'】
    // 管理员身份改由 `users[].isAdmin` 决定；外部工具凭据改由持久化 token 承担
    // （见 `/api/user/token/*`）。类型里保留这条说明而不是留一个可选字段，
    // 是为了让「这个键为什么不见了」有据可查。

    /**
     * 是否启用 WebDAV 同步服务
     */
    'webdav.enable'?: boolean

    /**
     * WebDAV URL
     */
    'webdav.url'?: string

    /**
     * WebDAV 用户名
     */
    'webdav.username'?: string

    /**
     * WebDAV 密码
     */
    'webdav.password'?: string

    /**
     * WebDAV 增量同步远端路径（默认 /lx-sync）
     */
    'webdav.syncPath'?: string

    /**
     * WebDAV 全量备份远端路径（默认 /lx-sync-backups）
     */
    'webdav.backupPath'?: string

    /**
     * 同步间隔(分钟)
     */
    'sync.interval'?: number

    /**
     * 全量备份间隔(小时)，默认 24
     */
    'sync.backupInterval'?: number

    /**
     * 是否排除缓存目录 (data/<user>/cache) 的增量同步与全量备份
     */
    'webdav.excludeCache'?: boolean

    /**
     * 是否排除音乐下载目录 (data/<user>/music) 的增量同步与全量备份
     */
    'webdav.excludeMusic'?: boolean

    /**
     * 是否启用本地配置备份（每日一份 config.js 副本，保留指定天数）
     */
    'configBackup.enable'?: boolean

    /**
     * 本地配置备份保留天数（默认 7）
     */
    'configBackup.retentionDays'?: number

    /**
     * 本地配置备份目录，留空则使用 <data>/backups；相对路径基于 data 目录，绝对路径直接使用
     */
    'configBackup.dir'?: string

    /**
     * 歌单快照额外备份路径（留空则存于用户数据目录 list/snapshot）。
     * 相对路径基于 data 目录，绝对路径直接使用
     */
    'snapshot.backupPath'?: string

    // 【v2.25.0 已删除 'player.enableAuth' / 'player.password'】
    // 旧版播放器（挂在 / 的静态页）的独立 Cookie 门禁，随旧版一起下线。
    // 新版前端由登录门守着（账号 + 密码换 token），且这两项没有任何调用方。

    /**
     * 是否启用自定义歌曲目录
     */
    'user.enableCustomMusicDir'?: boolean

    /**
     * 是否启用针对所有外发请求的代理 (目前主要用于 Music SDK)
     */
    'proxy.all.enabled'?: boolean

    /**
     * 代理地址 (支持 http:// 或 socks5://)
     */
    'proxy.all.address'?: string

    /**
     * 音乐平台(内置音源 SDK)请求是否单独走代理；undefined 表示沿用 proxy.all.*
     */
    'proxy.music.enabled'?: boolean

    /** 音乐平台请求的代理地址 */
    'proxy.music.address'?: string

    /** 自定义音源脚本请求是否单独走代理；undefined 表示沿用 proxy.all.* */
    'proxy.customSource.enabled'?: boolean

    /** 自定义音源脚本请求的代理地址 */
    'proxy.customSource.address'?: string

    /** 应用自身功能(封面代理/识别/远程导入等)请求是否单独走代理；undefined 表示沿用 proxy.all.* */
    'proxy.app.enabled'?: boolean

    /** 应用自身功能请求的代理地址 */
    'proxy.app.address'?: string

    /** 下载文件属主同步：文件写盘后 chown 到 ownerUid/ownerGid 并设为 664，供外部工具(如 Music Tag Web)编辑 */
    'download.syncOwnership'?: boolean

    /** 下载文件属主 UID（<=0 表示不 chown，退化为 666 权限） */
    'download.ownerUid'?: number

    /** 下载文件属主 GID（<=0 表示不 chown，退化为 666 权限） */
    'download.ownerGid'?: number

    /**
     * 是否禁用数据收集
     */
    disableTelemetry?: boolean

    /**
     * 后台管理界面访问路径，默认为 /admin
     */
    'admin.path'?: string

    /**
     * Web播放器访问路径，默认为空字符串（表示根路径 /）
     */
    'player.path'?: string

    // === 音乐源解析（/api/music/url 使用）===

    /**
     * 不分平台解析 (默认 true)。开启后不局限于歌曲所属平台：按歌名+歌手在其它
     * 「有自定义源能解析」的平台并发搜替身，任一平台的任一自定义源成功即采用。
     */
    'music.url.crossPlatform'?: boolean

    /**
     * 自定义源并发竞速 (默认 true)。关闭后回退到按 order.json 串行轮询。
     */
    'music.url.race'?: boolean

    /**
     * 竞速错峰间隔(ms, 默认 180)。相邻候选的启动间隔，防止死源拖慢整体，同时保留优先级语义。
     */
    'music.url.raceStagger'?: number

    /**
     * 平台候选错峰间隔(ms, 默认 150)。原平台立刻启动,跨平台候选依次跟进。
     */
    'music.url.crossStagger'?: number

    /**
     * 平台候选同时在途的上限(默认 3)。
     */
    'music.url.maxParallelPlatforms'?: number

    /**
     * 优先级宽限(ms, 默认 350)。低优先级源先返回时，给更靠前的在途候选反超的时间。
     */
    'music.url.priorityGrace'?: number

    /**
     * 同一平台同时在途的自定义源上限(默认 4)，防止一次性打满音源脚本与上游接口。
     */
    'music.url.maxParallel'?: number

    /**
     * 每个自定义源自身的尝试次数(默认 1)。>1 时按 music.url.retryDelay 间隔重试。
     */
    'music.url.sourceRetries'?: number

    /**
     * 单个源两次尝试之间的间隔(ms, 默认 900)。
     */
    'music.url.retryDelay'?: number

    /**
     * 解析成功后校验音频链接可用性(默认 true)。音源经常返回一个 403/404 的
     * 「成功」链接，校验失败会把该源记为失败并继续竞速，而不是把坏链接交给播放器。
     */
    'music.url.validate'?: boolean

    /**
     * 解析结果粘滞缓存时长(秒, 默认 600)。命中后直接复用上次成功的平台+自定义源，
     * 跳过整条搜索与竞速链路；0 表示关闭。
     */
    'music.url.stickyTtl'?: number

    /**
     * 死源熔断 (默认 true)。连续失败的源会被临时跳过，避免每首歌都重蹈死源的完整超时。
     */
    'music.url.breakerEnabled'?: boolean

    /**
     * 熔断阈值(默认 3)：连续失败达到该次数后熔断。
     */
    'music.url.breakerThreshold'?: number

    /**
     * 熔断冷却时长(秒, 默认 300)。冷却结束后放一个探针重新试探，而不是直接清零。
     */
    'music.url.breakerCooldown'?: number

    /**
     * 同优先级内按实测响应速度微调自定义源顺序 (默认 true)。
     * 只影响 order.json **未显式排序**的那些源；用户配置的优先级始终优先。
     * 速度样本搭在已有的链接可用性探测上顺带测量，不额外增加播放延迟。
     */
    'music.url.speedTune'?: boolean

    /**
     * 歌手信息源优先级
     */
    'singer.sourcePriority': Array<'tx' | 'wy'>
    /**
     * 歌手歌曲最大抓取页数
     */
    'artist.maxFetchPages'?: number
    /**
     * 缓存命名规则
     */
    'cache.namingPattern'?: string
    /**
     * 缓存存储位置
     */
    serverCacheLocation?: string
    /**
     * 是否允许运行 VM 模式自定义源脚本
     */
    'system.allowUnsafeVM'?: boolean
  }
}
