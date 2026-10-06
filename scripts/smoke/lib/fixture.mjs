import fs from 'node:fs'
import path from 'node:path'
import { FIXTURES_DIR } from './paths.mjs'
import { ensureDir, md5, userDirname, writeJson } from './util.mjs'

export const FIXTURE_USER = 'tester'
export const FIXTURE_PASSWORD = '123456'
export const ADMIN_PASSWORD = 'smoke-admin-pw'

const SONGS = [
  { name: '冒烟测试曲一', singer: '测试歌手', songmid: 'smoke1001', albumName: '冒烟专辑', albumId: 'smokealb1', interval: '03:30' },
  { name: '冒烟测试曲二', singer: '测试歌手&和声', songmid: 'smoke1002', albumName: '冒烟专辑', albumId: 'smokealb1', interval: '04:12' },
  { name: '冒烟测试曲三', singer: '另一位歌手', songmid: 'smoke1003', albumName: '另一张专辑', albumId: 'smokealb2', interval: '02:58' },
  { name: '冒烟测试曲四', singer: '测试歌手', songmid: 'smoke1004', albumName: '冒烟专辑', albumId: 'smokealb1', interval: '05:00' },
  { name: '冒烟测试曲五', singer: '合唱团', songmid: 'smoke1005', albumName: '现场专辑', albumId: 'smokealb3', interval: '03:03' },
]

function song(s, source = 'kw') {
  return {
    name: s.name,
    singer: s.singer,
    source,
    songmid: s.songmid,
    albumId: s.albumId,
    albumName: s.albumName,
    interval: s.interval,
    img: null,
    lrc: null,
    otherSource: null,
    types: [{ type: '128k', size: '3.50MB' }, { type: '320k', size: '8.80MB' }, { type: 'flac', size: '24.10MB' }],
    _types: {},
    typeUrl: {},
  }
}

function readTemplate(name) {
  return fs.readFileSync(path.join(FIXTURES_DIR, 'sources', name), 'utf-8')
}

/**
 * 在 target 下建一份可重复使用的隔离 data 目录。
 * fixture 会被复制到临时目录后再启动服务端，测试结束后整体删除 —— 线上 data/ 永远不被触碰。
 */
export function buildFixtureData(target, { audioBase } = {}) {
  ensureDir(target)

  writeJson(path.join(target, 'users.json'), [{
    name: FIXTURE_USER,
    password: FIXTURE_PASSWORD,
    maxSnapshotNum: 10,
    'list.addMusicLocationType': 'top',
  }])

  const userDir = path.join(target, 'users', userDirname(FIXTURE_USER))
  ensureDir(userDir)

  // 用户播放偏好（只放会影响测试的键，其余由服务端给默认值）
  writeJson(path.join(userDir, 'settings.json'), {
    defaultEntry: 'search',
    itemsPerPage: 20,
    preferredQuality: '320k',
    downloadConcurrency: 3,
    saveAccountSettingsToFile: true,
    enableServerCache: false,
    enableOnlyDownloadMode: false,
  })

  writeJson(path.join(userDir, 'soundEffects.json'), {
    settings: {
      eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      pitch: 1,
      panner: { enable: false, speed: 25, distance: 5 },
      reverb: { id: 'none', mainGain: 1, sendGain: 0 },
    },
    customPresets: [],
  })

  // 歌单：current data = latest snapshot（LX 同步服务端的设计）
  const defaultSongs = SONGS.map((s) => song(s))
  const loveSongs = [song(SONGS[2])]
  const userList = [{
    id: 'smokelist1',
    name: '冒烟歌单',
    source: 'kw',
    list: [song(SONGS[0]), song(SONGS[3])],
    addMusicTime: Date.now(),
  }]
  const listData = { defaultList: defaultSongs, loveList: loveSongs, userList }
  const listJson = JSON.stringify(listData)
  const listKey = md5(listJson)
  ensureDir(path.join(userDir, 'list', 'snapshot'))
  fs.writeFileSync(path.join(userDir, 'list', 'snapshot', `snapshot_${listKey}`), listJson)
  writeJson(path.join(userDir, 'list', 'snapshot', 'snapshotInfo.json'), {
    latest: listKey,
    time: Date.now(),
    list: [],
    clients: {},
  })

  const dislikeData = { dislikeList: [] }
  const dislikeJson = JSON.stringify(dislikeData)
  const dislikeKey = md5(dislikeJson)
  ensureDir(path.join(userDir, 'dislike', 'snapshot'))
  fs.writeFileSync(path.join(userDir, 'dislike', 'snapshot', `snapshot_${dislikeKey}`), dislikeJson)
  writeJson(path.join(userDir, 'dislike', 'snapshot', 'snapshotInfo.json'), {
    latest: dislikeKey,
    time: Date.now(),
    list: [],
    clients: {},
  })

  // 自定义源：私有给 fixture 用户；mock-kw 排序在前，mock-dead 在后（验证死链会被筛掉）
  const sourceDir = path.join(target, 'users', 'source', FIXTURE_USER)
  ensureDir(sourceDir)
  const audioBaseResolved = audioBase || 'http://127.0.0.1:19528'
  const sources = [
    {
      id: 'mock-kw.js',
      name: '冒烟测试源',
      version: '1.0.0',
      author: 'smoke-fixture',
      description: '确定性 mock 源',
      homepage: '',
      size: 0,
      supportedSources: ['kw', 'tx'],
      enabled: true,
      uploadTime: new Date().toISOString(),
      allowUnsafeVM: false,
      requireUnsafe: false,
    },
    {
      id: 'mock-dead.js',
      name: '死链测试源',
      version: '1.0.0',
      author: 'smoke-fixture',
      description: '永远返回死链的 mock 源',
      homepage: '',
      size: 0,
      supportedSources: ['kw'],
      enabled: true,
      uploadTime: new Date().toISOString(),
      allowUnsafeVM: false,
      requireUnsafe: false,
    },
  ].map((s) => ({ ...s, size: 1 }))
  writeJson(path.join(sourceDir, 'sources.json'), sources)
  writeJson(path.join(sourceDir, 'states.json'), {})
  writeJson(path.join(sourceDir, 'order.json'), ['mock-kw.js', 'mock-dead.js'])
  fs.writeFileSync(path.join(sourceDir, 'mock-kw.js'), readTemplate('mock-kw.js').replace('__AUDIO_BASE__', audioBaseResolved))
  fs.writeFileSync(path.join(sourceDir, 'mock-dead.js'), readTemplate('mock-dead.js'))

  // 公开源目录留个空 order，避免私有排序回退时读出意外内容
  const openSourceDir = path.join(target, 'users', 'source', '_open')
  ensureDir(openSourceDir)
  writeJson(path.join(openSourceDir, 'order.json'), [])

  return target
}
