import { useParams } from 'react-router-dom'
import PlaylistView from '@/components/player/PlaylistView'

/** 歌单详情（/playlist/:id）：id 为 'default' / 'love' / 用户歌单 id。
 *  真实数据由 PlaylistView 读取（/api/user/list）。 */
export default function PlaylistDetailPage() {
  const { id } = useParams()
  return <PlaylistView listId={id ?? ''} backTo="/playlist" />
}
