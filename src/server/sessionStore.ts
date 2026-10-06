import fs from 'node:fs'
import path from 'node:path'
import Redis from 'ioredis'
import { startupLog } from '@/utils/log4js'

// ===== Redis 会话层（阶段0：userSessions / playerSessions 迁出"仅进程内"）=====
//
// 职责边界（关键设计，别改回去了）：
// - 校验路径保持同步读内存。verifyUserAuth / checkPlayerAuth 是同步签名，调用点
//   遍布全文件；会话的 Map 留在 server.ts，本模块只做两件事：启动时把持久层的
//   会话"回灌"进 Map，和把增删写回持久层。Redis 抖动只影响"重启后能否恢复登录"，
//   永远不在请求热路径上。
// - Redis 主存：SET key value EX ttl，全键带 TTL（与内存语义一致：登录时刻 + TTL
//   过期，无续期）。key 规划 lx:sess:user:<token> / lx:sess:player:<sessionId>。
// - 磁盘快照兜底（data/runtime/sessions.json）：Redis 不可达时启动降级读它——
//   读空内存等于 Redis 一抖全站掉线；未配置 REDIS_URL 时纯快照模式也能解决
//   容器重启掉线（快照在 data 卷里，随容器存续）。
// - 自愈：Redis 可达但为空（infra-redis 被重建/误 flush）而本地快照还有有效会话
//   时，把快照回灌 Redis，避免全员重新登录。
// - persistentTokens（用户 API Token）有意不迁 Redis：它本来就落盘于
//   data/users/<user>/token.json 且启动重载，已满足"重启不掉"；长期凭据写入
//   多应用共享的 Redis 是安全降级，保持文件为唯一存储。

type UserSessionValue = { username: string; createdAt: number }
type PlayerSessionValue = { createdAt: number }

interface StoreTarget<V> {
  map: Map<string, V>
  ttlSeconds: number
}

const KEY_PREFIX = { user: 'lx:sess:user:', player: 'lx:sess:player:' } as const
export type SessionStoreName = keyof typeof KEY_PREFIX

const SNAPSHOT_DEBOUNCE_MS = 3000
const REDIS_LOG_THROTTLE_MS = 60_000
const MGET_BATCH = 500

let stores: Record<SessionStoreName, StoreTarget<any>> | null = null
let redis: Redis | null = null
let snapshotPath = ''
let snapshotTimer: NodeJS.Timeout | null = null
let lastRedisWarnAt = 0

const warnThrottled = (msg: string) => {
  if (Date.now() - lastRedisWarnAt < REDIS_LOG_THROTTLE_MS) return
  lastRedisWarnAt = Date.now()
  startupLog.warn(msg)
}

const redisReady = (): boolean => !!redis && redis.status === 'ready'

const setRedis = async (key: string, value: string, ttlSeconds: number): Promise<boolean> => {
  if (!redisReady()) return false
  try {
    await redis!.set(key, value, 'EX', ttlSeconds)
    return true
  } catch (e: any) {
    warnThrottled(`[会话层] Redis 写入失败（本地内存仍有效）: ${e.message}`)
    return false
  }
}

const delRedis = async (key: string): Promise<void> => {
  if (!redisReady()) return
  try {
    await redis!.del(key)
  } catch (e: any) {
    warnThrottled(`[会话层] Redis 删除失败: ${e.message}`)
  }
}

