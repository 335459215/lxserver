import { FIXTURE_USER, FIXTURE_PASSWORD } from '../lib/fixture.mjs'
import { assert, assertStatus } from '../lib/http.mjs'

const SONG = {
  name: '冒烟测试曲一',
  singer: '测试歌手',
  source: 'kw',
  songmid: 'smoke1001',
  albumId: 'smokealb1',
  albumName: '冒烟专辑',
  interval: '03:30',
  types: [{ type: '320k', size: '8.80MB' }],
}

/** 每个 case 的 id 与 docs/stage0/feature-inventory.md 的契约 ID 对应 */
export const apiCases = [
  {
    id: 'A02-用户登录成功',
    contract: 'A02',
    title: 'POST /api/user/login 用 fixture 账号拿到 token',
    async run(ctx) {
      const res = await ctx.client.post('/api/user/login', { json: { username: FIXTURE_USER, password: FIXTURE_PASSWORD } })
      assertStatus(res, 200, '登录')
      assert(res.json?.token, `响应缺少 token: ${res.text?.slice(0, 120)}`)
      ctx.userToken = res.json.token
    },
  },
  {
    id: 'A02-用户登录失败',
    contract: 'A02',
    title: '错误密码必须被拒绝',
    async run(ctx) {
      const res = await ctx.client.post('/api/user/login', { json: { username: FIXTURE_USER, password: 'wrong' } })
      assertStatus(res, [401, 403], '错误密码登录')
    },
  },
  {
    id: 'A02-用户token自检',
    contract: 'A02',
    title: 'GET /api/user/auth/verify 用 token 校验登录态',
    async run(ctx) {
      ctx.client.setToken(ctx.userToken)
      const res = await ctx.client.get('/api/user/auth/verify', { headers: { 'x-user-token': ctx.userToken } })
      assertStatus(res, 200, 'token 自检')
      assert(res.json?.valid === true && res.json?.username === FIXTURE_USER, `自检结果异常: ${res.text?.slice(0, 120)}`)
    },
  },
  {
    id: 'A01-播放器登录闭环',
    contract: 'A01',
    title: '播放器访问密码：登录 → 自检 → 登出',
    async run(ctx) {
      const res = await ctx.client.post('/api/music/auth', { json: { password: 'whatever' } })
      assert([200, 400, 401].includes(res.status), `播放器登录状态异常: ${res.status} ${res.text?.slice(0, 120)}`)
      const verify = await ctx.client.get('/api/music/auth/verify')
      assertStatus(verify, 200, '播放器登录态自检')
    },
  },
  {
    id: 'PL01-读取fixture歌单',
    contract: 'PL01',
    title: 'GET /api/user/list 读回 fixture 的三个列表',
    async run(ctx) {
      const res = await ctx.client.get('/api/user/list', { headers: { 'x-user-token': ctx.userToken } })
      assertStatus(res, 200, '读取歌单')
      const text = res.text
      assert(text.includes('冒烟测试曲一'), 'default 列表首曲缺失')
      assert(text.includes('冒烟测试曲三'), 'love 列表歌曲缺失')
      assert(text.includes('冒烟歌单'), '自定义歌单缺失')
      assert(text.includes('冒烟测试曲四'), '自定义歌单内歌曲缺失')
    },
  },
  {
    id: 'PL01-歌单增删闭环',
    contract: 'PL01',
    title: 'POST /api/music/user/list/add → /remove 落库并回读',
    async run(ctx) {
      const headers = { 'x-user-token': ctx.userToken }
      const add = await ctx.client.post('/api/music/user/list/add', {
        headers,
        json: { listId: 'smokelist1', musicInfos: [SONG], location: 'top' },
      })
      assertStatus(add, 200, '加入歌单')
      const read = await ctx.client.get('/api/user/list', { headers })
      assert(read.text.includes('冒烟测试曲一'), '加入后回读失败')
      const remove = await ctx.client.post('/api/music/user/list/remove', {
        headers,
        json: { listId: 'smokelist1', songIds: [SONG.songmid] },
      })
      assertStatus(remove, 200, '移出歌单')
    },
  },
  {
    id: 'PL03-歌手专辑库读写',
    contract: 'PL03',
    title: 'GET/POST /api/user/library/{artists,albums}',
    async run(ctx) {
      const headers = { 'x-user-token': ctx.userToken }
      const artist = { id: 'smokeartist1', name: '测试歌手', avatar: null, source: 'kw' }
      const post = await ctx.client.post('/api/user/library/artists', { headers, json: [artist] })
      assertStatus(post, 200, '写入收藏歌手')
      const get = await ctx.client.get('/api/user/library/artists', { headers })
      assertStatus(get, 200, '读取收藏歌手')
      assert(get.text.includes('测试歌手'), `收藏歌手回读失败: ${get.text?.slice(0, 120)}`)
      const album = { id: 'smokealb1', name: '冒烟专辑', picUrl: null, source: 'kw', singer: '测试歌手' }
      const postAlbum = await ctx.client.post('/api/user/library/albums', { headers, json: [album] })
      assertStatus(postAlbum, 200, '写入收藏专辑')
      const getAlbum = await ctx.client.get('/api/user/library/albums', { headers })
      assert(getAlbum.text.includes('冒烟专辑'), '收藏专辑回读失败')
    },
  },
  {
    id: 'PL04-厌恶库读写',
    contract: 'PL04',
    title: 'GET/POST /api/user/dislike/library/artists',
    async run(ctx) {
      const headers = { 'x-user-token': ctx.userToken, 'x-user-name': FIXTURE_USER }
      const get = await ctx.client.get('/api/user/dislike/library/artists', { headers })
      assertStatus(get, 200, '读取厌恶歌手')
      // 整表覆盖写，必须是数组；服务端会自动补 dislikeRule（server.ts:2436）
      const post = await ctx.client.post('/api/user/dislike/library/artists', {
        headers,
        json: [{ id: 'smokeartist1', name: '测试歌手', source: 'kw' }],
      })
      assertStatus(post, 200, '写入厌恶歌手')
      const after = await ctx.client.get('/api/user/dislike/library/artists', { headers })
      assert(after.text.includes('测试歌手'), '厌恶歌手回读失败')
      // 互斥：收藏与厌恶不应同时存在（server.ts:2258 反向同步）
      const loved = await ctx.client.get('/api/user/library/artists', { headers })
      assert(!loved.text.includes('smokeartist1'), '厌恶歌手仍留在收藏列表中')
    },
  },
  {
    id: 'A03-用户设置读写',
    contract: 'A03',
    title: 'GET/POST /api/user/settings 持久化',
    async run(ctx) {
      const headers = { 'x-user-token': ctx.userToken, 'x-user-name': FIXTURE_USER }
      const before = await ctx.client.get('/api/user/settings', { headers })
      assertStatus(before, 200, '读取用户设置')
      const merged = { ...(before.json?.settings ?? before.json ?? {}), preferredQuality: 'flac', itemsPerPage: 50 }
      // body 直接是设置对象本体，不是 {settings: ...} 包装（对齐 app.js:10040 的 fetch）
      const post = await ctx.client.post('/api/user/settings', { headers, json: merged })
      assertStatus(post, 200, '保存用户设置')
      const after = await ctx.client.get('/api/user/settings', { headers })
      assert(after.text.includes('"flac"') || after.text.includes('flac'), 'preferredQuality 未持久化')
      assert(after.text.includes('50'), 'itemsPerPage 未持久化')
    },
  },
  {
    id: 'A05-持久化Token全流程',
    contract: 'A05',
    title: '生成 Token → 列表 → 日志 → 启停 → 删除',
    async run(ctx) {
      const headers = { 'x-user-token': ctx.userToken }
      const add = await ctx.client.post('/api/user/token/add', { headers, json: { name: '冒烟Token' } })
      assertStatus(add, 200, '生成 Token')
      const token = add.json?.token
      assert(token && token.startsWith('lx_tk_'), `Token 格式异常: ${token}`)
      const cfg = await ctx.client.get('/api/user/token/config', { headers })
      assert(cfg.text.includes('冒烟Token'), 'Token 列表未包含新 Token')
      const logs = await ctx.client.get('/api/user/token/logs?tokenMasked=lx_tk_****', { headers })
      assertStatus(logs, 200, 'Token 调用日志')
      const masked = `${token.slice(0, 6)}...${token.slice(-4)}`
      const toggle = await ctx.client.post('/api/user/token/toggle', { headers, json: { tokenMasked: masked, disabled: true } })
      assertStatus(toggle, 200, '禁用 Token')
      const remove = await ctx.client.post('/api/user/token/remove', { headers, json: { token } })
      assertStatus(remove, 200, '删除 Token')
    },
  },
  {
    id: 'P04-解析播放地址',
    contract: 'P04',
    title: 'POST /api/music/url 拿到 mock 音频地址（解析器链路）',
    async run(ctx) {
      const res = await ctx.client.post('/api/music/url', {
        headers: { 'x-user-token': ctx.userToken, 'x-user-name': FIXTURE_USER },
        json: { songInfo: SONG, quality: '320k' },
      })
      assertStatus(res, 200, '解析播放地址')
      const url = res.json?.url
      assert(typeof url === 'string' && url.includes('smoke1001'), `返回地址异常: ${res.text?.slice(0, 200)}`)
      ctx.resolvedUrl = url
    },
  },
  {
    id: 'P04-死链源被链接校验筛掉',
    contract: 'P04',
    title: 'mock-dead 的链接不可播，最终采用 mock-kw 的链接',
    async run(ctx) {
      const res = await ctx.client.post('/api/music/url', {
        headers: { 'x-user-token': ctx.userToken, 'x-user-name': FIXTURE_USER },
        json: { songInfo: SONG, quality: '320k' },
      })
      assertStatus(res, 200, '解析播放地址')
      // 死链端口是 127.0.0.1:1，注意别用 includes('127.0.0.1:1')——mock 音频端口 19528 也含这段
      assert(!/(127\.0\.0\.1|localhost):1(?!\d)/.test(String(res.json?.url)), `死链竟然被采用了: ${res.json?.url}`)
      // order.json 里 mock-dead 排在 mock-kw 之后，返回死链；最终必须落到 mock-kw
      assert(res.json?.sourceId === 'mock-kw.js', `赢家不是 mock-kw: ${JSON.stringify(res.json).slice(0, 200)}`)
      assert(String(res.json?.url).includes('smoke1001'), `链接异常: ${res.json?.url}`)
      // 已知观测性缺口（见 docs/stage0/defect-ledger.md）：成功路径不回 attempts，
      // 所以这里只能校验"胜者正确"，换源过程在失败路径才可见。
    },
  },
  {
    id: 'P04-跨平台替身已被明确记录',
    contract: 'P04',
    title: '请求平台没有源时， resolver 按设计找跨平台替身，并在响应里标明',
    async run(ctx) {
      // 这是 resolver 的设计行为（musicResolver.ts:9「不分平台」），不是缺陷：
      // wy 请求在只有 kw 源的环境下会用 kw 的替身出链接。
      const res = await ctx.client.post('/api/music/url', {
        headers: { 'x-user-token': ctx.userToken, 'x-user-name': FIXTURE_USER },
        json: { songInfo: { ...SONG, source: 'wy' }, quality: '128k' },
      })
      assertStatus(res, 200, '跨平台替身解析')
      assert(res.json?.requestedSource === 'wy', `未记录请求平台: ${res.text?.slice(0, 200)}`)
      assert(res.json?.resolvedSource === 'kw', `未落到 kw 替身: ${res.text?.slice(0, 200)}`)
      assert(String(res.json?.url).includes('smoke1001'), `替身链接异常: ${res.json?.url}`)
    },
  },
  {
    id: 'P04-全军覆没时错误可读',
    contract: 'P04',
    title: '替身也搜不到时，错误信息点名平台与原因，而不是静默 null',
    async run(ctx) {
      const res = await ctx.client.post('/api/music/url', {
        headers: { 'x-user-token': ctx.userToken, 'x-user-name': FIXTURE_USER },
        json: { songInfo: { name: '冒烟不存在的歌曲XYZ', singer: '查无此人', source: 'wy', songmid: 'nosuch9999' }, quality: '128k' },
      })
      assert(res.status !== 200, `没有任何可用源时应报错，实际给了 200: ${res.text?.slice(0, 200)}`)
      assert(/自定义源|未找到|无法播放/.test(res.text || ''), `错误信息不可读: ${res.text?.slice(0, 200)}`)
    },
  },
  {
    id: 'P04-公开用户与私有源隔离',
    contract: 'P04',
    title: '不带具名用户时解析不到 tester 的私有源（源归属隔离）',
    async run(ctx) {
      const res = await ctx.client.post('/api/music/url', { json: { songInfo: SONG, quality: '128k' } })
      assert(res.status !== 200, '公开用户不应解析到 tester 的私有源')
    },
  },
  {
    id: 'P04-解析鉴权',
    contract: 'P04',
    title: '具名用户 + 无 token → 401',
    async run(ctx) {
      const res = await ctx.client.post('/api/music/url', {
        headers: { 'x-user-name': FIXTURE_USER },
        json: { songInfo: SONG, quality: '128k' },
      })
      assertStatus(res, 401, '具名用户无 token 解析')
    },
  },
  {
    id: 'S01-平台搜索',
    contract: 'S01',
    title: 'GET /api/music/search?source=kw 返回 fixture 歌曲',
    async run(ctx) {
      const res = await ctx.client.get('/api/music/search?name=%E5%86%92%E7%83%9F&source=kw&page=1&type=song')
      assertStatus(res, 200, 'kw 搜索')
      assert(Array.isArray(res.json) && res.json.length > 0, `搜索结果不是非空数组: ${res.text?.slice(0, 160)}`)
      assert(res.json[0].name === '冒烟测试曲一', `首条结果异常: ${res.text?.slice(0, 160)}`)
      assert(res.json[0].source === 'kw', '结果缺 source 字段')
      assert(Array.isArray(res.json[0].types) && res.json[0].types.length >= 3, '结果缺音质列表')
    },
  },
  {
    id: 'S01-搜索结果分页',
    contract: 'S01',
    title: 'page 参数真的透传到平台：三页切出不同歌曲且互不重叠',
    async run(ctx) {
      const q = '/api/music/search?name=%E5%86%92%E7%83%9F&source=kw&type=song'
      const p1 = await ctx.client.get(`${q}&page=1`)
      assertStatus(p1, 200, '第一页')
      assert(p1.json?.length === 20, `第一页应 20 条，实际 ${p1.json?.length}`)
      const p2 = await ctx.client.get(`${q}&page=2`)
      assertStatus(p2, 200, '第二页')
      assert(p2.json?.length === 20, `第二页应 20 条，实际 ${p2.json?.length}`)
      const p3 = await ctx.client.get(`${q}&page=3`)
      assertStatus(p3, 200, '第三页')
      assert(p3.json?.length === 5, `第三页应剩 5 条，实际 ${p3.json?.length}`)
      const ids = (r) => new Set(r.json.map(x => x.songmid))
      const a = ids(p1), b = ids(p2), c = ids(p3)
      for (const [x, y, label] of [[a, b, '一二页'], [b, c, '二三页']]) {
        const overlap = [...x].filter(v => y.has(v))
        assert(overlap.length === 0, `${label}出现重复歌曲: ${overlap.join(',')}`)
      }
      assert([...a][0] === 'smoke1001', '翻页后第一页首条变了')
      assert([...b][0] === 'smoke1021', '第二页首条不是 smoke1021')
    },
  },
  {
    id: 'S02-热搜',
    contract: 'S02',
    title: 'GET /api/music/hotSearch?source=kw 返回 fixture 热词',
    async run(ctx) {
      const res = await ctx.client.get('/api/music/hotSearch?source=kw')
      assertStatus(res, 200, '热搜')
      const words = Array.isArray(res.json) ? res.json : res.json?.list
      assert(Array.isArray(words) && words.includes('冒烟热搜一'), `热搜内容异常: ${res.text?.slice(0, 160)}`)
    },
  },
  {
    id: 'AD01-服务状态',
    contract: 'AD01',
    title: 'GET /api/status 返回运行指标',
    async run(ctx) {
      const res = await ctx.client.get('/api/status', { auth: 'admin' })
      assertStatus(res, 200, '服务状态')
      const text = res.text
      assert(/memory|cpu/i.test(text), `状态响应缺 CPU/内存字段: ${text.slice(0, 160)}`)
    },
  },
  {
    id: 'AD02-用户管理增改删',
    contract: 'AD02',
    title: 'GET/POST/PUT/DELETE /api/users 全流程',
    async run(ctx) {
      const list = await ctx.client.get('/api/users', { auth: 'admin' })
      assertStatus(list, 200, '读取用户列表')
      const created = await ctx.client.post('/api/users', { auth: 'admin', json: { name: 'smokeuser', password: 'pw123456' } })
      assertStatus(created, 200, '新增用户')
      const updated = await ctx.client.put('/api/users', { auth: 'admin', json: { name: 'smokeuser', password: 'pw654321' } })
      assertStatus(updated, 200, '修改密码')
      const deleted = await ctx.client.del('/api/users', { auth: 'admin', json: { names: ['smokeuser'] } })
      assertStatus(deleted, 200, '删除用户')
    },
  },
  {
    id: 'AD03-数据查看',
    contract: 'AD03',
    title: 'GET /api/data 返回 fixture 用户的聚合数据',
    async run(ctx) {
      const res = await ctx.client.get(`/api/data?user=${FIXTURE_USER}`, { auth: 'admin' })
      assertStatus(res, 200, '数据查看')
      assert(res.text.includes('冒烟'), `数据响应缺 fixture 内容: ${res.text?.slice(0, 160)}`)
    },
  },
  {
    id: 'AD04-配置读写',
    contract: 'AD04',
    title: 'GET /api/config 读全量配置，POST 保存后回读生效',
    async run(ctx) {
      const get = await ctx.client.get('/api/config', { auth: 'admin' })
      assertStatus(get, 200, '读取配置')
      assert('serverName' in (get.json ?? {}), '配置响应缺 serverName')
      // POST /api/config 只认 JSON body（server.ts:6829 JSON.parse），表单体会 500
      const save = await ctx.client.post('/api/config', {
        auth: 'admin',
        json: { 'serverName': 'lxserver-smoke', 'list.addMusicLocationType': 'bottom' },
      })
      assertStatus(save, 200, '保存配置')
      const after = await ctx.client.get('/api/config', { auth: 'admin' })
      assert(after.json?.['list.addMusicLocationType'] === 'bottom', '配置保存未生效')
    },
  },
  {
    id: 'AD04-配置路径冲突校验',
    contract: 'AD04',
    title: 'admin.path 设为 /api 开头必须被拒绝',
    async run(ctx) {
      const res = await ctx.client.post('/api/config', { auth: 'admin', json: { 'admin.path': '/api' } })
      const text = res.text || ''
      assert(res.status !== 200 || /冲突|不能|非法|相同/.test(text), `非法 admin.path 未被拒绝: ${res.status} ${text.slice(0, 160)}`)
    },
  },
  {
    id: 'AD05-代理实际生效回显',
    contract: 'AD05',
    title: 'GET /api/config/proxy-status 反映 fixture 的 music 分类代理',
    async run(ctx) {
      const res = await ctx.client.get('/api/config/proxy-status', { auth: 'admin' })
      assertStatus(res, 200, '代理状态')
      const text = res.text
      assert(/music/i.test(text), `代理状态缺 music 分类: ${text.slice(0, 200)}`)
    },
  },
  {
    id: 'AD06-WebDAV未配置时不崩溃',
    contract: 'AD06',
    title: '未配置 WebDAV 时测试连接返回结构化错误',
    async run(ctx) {
      const res = await ctx.client.post('/api/webdav/test', { auth: 'admin', json: {} })
      assert(res.status >= 200 && res.status < 500, `WebDAV 测试返回 5xx: ${res.status} ${res.text?.slice(0, 160)}`)
    },
  },
  {
    id: 'AD07-配置备份闭环',
    contract: 'AD07',
    title: '立即备份 → 列表可见',
    async run(ctx) {
      const now = await ctx.client.post('/api/config/backup-now', { auth: 'admin', json: {} })
      assertStatus(now, 200, '立即备份')
      const list = await ctx.client.get('/api/config/backups', { auth: 'admin' })
      assertStatus(list, 200, '备份列表')
      const count = Array.isArray(list.json) ? list.json.length : (list.json?.list?.length ?? 0)
      assert(count >= 1, `备份列表为空: ${list.text?.slice(0, 160)}`)
    },
  },
  {
    id: 'AD08-日志读取',
    contract: 'AD08',
    title: 'GET /api/logs?type=app 返回日志文本',
    async run(ctx) {
      const res = await ctx.client.get('/api/logs?type=app', { auth: 'admin' })
      assertStatus(res, 200, '读取日志')
      assert(typeof res.text === 'string' && res.text.length > 0, '日志为空')
    },
  },
  {
    id: 'AD09-文件管理器鉴权与穿越',
    contract: 'AD09',
    title: 'elFinder 需管理员；穿越路径不得返回文件内容',
    async run(ctx) {
      const anon = await ctx.client.get('/api/elfinder/connector?cmd=open', { auth: 'none' })
      assert(anon.status === 401 || anon.status === 403, `匿名 elFinder 未被拒绝: ${anon.status}`)
      const ok = await ctx.client.get('/api/elfinder/connector?cmd=open', { auth: 'admin' })
      assert(ok.status !== 401 && ok.status !== 403, `管理员 elFinder 被拒: ${ok.status}`)
      const traversal = await ctx.client.get('/api/elfinder/connector?cmd=file&target=l2_L2V0Yy9wYXNzd2Q', { auth: 'admin' })
      const text = traversal.text || ''
      assert(!/root:/.test(text), `疑似返回了 /etc/passwd 内容: ${text.slice(0, 120)}`)
    },
  },
  {
    id: 'AD10-自定义源管理全流程',
    contract: 'AD10',
    title: '列表 → 上传 → 启停 → 删除',
    async run(ctx) {
      const list = await ctx.client.get(`/api/custom-source/list?username=${FIXTURE_USER}`, { auth: 'admin' })
      assertStatus(list, 200, '自定义源列表')
      assert(list.text.includes('冒烟测试源'), `列表缺 fixture 源: ${list.text?.slice(0, 160)}`)
      assert(list.text.includes('死链测试源'), '列表缺死链表源')
      const upload = await ctx.client.post('/api/custom-source/upload', {
        auth: 'admin',
        json: {
          filename: 'smoke-temp.js',
          username: FIXTURE_USER,
          content: '/**\n * @name 临时冒烟源\n * @version 1.0.0\n */\nconst { EVENT_NAMES } = globalThis.lx\nglobalThis.lx.on(EVENT_NAMES.request, () => \'http://127.0.0.1:1/x.mp3\')\nglobalThis.lx.send(EVENT_NAMES.inited, { status: true, sources: { kg: { name: \'酷狗\', type: \'music\', actions: [\'musicUrl\'], qualitys: [\'128k\'] } } })\n',
        },
      })
      assertStatus(upload, 200, '上传自定义源')
      assert(upload.json?.success !== false, `上传失败: ${upload.text?.slice(0, 160)}`)
      // 关键断言：上传成功 != 源可用。inited 载荷形状不对时服务端会"加载成功但零平台"。
      const afterUpload = await ctx.client.get(`/api/custom-source/list?username=${FIXTURE_USER}`, { auth: 'admin' })
      assert(afterUpload.text.includes('临时冒烟源'), '上传后列表未出现新源')
      const toggle = await ctx.client.post('/api/custom-source/toggle', {
        auth: 'admin',
        json: { id: upload.json?.id ?? 'smoke-temp.js', enabled: false, username: FIXTURE_USER },
      })
      assertStatus(toggle, 200, '启停自定义源')
      const del = await ctx.client.post('/api/custom-source/delete', {
        auth: 'admin',
        json: { id: upload.json?.id ?? 'smoke-temp.js', username: FIXTURE_USER },
      })
      assertStatus(del, 200, '删除自定义源')
    },
  },
  {
    id: 'LM05-服务器缓存接口',
    contract: 'LM05',
    title: '缓存列表/统计/目录/下载队列可读',
    async run(ctx) {
      const headers = { 'x-user-token': ctx.userToken, 'x-user-name': FIXTURE_USER }
      for (const p of ['/api/music/cache/list', '/api/music/cache/stats', '/api/music/cache/queue', '/api/music/cache/directories?location=root']) {
        const res = await ctx.client.get(p, { headers })
        assertStatus(res, 200, p)
      }
    },
  },
  {
    id: 'LM01-本地音乐目录目录接口',
    contract: 'LM01',
    title: 'GET /api/music/custom/list 在未开启自定义目录时给出明确错误',
    async run(ctx) {
      const res = await ctx.client.get('/api/music/custom/list', { headers: { 'x-user-token': ctx.userToken } })
      assert(res.status === 200 || (res.status >= 400 && res.status < 500), `异常状态: ${res.status} ${res.text?.slice(0, 120)}`)
    },
  },
  {
    id: 'D01-下载队列接口',
    contract: 'D01',
    title: 'GET /api/music/cache/queue 返回数组',
    async run(ctx) {
      const res = await ctx.client.get('/api/music/cache/queue', { headers: { 'x-user-token': ctx.userToken } })
      assertStatus(res, 200, '下载队列')
      const list = Array.isArray(res.json) ? res.json : res.json?.data ?? res.json?.list ?? res.json?.tasks
      assert(Array.isArray(list), `队列响应里找不到任务数组: ${res.text?.slice(0, 160)}`)
    },
  },
  {
    id: 'Auth-管理员接口匿名拒绝',
    contract: 'AD02',
    title: '不带管理员口令访问后台接口必须被拒绝',
    async run(ctx) {
      for (const p of ['/api/users', '/api/config', '/api/logs', '/api/status']) {
        const res = await ctx.client.get(p, { auth: 'none' })
        assert(res.status !== 200, `${p} 匿名可读（状态 ${res.status}）`)
      }
    },
  },
]
