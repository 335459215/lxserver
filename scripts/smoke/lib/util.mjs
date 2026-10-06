import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function md5(input) {
  return crypto.createHash('md5').update(input).digest('hex')
}

/** userDir 命名必须与服务端 getUserDirname() 一致，否则 fixture 用户读不到自己的数据 */
export function userDirname(userName) {
  return `${userName}_${md5(userName).substring(0, 6)}`
}

export function makeTmpDir(prefix = 'lxsmoke-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

/** 1 秒 220Hz WAV，足够让 <audio> 真正出声（e2e 播放验证用） */
export function makeWav(seconds = 1, sampleRate = 8000, freq = 220) {
  const numSamples = Math.floor(seconds * sampleRate)
  const dataBytes = numSamples * 2
  const buf = Buffer.alloc(44 + dataBytes)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataBytes, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < numSamples; i++) {
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 8000), 44 + i * 2)
  }
  return buf
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function writeJson(file, data) {
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

const LEVELS = { info: '\x1b[36m', ok: '\x1b[32m', warn: '\x1b[33m', err: '\x1b[31m', dim: '\x1b[90m' }

export function log(level, ...args) {
  const color = LEVELS[level] ?? ''
  const reset = color ? '\x1b[0m' : ''
  const prefix = { info: '·', ok: '✓', warn: '!', err: '✗', dim: ' ' }[level] ?? '·'
  console.log(`${color}${prefix}${reset}`, ...args)
}

export function heading(text) {
  console.log(`\n\x1b[1m${text}\x1b[0m`)
}
