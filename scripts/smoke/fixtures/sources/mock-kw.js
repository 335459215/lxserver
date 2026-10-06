/**
 * @name 冒烟测试源
 * @description 确定性 mock 自定义源：为 kw/tx 平台的 songmid 返回本地音频地址。仅供 scripts/smoke 冒烟测试使用。
 * @version 1.0.0
 * @author smoke-fixture
 * @description:zh 冒烟测试专用源，不联网
 */
const { EVENT_NAMES } = globalThis.lx
const AUDIO_BASE = '__AUDIO_BASE__'

globalThis.lx.on(EVENT_NAMES.request, ({ action, source, info }) => {
  if (action !== 'musicUrl') throw new Error('unsupported action: ' + action)
  const musicInfo = info.musicInfo || {}
  const songmid = musicInfo.songmid || musicInfo.hash || musicInfo.copyrightId || 'unknown'
  const quality = info.quality || info.type || '128k'
  return `${AUDIO_BASE}/audio/${encodeURIComponent(songmid)}_${quality}.wav`
})

// 注意：本服务端的 lx.send 是 (eventName, data) 两参形式（customSourceHandlers.ts:63 的报错文案亦然）。
// 写成 lx.send('inited', null, {...}) 会让 sources 静默丢失：源"加载成功"但零平台，
// 且自愈逻辑会把 sources.json 里的 supportedSources 覆写成 []。
globalThis.lx.send(EVENT_NAMES.inited, {
  status: true,
  openDevTools: false,
  sources: {
    kw: { name: '酷我', type: 'music', actions: ['musicUrl'], qualitys: ['128k', '320k', 'flac'] },
    tx: { name: 'QQ音乐', type: 'music', actions: ['musicUrl'], qualitys: ['128k', '320k', 'flac'] },
  },
})
