import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  initSessionStores,
  persistSession,
  unpersistSession,
  closeSessionStores,
} from '@/server/sessionStore'

// 会话层行为约定（阶段0）：
// - 启动回灌：Redis 优先；REDIS_URL 未配置或不可达时降级读磁盘快照，绝不"读空内存"
// - 快照/Redis 条目带 TTL 语义（登录时刻 + TTL 过期），回灌时剔除过期条目
// - persist/unpersist 变更经 3s 防抖写入快照，写前剔除过期条目（文件自清洁）

const DAY = 24 * 60 * 60 * 1000
let dataDir = ''
let snapshotFile = ''

const seedSnapshot = (payload: unknown) => {
  fs.mkdirSync(path.dirname(snapshotFile), { recursive: true })
  fs.writeFileSync(snapshotFile, JSON.stringify(payload), 'utf8')
}

const readSnapshot = (): any => JSON.parse(fs.readFileSync(snapshotFile, 'utf8'))

const waitSnapshotFlush = () => new Promise<void>((r) => setTimeout(r, 3300))

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-sess-'))
  snapshotFile = path.join(dataDir, 'runtime', 'sessions.json')
  ;(global as any).lx = { dataPath: dataDir }
  delete process.env.REDIS_URL
})

afterEach(async () => {
  await closeSessionStores()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('未配置 REDIS_URL：从磁盘快照回灌，剔除过期条目', async () => {
  const now = Date.now()
  seedSnapshot({
    version: 1,
    user: {
      freshToken: { username: 'yueyue', createdAt: now - 1000 },
      staleToken: { username: 'ghost', createdAt: now - 8 * DAY }, // 7 天 TTL 已过期
    },
    player: {
      freshPlayer: { createdAt: now - 1000 },
      stalePlayer: { createdAt: now - 25 * 3600_000 }, // 24 小时 TTL 已过期
    },
  })

  const user = new Map()
  const player = new Map()
  await initSessionStores({ user: { map: user, ttlSeconds: 7 * 86400 }, player: { map: player, ttlSeconds: 86400 } })

  assert.deepEqual([...user.keys()], ['freshToken'])
  assert.equal(user.get('freshToken')!.username, 'yueyue')
  assert.deepEqual([...player.keys()], ['freshPlayer'])
})

test('persist → 3s 防抖落盘；过期条目写快照时被剔除', async () => {
  const user = new Map()
  const player = new Map()
  await initSessionStores({ user: { map: user, ttlSeconds: 7 * 86400 }, player: { map: player, ttlSeconds: 86400 } })

  // 模拟上一轮遗留的过期会话残留在内存里
  user.set('stale', { username: 'ghost', createdAt: Date.now() - 8 * DAY })

  const value = { username: 'yueyue', createdAt: Date.now() }
  user.set('tok1', value)
  persistSession('user', 'tok1', value)

  await waitSnapshotFlush()
  const snap = readSnapshot()
  assert.equal(snap.user.tok1.username, 'yueyue')
  assert.equal(snap.user.stale, undefined, '过期条目不得进入快照')
  assert.ok(snap.savedAt)
})

test('unpersist → 快照同步移除', async () => {
  const user = new Map()
  await initSessionStores({ user: { map: user, ttlSeconds: 7 * 86400 }, player: { map: player0(), ttlSeconds: 86400 } })
  function player0() { return new Map() }

  const value = { username: 'yueyue', createdAt: Date.now() }
  user.set('tok1', value)
  persistSession('user', 'tok1', value)
  await waitSnapshotFlush()
  assert.ok(readSnapshot().user.tok1)

  user.delete('tok1')
  unpersistSession('user', 'tok1')
  await waitSnapshotFlush()
  assert.equal(readSnapshot().user.tok1, undefined)
})

test('REDIS_URL 不可达：降级读磁盘快照而不是空内存', async () => {
  seedSnapshot({
    version: 1,
    user: { tok: { username: 'yueyue', createdAt: Date.now() - 1000 } },
    player: {},
  })
  process.env.REDIS_URL = 'redis://127.0.0.1:1/0' // 立刻 ECONNREFUSED

  const user = new Map()
  const player = new Map()
  await initSessionStores({ user: { map: user, ttlSeconds: 7 * 86400 }, player: { map: player, ttlSeconds: 86400 } })

  assert.deepEqual([...user.keys()], ['tok'], 'Redis 不可达时必须从快照恢复会话')
})

test('快照损坏：按无快照处理，不抛异常', async () => {
  fs.mkdirSync(path.dirname(snapshotFile), { recursive: true })
  fs.writeFileSync(snapshotFile, '{broken json', 'utf8')

  const user = new Map()
  const player = new Map()
  await initSessionStores({ user: { map: user, ttlSeconds: 7 * 86400 }, player: { map: player, ttlSeconds: 86400 } })
  assert.equal(user.size, 0)
})
