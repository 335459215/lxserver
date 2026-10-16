// import '../../polyfill/array.find'

import { httpFetch } from '../../request'
import { formatPlayTime, decodeName } from '../../index'
// import { debug } from '../../utils/env'
import { formatSinger, formatPic } from './util'

export default {
  regExps: {
    mInfo: /level:(\w+),bitrate:(\d+),format:(\w+),size:([\w.]+)/,
  },
  limit: 30,
  total: 0,
  page: 0,
  allPage: 1,
  // cancelFn: null,
  musicSearch(str, page, limit) {
    const musicSearchRequestObj = httpFetch(`http://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(str)}&pn=${page - 1}&rn=${limit}&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1&newver=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1`)
    return musicSearchRequestObj.promise
  },
  // getImg(songId) {
  //   return httpGet(`http://player.kuwo.cn/webmusic/sj/dtflagdate?flag=6&rid=MUSIC_${songId}`)
  // },
  // getLrc(songId) {
  //   return httpGet(`http://mobile.kuwo.cn/mpage/html5/songinfoandlrc?mid=${songId}&flag=0`)
  // },
  handleResult(rawData) {
    const result = []
    if (!rawData) return result
    // console.log(rawData)
    for (let i = 0; i < rawData.length; i++) {
      const info = rawData[i]
      let songId = info.MUSICRID.replace('MUSIC_', '')
      // const format = (info.FORMATS || info.formats).split('|')

      if (!info.N_MINFO) {
        console.log('N_MINFO is undefined')
        return null
      }

      const types = []
      const _types = {}

      let infoArr = info.N_MINFO.split(';')
      for (let info of infoArr) {
        info = info.match(this.regExps.mInfo)
        if (info) {
          switch (info[2]) {
            case '4000':
              types.push({ type: 'flac24bit', size: info[4] })
              _types.flac24bit = {
                size: info[4].toLocaleUpperCase(),
              }
              break
            case '2000':
              types.push({ type: 'flac', size: info[4] })
              _types.flac = {
                size: info[4].toLocaleUpperCase(),
              }
              break
            case '320':
              types.push({ type: '320k', size: info[4] })
              _types['320k'] = {
                size: info[4].toLocaleUpperCase(),
              }
              break
            case '128':
              types.push({ type: '128k', size: info[4] })
              _types['128k'] = {
                size: info[4].toLocaleUpperCase(),
              }
              break
          }
        }
      }
      types.reverse()

      let interval = parseInt(info.DURATION)

      result.push({
        name: decodeName(info.SONGNAME),
        singer: formatSinger(decodeName(info.ARTIST)),
        source: 'kw',
        // img = (info.album.name === '' || info.album.name === '空')
        //   ? `http://player.kuwo.cn/webmusic/sj/dtflagdate?flag=6&rid=MUSIC_160911.jpg`
        //   : `https://y.gtimg.cn/music/photo_new/T002R500x500M000${info.album.mid}.jpg`
        songmid: songId,
        albumId: decodeName(info.ALBUMID || ''),
        interval: Number.isNaN(interval) ? 0 : formatPlayTime(interval),
        albumName: info.ALBUM ? decodeName(info.ALBUM) : '',
        lrc: null,
        img: formatPic(info.prob_albumpic || (info.web_albumpic_short ? `https://img4.kuwo.cn/star/albumcover/1000${info.web_albumpic_short}` : null)),
        otherSource: null,
        types,
        _types,
        typeUrl: {},
      })
    }
    // console.log(result)
    return result
  },
  search(str, page = 1, limit, retryNum = 0) {
    if (limit == null) limit = this.limit
    // http://newlyric.kuwo.cn/newlyric.lrc?62355680
    return this.musicSearch(str, page, limit).then(({ body: result }) => {
      // console.log(result)
      // 【D-004】越界页不是错误，是「没有更多了」。
      //
      // 旧逻辑把「有总数但本页 0 条」当成需要重试的失败，重试 3 次后
      // `throw new Error('try max num')`，服务端 catch 直接回 500 ——
      // 用户翻到最后一页之后再翻，看到的是「搜索坏了」。
      // 前端预取（末页后自动再拉 3 页）必然撞上，所以这不是边角情况。
      //
      // 正确语义：TOTAL === '0'（本来就没有）或 SHOW === '0'（本页为空）
      // 都返回空列表，让翻页自然结束。
      if (!result || result.TOTAL === '0' || result.SHOW === '0') {
        this.total = parseInt(result?.TOTAL ?? '0') || 0
        this.page = page
        return { list: [], total: this.total, page, limit, source: 'kw' }
      }
      let list = this.handleResult(result.abslist)

      // 解析不出结果仍可重试，但要有上限：超过上限返回空列表而不是抛错，
      // 否则同样的 500 会从这条路径复现。
      if (list == null) {
        if (retryNum > 2) return { list: [], total: 0, page, limit, source: 'kw' }
        return this.search(str, page, limit, ++retryNum)
      }

      this.total = parseInt(result.TOTAL)
      this.page = page
      this.allPage = Math.ceil(this.total / limit)

      return Promise.resolve({
        list,
        allPage: this.allPage,
        total: this.total,
        limit,
        source: 'kw',
      })
    })
  },
}
