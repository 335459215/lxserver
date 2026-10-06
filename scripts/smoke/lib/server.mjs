import { spawn } from 'node:child_process'
import path from 'node:path'
import { REPO_ROOT, TSX_CLI } from './paths.mjs'
import { ADMIN_PASSWORD } from './fixture.mjs'
import { log, sleep } from './util.mjs'

async function waitReady(baseUrl, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs
  let lastErr = null
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/music/config`, { signal: AbortSignal.timeout(3000) })
      if (res.status === 200) return true
      lastErr = new Error(`status ${res.status}`)
    } catch (err) {
      lastErr = err
    }
    await sleep(400)
  }
  throw new Error(`服务端 120s 内未就绪: ${lastErr?.message || lastErr}`)
}

/**
 * 用隔离 DATA_PATH 启动一份被测服务端（tsx 直跑 src/，不依赖已编译的 server/，
 * 这样冒烟测试永远测的是当前源码，而不是上次 build 的产物）。
 */
export async function startServer({ dataPath, logPath, port = 19527, mockPort = 19528, extraEnv = {} }) {
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DATA_PATH: dataPath,
    LOG_PATH: logPath,
    PORT: String(port),
    FRONTEND_PASSWORD: ADMIN_PASSWORD,
    ENABLE_WEBPLAYER_AUTH: 'false',
    WEBPLAYER_PASSWORD: '',
    SUBSONIC_ENABLE: 'false',
    WEBDAV_ENABLE: 'false',
    CONFIG_BACKUP_ENABLE: 'false',
    DISABLE_TELEMETRY: 'true',
    ENABLE_DEBUG: 'false',
    PROXY_MUSIC_ENABLED: 'true',
    PROXY_MUSIC_ADDRESS: `http://127.0.0.1:${mockPort}`,
    ...extraEnv,
  }

  const child = spawn(process.execPath, [TSX_CLI, 'src/index.ts'], {
    cwd: REPO_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const lines = []
  const push = (buf) => {
    for (const line of String(buf).split(/\r?\n/)) {
      if (line.trim()) lines.push(line)
    }
  }
  child.stdout.on('data', push)
  child.stderr.on('data', push)
  child.on('exit', (code) => lines.push(`[服务端退出] code=${code}`))

  const baseUrl = `http://127.0.0.1:${port}`
  await waitReady(baseUrl)
  log('dim', `被测服务端已就绪 ${baseUrl} (DATA_PATH=${dataPath})`)

  return {
    baseUrl,
    port,
    child,
    logs: lines,
    tailLogs: (n = 40) => lines.slice(-n),
    close: async () => {
      if (child.exitCode != null) return
      child.kill('SIGTERM')
      const deadline = Date.now() + 8000
      while (child.exitCode == null && Date.now() < deadline) await sleep(150)
      if (child.exitCode == null) {
        child.kill('SIGKILL')
        await sleep(300)
      }
      await sleep(300)
    },
  }
}

export const serverPath = (p) => path.join(REPO_ROOT, p)
