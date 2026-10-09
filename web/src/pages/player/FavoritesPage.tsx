import PlaylistView from '@/components/player/PlaylistView'
import { LIST_LOVE_ID } from '@/lib/lists'

/** 我的收藏（/favorites）：就是内置的 loveList，复用歌单详情视图。 */
export default function FavoritesPage() {
  return <PlaylistView listId={LIST_LOVE_ID} backTo="/playlist" />
}
