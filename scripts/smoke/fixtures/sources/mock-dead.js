/**
 * @name 死链测试源
 * @description 永远返回不可用链接的 mock 源，用于验证竞速胜负裁决不看"脚本是否抛异常"而看链接是否真的可播。仅供 scripts/smoke 使用。
 * @version 1.0.0
 * @author smoke-fixture
 */
const { EVENT_NAMES } = globalThis.lx

globalThis.lx.on(EVENT_NAMES.request, ({ action, source, info }) => {
  if (action !== 'musicUrl') throw new Error('unsupported action: ' + action)
  // 127.0.0.1:1 必然拒连，深探测会立刻失败
  return 'http://127.0.0.1:1/dead.mp3'
})

globalThis.lx.send(EVENT_NAMES.inited, {
  status: true,
  openDevTools: false,
  sources: {
    kw: { name: '酷我', type: 'music', actions: ['musicUrl'], qualitys: ['128k'] },
  },
})
