import musicSdkRaw from '@/modules/utils/musicSdk/index.js'
import { fetchRecommendedAlbums } from './recommendAlbums'

const musicSdk = musicSdkRaw as any

// 每日推荐歌曲缓存：按「自然日」刷新一次，当天内稳定（同一天多次请求共享结果），
// 次日自动换一批。QQ 抓取失败时回退到上次成功结果（即便已跨天），避免每日推荐空白。
const recommendSongsCache = new Map<string, { date: string, songs: any[] }>()
/** 每天从推荐专辑里取多少张来汇聚。
 *
 * 【v2.48.2 上调 8 → 24】原先只取 8 张，聚合去重后约 20 首 —— 太少，
 * 推荐算法（今日甄选）需要几十上百首候选才能按主题切出六张卡。
 * 实测 24 张能稳定拿到 100+ 首（多在古典/白噪音，由推荐层再过滤）。 */
const ALBUM_POOL = 24

/**
 * 获取每日推荐歌曲（歌曲级，区别于 recommendAlbums 的专辑级）。
 * 实现思路：复用已验证的推荐专辑接口(fetchRecommendedAlbums)拿到一批推荐专辑，
 * 再逐张调用 tx 平台的 getAlbumSongs 取出专辑内歌曲，去重、按日期做种子洗牌后返回。
 * 全部走公开接口，无需登录。
 * @param size 返回数量，默认 20，最大 100
 */
export const fetchRecommendedSongs = async (size = 20): Promise<any[]> => {
    // 【v2.48.2】上限从 100 提到 400：推荐层要几百首候选才能过滤+切六张卡。
    // 多取不增加上游请求（仍是 ALBUM_POOL 张专辑），只是少截断。
    const safeSize = Math.min(Math.max(parseInt(String(size)) || 20, 1), 400)
    const dateKey = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

    const cached = recommendSongsCache.get('daily')
    if (cached && cached.date === dateKey && cached.songs.length > 0) {
        return cached.songs.slice(0, safeSize)
    }

    try {
        const albums = await fetchRecommendedAlbums('random', 30)
        const mids = albums
            .map((a: any) => String(a.id || '').replace('alb_tx_', ''))
            .filter(Boolean)
            .slice(0, ALBUM_POOL)

        const songMap = new Map<string, any>()
        await Promise.all(mids.map(async (mid: string) => {
            try {
                const sdk = musicSdk?.tx?.extendDetail
                if (!sdk?.getAlbumSongs) return
                const data = await sdk.getAlbumSongs(mid)
                for (const s of data?.list || []) {
                    const songmid = s.songmid || s.mid
                    if (!songmid) continue
                    const id = `tx_${songmid}`
                    if (songMap.has(id)) continue
                    // filterMusicInfoItem 已是标准 LX.Music.MusicInfo，仅补齐 id(供 Subsonic 客户端定位/播放)
                    songMap.set(id, { ...s, id, source: 'tx' })
                }
            } catch (e) {
                console.error(`[歌曲推荐] 专辑 ${mid} 取歌失败:`, e)
            }
        }))

        let all = Array.from(songMap.values())

        // 按日期做种子的稳定洗牌：同一天结果一致，跨天自然变化
        let seed = 0
        for (const ch of dateKey) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0
        const rand = () => {
            seed = (seed * 1664525 + 1013904223) >>> 0
            return seed / 0xffffffff
        }
        for (let i = all.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1))
            ;[all[i], all[j]] = [all[j], all[i]]
        }

        recommendSongsCache.set('daily', { date: dateKey, songs: all })
        return all.slice(0, safeSize)
    } catch (e) {
        console.error('[歌曲推荐] 获取每日推荐歌曲出错:', e)
        // 抓取失败：回退到过期缓存（哪怕已跨天），避免每日推荐直接空白
        if (cached && cached.songs.length > 0) return cached.songs.slice(0, safeSize)
        return []
    }
}
