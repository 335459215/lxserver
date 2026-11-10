/**
 * 音源检测失败原因分类（v2.50.0）
 *
 * 【为什么需要这个东西】
 * 之前界面上失败只显示「不可用」三个字，真正的原因塞在 `title` 里 ——
 * 桌面端要悬停才知道，移动端根本触发不了。用户看到红标只能靠猜：
 * 是网络抽了一下？是作者跑路了？还是我哪里配错了？三种情况处理方式
 * 完全不同（重试 / 删掉 / 改设置），混成一个「不可用」等于什么都没说。
 *
 * 这里把上游五花八门的报错（DNS 失败、证书过期、429、卡密失效、
 * 源没返回 http 链接……）归成**用户能据此行动**的几类，每类给一句
 * 「能做什么」的建议。分类本身是纯函数，可单测。
 */

export type ProbeFailKind =
  | 'dns'          // 域名解析不了：作者换域名 / 服务下线
  | 'connect'      // 连不上：服务停了 / 被墙 / 本机网络
  | 'timeout'      // 超时：对方慢或不响应
  | 'http'         // 对方返回错误码
  | 'upstream'     // 上游限流 / 需鉴权
  | 'auth'         // 卡密 / 密钥失效
  | 'discontinued' // 作者主动停服（不是网络/配置问题）
  | 'notLoaded'    // 源未加载（脚本本身有问题）
  | 'badUrl'       // 源逻辑跑通但没给出可播放链接
  | 'unknown'

export interface ProbeFailInfo {
  kind: ProbeFailKind
  /** 徽章上显示的短标签（≤6 字） */
  label: string
  /** 一句话解释**
   *  「问题出在哪」 */
  reason: string
  /** 用户能做什么 */
  action: string
  /** 是否值得「过一会儿重试」 */
  retryable: boolean
}

const RULES: Array<{ test: RegExp; info: ProbeFailInfo }> = [
  {
    // getaddrinfo ENOTFOUND / EAI_AGAIN / NXDOMAIN
    test: /ENOTFOUND|EAI_AGAIN|NXDOMAIN|getaddrinfo|dns/i,
    info: {
      kind: 'dns',
      label: '域名失效',
      reason: '源的服务器域名已解析不到，通常是作者换了地址或服务已下线。',
      action: '换用其它音源，或去作者处获取新版本。',
      retryable: false,
    },
  },
  {
    test: /ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|socket hang up|EPIPE/i,
    info: {
      kind: 'connect',
      label: '无法连接',
      reason: '能解析到地址但连不上，对方服务已停止或不接受连接。',
      action: '可先重试一次；持续失败说明服务已停，换源。',
      retryable: true,
    },
  },
  {
    test: /超时|timeout|ETIMEDOUT|timed out/i,
    info: {
      kind: 'timeout',
      label: '响应超时',
      reason: '对方在规定时间内没有响应，可能是它自己慢，也可能是本机网络不畅。',
      action: '先重试；多次超时说明线路或对方服务有问题。',
      retryable: true,
    },
  },
  {
    // 429 / 403 / 5xx / upstream
    test: /\b(429|403|502|503|504)\b|too many requests|rate limit|限流|频繁|Forbidden/i,
    info: {
      kind: 'upstream',
      label: '被限流',
      reason: '对方的接口在限流或拒绝了本次请求（常见于共享聚合接口）。',
      action: '过几分钟再试；频繁出现说明该源已被大量使用。',
      retryable: true,
    },
  },
  {
    test: /卡密|密钥|授权|过期|激活|vip|会员|token|unauthor/i,
    info: {
      kind: 'auth',
      label: '授权失效',
      reason: '该源需要卡密 / 密钥 / 会员授权，当前授权已失效。',
      action: '续费或更换授权，否则换源。',
      retryable: false,
    },
  },
  {
    // 【实测补充】有的源作者直接在脚本里返回这句：
    //   「当前版本已停止服务，请升级到最新版本后重试」（长青SVIP 二改版、屿溪-终章）
    // 这句不属于网络/授权问题，是**作者主动停服**——用户唯一能做的是换新版本或换源，
    // 标成「可重试」会让人反复点检测，纯浪费。
    test: /已停止服务|停止服务|已停服|不再维护|已下线|停止运营|discontinued/i,
    info: {
      kind: 'discontinued',
      label: '作者停服',
      reason: '该源的作者已主动停止服务，不是网络或配置问题。',
      action: '去作者处下载最新版本，或直接换用其它音源。',
      retryable: false,
    },
  },
  {
    test: /未加载|not loaded|加载失败|failed to load|VM_DISABLED|VM 模式/i,
    info: {
      kind: 'notLoaded',
      label: '脚本未运行',
      reason: '脚本本身没有成功加载（语法错误、依赖缺失，或需要 VM 模式但被禁用）。',
      action: '在「音源」页打开「允许不安全 VM 模式」后重试，或检查脚本版本。',
      retryable: false,
    },
  },
  {
    test: /没有返回可用|no usable|invalid url|未返回|get url failed|failed to get url|获取链接失败/i,
    info: {
      kind: 'badUrl',
      label: '取链失败',
      reason: '脚本跑通了，但上游没给出可播放的直链（常因版权受限或接口改版）。',
      action: '换一首歌再试；若每首都这样，说明源已失效。',
      retryable: true,
    },
  },
]

const UNKNOWN: ProbeFailInfo = {
  kind: 'unknown',
  label: '不可用',
  reason: '检测失败，原因未能识别。',
  action: '先重试一次；仍失败可查看日志详情。',
  retryable: true,
}

/**
 * 把上游原始报错归成一类。
 * 传入空字符串也安全（返回 unknown），因为 `error` 可能压根没给。
 */
export function classifyProbeError(raw?: string | null): ProbeFailInfo {
  const s = (raw ?? '').trim()
  if (!s) return UNKNOWN
  for (const r of RULES) {
    if (r.test.test(s)) return r.info
  }
  // HTTP 4xx/5xx 兜底（放在限流之后，避免 429 被这里先吃掉）
  if (/\b(4\d\d|5\d\d)\b/.test(s)) {
    return {
      kind: 'http',
      label: '接口报错',
      reason: '对方的接口返回了错误状态码。',
      action: '先重试；持续报错说明源已失效，换源。',
      retryable: true,
    }
  }
  return UNKNOWN
}
