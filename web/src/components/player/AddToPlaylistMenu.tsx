import * as React from 'react'
import { ListPlus, Loader2, Plus } from 'lucide-react'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  useToast,
} from '@/components/ui'
import {
  addSongsToPlaylist,
  addSongsToUserPlaylist,
  createPlaylist,
  LIST_LOVE_ID,
  type Playlist,
} from '@/lib/lists'
import { useLists } from '@/lib/useLists'
import type { Song } from '@/lib/music'
import { cn } from '@/lib/utils'

/** 「加到歌单」菜单：把某首歌（或一组歌）放进**自建歌单**。
 *
 *  【为什么必须补这个｜2026-10-31】
 *  此前全站只有「收藏到我的收藏」（KeyboardShortcuts 的 L 键，写死 love 列表），
 *  没有任何入口能把歌放进自建歌单 —— 用户建好歌单后永远加不进歌，
 *  歌单永远是空的，看起来就像「歌单不能编辑」。
 *
 *  【为什么放在 SongList 行内而不是只放全局】加歌是「针对某一首」的操作，
 *  入口必须出现在曲目本身旁边；全局菜单无法表达「加哪首」。
 */
function AddToPlaylistMenu({
  songs,
  className,
  onDone,
}: {
  songs: Song[]
  className?: string
  onDone?: () => void
}) {
  const { toast } = useToast()
  const { snapshot, reload } = useLists()
  const [busy, setBusy] = React.useState<string | null>(null)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [newName, setNewName] = React.useState('')
  const [creating, setCreating] = React.useState(false)

  // 只列自建歌单（试听/收藏是内置列表，不在这里选）
  const playlists: Playlist[] = snapshot?.userList ?? []

  const addTo = React.useCallback(
    async (targetId: string, targetName: string, builtin = false) => {
      if (busy) return
      setBusy(targetId)
      try {
        if (builtin) {
          await addSongsToPlaylist(targetId, songs)
          toast({ title: '已收藏', description: `「${targetName}」+${songs.length} 首`, variant: 'success' })
        } else {
          const n = await addSongsToUserPlaylist(targetId, songs)
          if (n === 0) {
            toast({ title: '已在歌单里', description: `《${targetName}》中已有这${songs.length > 1 ? '些' : '首'}歌` })
          } else {
            toast({ title: '已加入歌单', description: `《${targetName}》+${n} 首`, variant: 'success' })
          }
        }
        await reload(true)
        onDone?.()
      } catch (e) {
        toast({
          title: '加入歌单失败',
          description: e instanceof Error ? e.message : '未知错误',
          variant: 'destructive',
        })
      } finally {
        setBusy(null)
      }
    },
    [busy, songs, toast, reload, onDone],
  )

  const submitCreate = async () => {
    const trimmed = newName.trim()
    if (!trimmed || creating) return
    setCreating(true)
    try {
      const id = await createPlaylist(trimmed)
      const n = await addSongsToUserPlaylist(id, songs)
      toast({
        title: '已新建并加入',
        description: `《${trimmed}》+${n} 首`,
        variant: 'success',
      })
      setCreateOpen(false)
      setNewName('')
      await reload(true)
      onDone?.()
    } catch (e) {
      toast({
        title: '新建歌单失败',
        description: e instanceof Error ? e.message : '未知错误',
        variant: 'destructive',
      })
    } finally {
      setCreating(false)
    }
  }

  const count = songs.length

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            aria-label={count > 1 ? `把选中的 ${count} 首加到歌单` : '加到歌单'}
            title="加到歌单"
            // pointer-events-auto：SongList 的视觉层整体是 pointer-events-none，
            // 交互元素必须显式抬起来，否则点击会穿透到整行的播放热区。
            className={cn(
              'pointer-events-auto flex size-9 items-center justify-center rounded-xl text-dim opacity-70 transition-all hover:bg-accent-soft hover:text-accent focus-visible:opacity-100 group-hover:opacity-100 active:scale-95',
              className,
            )}
          >
            <ListPlus className="size-4" />
          </button>
        </MenuTrigger>
        <MenuContent align="end" className="w-56">
          <MenuLabel>加到歌单</MenuLabel>
          {playlists.length === 0 && (
            <p className="px-2 pb-1 pt-0.5 text-xs leading-relaxed text-faint">
              还没有自建歌单，先新建一个。
            </p>
          )}
          {playlists.map((p) => (
            <MenuItem key={p.id} onSelect={() => void addTo(p.id, p.name)} disabled={busy !== null}>
              <span className="truncate">{p.name}</span>
              {busy === p.id ? (
                <Loader2 className="ml-auto size-3.5 animate-spin" />
              ) : (
                <span className="ml-auto text-[10px] text-faint">{p.songs.length}</span>
              )}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem onSelect={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            <span>新建歌单并加入</span>
          </MenuItem>
          {/* 我的收藏是内置列表，也放这里，方便和「加自建歌单」共用一个入口 */}
          <MenuItem onSelect={() => void addTo(LIST_LOVE_ID, '我的收藏', true)}>
            <span>加到「我的收藏」</span>
          </MenuItem>
        </MenuContent>
      </Menu>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建歌单</DialogTitle>
          </DialogHeader>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
            maxLength={60}
            placeholder="例如：深夜循环"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitCreate()
            }}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button" disabled={creating}>
                取消
              </Button>
            </DialogClose>
            <Button onClick={() => void submitCreate()} disabled={creating || !newName.trim()}>
              {creating ? '创建中…' : '创建并加入'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default AddToPlaylistMenu