/** 快照内容直接从内存 Map 序列化，并顺手丢掉已过期条目（文件自清洁） */
const writeSnapshot = () => {
  snapshotTimer = null
  if (!stores || !snapshotPath) return
  try {
    const dir = path.dirname(snapshotPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const now = Date.now()
    const dump = (store: StoreTarget<any>) => {
      const out: Record<string, unknown> = {}
      for (const [id, v] of store.map) {
        if (v && typeof v.createdAt === 'number' && now - v.createdAt <= store.ttlSeconds * 1000) {
          out[id] = v
        }
      }
      return out
    }
    const payload = {
      version: 1,
      savedAt: new Date().toISOString(),
      user: dump(stores.user),
      player: dump(stores.player),
    }
    const tmp = `${snapshotPath}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8')
    fs.renameSync(tmp, snapshotPath)
  } catch (e: any) {
    startupLog.warn(`[会话层] 会话快照写盘失败: ${e.message}`)
  }
}

/** 增删后 3s 防抖写快照；高频登录/登出只落一次盘。清理过期会话后也调用它让快照瘦身 */
export const scheduleSnapshotWrite = () => {
  if (!snapshotPath || snapshotTimer) return
  snapshotTimer = setTimeout(writeSnapshot, SNAPSHOT_DEBOUNCE_MS)
  snapshotTimer.unref?.()
}

const isFresh = (v: any, ttlSeconds: number): boolean =>
  !!v && typeof v.createdAt === 'number' && Date.now() - v.createdAt <= ttlSeconds * 1000

/** 从磁盘快照回灌 Map（丢过期），返回恢复数量 */
const loadFromSnapshot = (): { user: number; player: number } => {
  const stats = { user: 0, player: 0 }
  if (!stores) return stats
  try {
    if (!fs.existsSync(snapshotPath)) return stats
    const raw = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))
    for (const [id, v] of Object.entries(raw?.user ?? {})) {
      if (isFresh(v, stores.user.ttlSeconds) && typeof (v as UserSessionValue).username === 'string') {
        stores.user.map.set(id, v as UserSessionValue)
        stats.user++
      }
    }
    for (const [id, v] of Object.entries(raw?.player ?? {})) {
      if (isFresh(v, stores.player.ttlSeconds)) {
        stores.player.map.set(id, v as PlayerSessionValue)
        stats.player++
      }
    }
  } catch (e: any) {
    startupLog.warn(`[会话层] 会话快照读取失败（按无快照处理）: ${e.message}`)
  }
  return stats
}

const scanSessionKeys = async (): Promise<string[]> => {
  const keys: string[] = []
  let cursor = '0'
  do {
    const [next, batch] = await redis!.scan(cursor, 'MATCH', 'lx:sess:*', 'COUNT', 200)
    cursor = next
    if (batch.length) keys.push(...batch)
  } while (cursor !== '0')
  return keys
}

/**
 * 启动回灌。在 startServer 最前面 await：
 * - 配置 REDIS_URL：连 Redis（3s 超时上限，连不上不阻塞上线）→ SCAN + MGET 回灌；
 *   Redis 为空但快照有有效会话时反向自愈进 Redis。
 * - 未配置：纯磁盘快照模式。
 * 连不上 Redis 时降级读快照——不读空内存，否则 Redis 一抖全站掉线。
 */
export const initSessionStores = async (targets: {
  user: StoreTarget<UserSessionValue>
  player: StoreTarget<PlayerSessionValue>
}): Promise<void> => {
  stores = targets
  snapshotPath = global.lx?.dataPath ? path.join(global.lx.dataPath, 'runtime', 'sessions.json') : ''
  // 进程正常退出前把挂起的防抖快照落盘（writeSnapshot 是同步的，exit 钩子里可执行）
  process.once('exit', () => {
    if (snapshotTimer) writeSnapshot()
  })

  const url = (process.env.REDIS_URL || '').trim()
  if (!url) {
    const stats = loadFromSnapshot()
    startupLog.info(`[会话层] 未配置 REDIS_URL，磁盘快照模式：恢复用户会话 ${stats.user} / 播放器会话 ${stats.player}（重启不再掉线；如需多实例共享请配置 REDIS_URL）`)
    return
  }

  try {
    redis = new Redis(url, {
      lazyConnect: true,
      connectTimeout: 3000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      // 后台重连退避：断连后每 2s 重试，封顶 15s；请求侧不等重连（fail-soft）
      retryStrategy: (times: number) => Math.min(times * 2000, 15000),
    })
    // ioredis 没有 error 监听器会把错误抛成 uncaughtException；这里统一吞掉，
    // 具体失败由调用点降级并打节流日志
    redis.on('error', () => {})
    await redis.connect().catch(() => {})
  } catch (e: any) {
    startupLog.warn(`[会话层] Redis 初始化失败: ${e.message}`)
    redis = null
  }

  if (!redisReady()) {
    const stats = loadFromSnapshot()
    startupLog.warn(`[会话层] Redis 不可达，降级磁盘快照：恢复用户会话 ${stats.user} / 播放器会话 ${stats.player}`)
    return
  }

  try {
    const client = redis!
    const keys = await scanSessionKeys()
    let userCount = 0
    let playerCount = 0
    for (let i = 0; i < keys.length; i += MGET_BATCH) {
      const batch = keys.slice(i, i + MGET_BATCH)
      const values: Array<string | null> = await client.mget(...batch)
      batch.forEach((key, idx) => {
        const raw = values[idx]
        if (!raw) return
        let parsed: any
        try {
          parsed = JSON.parse(raw)
        } catch {
          return
        }
        if (key.startsWith(KEY_PREFIX.user)) {
          if (isFresh(parsed, stores!.user.ttlSeconds) && typeof parsed.username === 'string') {
            stores!.user.map.set(key.slice(KEY_PREFIX.user.length), parsed as UserSessionValue)
            userCount++
          }
        } else if (key.startsWith(KEY_PREFIX.player)) {
          if (isFresh(parsed, stores!.player.ttlSeconds)) {
            stores!.player.map.set(key.slice(KEY_PREFIX.player.length), parsed as PlayerSessionValue)
            playerCount++
          }
        }
      })
    }
    if (userCount + playerCount > 0) {
      startupLog.info(`[会话层] Redis 已连接，恢复用户会话 ${userCount} / 播放器会话 ${playerCount}`)
      return
    }
    // Redis 空（实例被重建/flush）：快照里还有效的会话反向回灌，避免全员重新登录
    const stats = loadFromSnapshot()
    if (stats.user + stats.player > 0) {
      const backfill: Array<Promise<unknown>> = []
      for (const [id, v] of stores.user.map) backfill.push(setRedis(KEY_PREFIX.user + id, JSON.stringify(v), stores.user.ttlSeconds))
      for (const [id, v] of stores.player.map) backfill.push(setRedis(KEY_PREFIX.player + id, JSON.stringify(v), stores.player.ttlSeconds))
      await Promise.allSettled(backfill)
      startupLog.info(`[会话层] Redis 为空，已从磁盘快照自愈：用户会话 ${stats.user} / 播放器会话 ${stats.player}`)
    } else {
      startupLog.info('[会话层] Redis 已连接，当前无会话')
    }
  } catch (e: any) {
    const stats = loadFromSnapshot()
    startupLog.warn(`[会话层] Redis 读取失败（${e.message}），降级磁盘快照：恢复用户会话 ${stats.user} / 播放器会话 ${stats.player}`)
  }
}

/** 登录/颁发会话后调用：写 Redis（带 TTL）+ 排期快照。Map 的 set 由调用方完成 */
export const persistSession = (store: SessionStoreName, id: string, value: unknown): void => {
  const target = stores?.[store]
  if (!target) return // init 之前不应有会话产生；防御性忽略
  void setRedis(KEY_PREFIX[store] + id, JSON.stringify(value), target.ttlSeconds)
  scheduleSnapshotWrite()
}

/** 登出/注销会话后调用。Map 的 delete 由调用方完成 */
export const unpersistSession = (store: SessionStoreName, id: string): void => {
  if (!stores?.[store]) return
  void delRedis(KEY_PREFIX[store] + id)
  scheduleSnapshotWrite()
}

/** 停机/测试收尾：快照立即落盘并断开 Redis */
export const closeSessionStores = async (): Promise<void> => {
  if (snapshotTimer) writeSnapshot()
  if (redis) {
    const client = redis
    redis = null
    try {
      await client.quit()
    } catch {
      client.disconnect()
    }
  }
}
