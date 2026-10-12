import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

// ===== 服务端签名密钥（v2.25.0）=====
//
// 【为什么要有这个文件】
// Subsonic 的转码票据（`transcodeParams`）与电台票据需要一把 HMAC 密钥来防篡改。
// 此前这把密钥直接借用了 `frontend.password`（部署管理密码）：
//
//     function serverTicketSecret() {
//       return String(global.lx.config?.['frontend.password'] || processRandomSecret)
//     }
//
// v2.25.0 把 `frontend.password` 彻底删除（管理员改为账号属性），
// 这把密钥就必须有自己的来源 —— 否则只能退回「进程级随机」，
// 而那会让**每次重启后此前签发的票据全部失效**（正在播放的客户端突然报错）。
//
// 【为什么是「落盘的随机密钥」而不是「硬编码常量」或「配置文件字段」】
//   - 硬编码常量：任何人拿到源码就能伪造票据（转码参数里有码率/格式等，可被滥用）；
//   - 配置文件字段：又要用户在设置界面里理解并维护一个「服务端密钥」，
//     而它对用户没有任何意义 —— 这正是本次要删掉的那类设计；
//   - 落盘随机密钥：首次启动自动生成 32 字节随机值写进数据目录，
//     重启后读回同一个值 → 票据跨重启有效，且用户完全不需要感知它。
//
// 【为什么放在 runtime 子目录】
// 它是**运行时状态**而非用户配置：不该出现在「设置」界面、不该被配置导入导出带走
// （换机器时生成新的即可，旧票据失效无妨）、也不该进 WebDAV 备份。
// `data/runtime/` 在 .gitignore 内，且已被 sessions.json 等运行时文件使用。

const SECRET_FILE = 'server-secret'

/** 进程级兜底：落盘失败时（如只读文件系统）仍要有一把可用密钥 */
const processRandomSecret = crypto.randomBytes(32).toString('hex')

let cachedSecret: string | null = null

/**
 * 取服务端签名密钥。首次调用时生成并落盘，之后一直复用。
 *
 * 注意：本函数在**每次签名/验签**时都会被调用（Subsonic 请求量大），
 * 所以走内存缓存，不重复读盘。
 */
export const getServerSecret = (): string => {
  if (cachedSecret) return cachedSecret

  try {
    // 与 scheduler.ts / sessionStore.ts / serverDownloadQueue.ts 同一约定：
    // 运行时状态统一放 `global.lx.dataPath/runtime`。
    // webdavSync.ts 已把 `runtime/` 排除在备份之外（换机器时生成新密钥即可）。
    const base = global.lx?.dataPath || process.cwd()
    const runtimeDir = path.join(base, 'runtime')
    const file = path.join(runtimeDir, SECRET_FILE)

    if (fs.existsSync(file)) {
      const existing = fs.readFileSync(file, 'utf8').trim()
      // 长度校验：空文件/被截断的密钥会让签名强度归零，视同不存在并重新生成
      if (existing.length >= 32) {
        cachedSecret = existing
        return cachedSecret
      }
    }

    const secret = crypto.randomBytes(32).toString('hex')
    fs.mkdirSync(runtimeDir, { recursive: true })
    // mode 0o600：同机其它用户不应读到它（容器里通常只有 root，属纵深防御）
    fs.writeFileSync(file, secret, { encoding: 'utf8', mode: 0o600 })
    cachedSecret = secret
    return cachedSecret
  } catch (e) {
    // 落盘失败不能阻断启动：退化成进程级随机密钥。
    // 后果仅是「重启后旧票据失效」，比整个服务起不来轻得多。
    console.error('[服务端密钥] 落盘失败，本次运行使用进程级随机密钥（重启后旧票据失效）:', e)
    cachedSecret = processRandomSecret
    return cachedSecret
  }
}

/** 仅供测试：清掉内存缓存，让下次调用重新走落盘逻辑 */
export const __resetServerSecretCache = (): void => {
  cachedSecret = null
}
