import { arrPush, arrPushByPosition, arrUnshift } from '@/utils/common'
import { LIST_IDS } from '@/constants'
import { type SnapshotDataManage } from './snapshotDataManage'

export class ListDataManage {
  snapshotDataManage: SnapshotDataManage
  userLists: LX.List.UserListInfo[] = []
  allMusicList = new Map<string, LX.Music.MusicInfo[]>()
  /** v2.44.0 内置列表元信息（名字 / 是否已删除）。
   *  旧快照没有这两个字段 → 默认 `{}`，即「用默认名、未删除」，老数据不受影响。 */
  defaultMeta: LX.List.BuiltinListMeta = {}
  loveMeta: LX.List.BuiltinListMeta = {}
  initPromise: Promise<void>

  constructor(snapshotDataManage: SnapshotDataManage) {
    this.snapshotDataManage = snapshotDataManage

    let listData: LX.Sync.List.ListData | null
    this.initPromise = this.snapshotDataManage.getSnapshotInfo().then(async (snapshotInfo) => {
      if (snapshotInfo.latest) listData = await this.snapshotDataManage.getSnapshot(snapshotInfo.latest)
      if (!listData) listData = { defaultList: [], loveList: [], userList: [] }
      this.allMusicList.set(LIST_IDS.DEFAULT, listData.defaultList)
      this.allMusicList.set(LIST_IDS.LOVE, listData.loveList)
      this.defaultMeta = { ...(listData.defaultMeta ?? {}) }
      this.loveMeta = { ...(listData.loveMeta ?? {}) }
      this.userLists.push(...listData.userList.map(({ list, ...l }) => {
        this.allMusicList.set(l.id, list)
        return l
      }))
    })
  }
  restore = async (listData: LX.Sync.List.ListData) => {
    this.allMusicList.clear()
    this.userLists = []

    this.allMusicList.set(LIST_IDS.DEFAULT, listData.defaultList)
    this.allMusicList.set(LIST_IDS.LOVE, listData.loveList)
    // 内置列表的「名字 / 已删除」随快照持久化：缺字段 = 默认名、未删除（兼容旧快照）
    this.defaultMeta = { ...(listData.defaultMeta ?? {}) }
    this.loveMeta = { ...(listData.loveMeta ?? {}) }
    this.userLists.push(...listData.userList.map(({ list, ...l }) => {
      this.allMusicList.set(l.id, list)
      return l
    }))
  }
  getListData = async (): Promise<LX.Sync.List.ListData> => {
    await this.initPromise
    return {
      defaultList: this.allMusicList.get(LIST_IDS.DEFAULT) ?? [],
      loveList: this.allMusicList.get(LIST_IDS.LOVE) ?? [],
      userList: this.userLists.map(l => ({ ...l, list: this.allMusicList.get(l.id) ?? [] })),
      defaultMeta: { ...this.defaultMeta },
      loveMeta: { ...this.loveMeta },
    }
  }


  private readonly setUserLists = (lists: LX.List.UserListInfo[]) => {
    this.userLists.splice(0, this.userLists.length, ...lists)
    return this.userLists
  }

  private readonly setMusicList = (listId: string, musicList: LX.Music.MusicInfo[]): LX.Music.MusicInfo[] => {
    this.allMusicList.set(listId, musicList)
    return musicList
  }

  private readonly removeMusicList = (id: string) => {
    this.allMusicList.delete(id)
  }

  /** 往内置列表里写歌 = 用户要继续用它：清掉 deleted 标记，让它重新出现。
   *  （典型场景：删掉「我的收藏」后又按了 L 键收藏 —— 收藏应该成功，列表也该回来。） */
  private readonly markBuiltinVisible = (id: string) => {
    const meta = id === LIST_IDS.DEFAULT ? this.defaultMeta : id === LIST_IDS.LOVE ? this.loveMeta : null
    if (meta && meta.deleted) meta.deleted = false
  }

  private readonly createUserList = ({
    name,
    id,
    source,
    sourceListId,
    locationUpdateTime,
  }: LX.List.UserListInfo, position: number) => {
    if (position < 0 || position >= this.userLists.length) {
      this.userLists.push({
        name,
        id,
        source,
        sourceListId,
        locationUpdateTime,
      })
    } else {
      this.userLists.splice(position, 0, {
        name,
        id,
        source,
        sourceListId,
        locationUpdateTime,
      })
    }
  }

  private readonly updateList = ({
    name,
    id,
    source,
    sourceListId,
    // meta,
    locationUpdateTime,
  }: LX.List.UserListInfo & { meta?: { id?: string } }) => {
    let targetList
    switch (id) {
      case LIST_IDS.DEFAULT:
        // 内置列表也能改名：名字写进 meta，随快照持久化
        this.defaultMeta.name = name
        break
      case LIST_IDS.LOVE:
        this.loveMeta.name = name
        break
      case LIST_IDS.TEMP:
      //   tempList.meta = meta ?? {}
      // break
      default:
        targetList = this.userLists.find(l => l.id == id)
        if (!targetList) return
        targetList.name = name
        targetList.source = source
        targetList.sourceListId = sourceListId
        targetList.locationUpdateTime = locationUpdateTime
        break
    }
  }

  private readonly removeUserList = (id: string) => {
    const index = this.userLists.findIndex(l => l.id == id)
    if (index < 0) return
    this.userLists.splice(index, 1)
    // removeMusicList(id)
  }

  private readonly overwriteUserList = (lists: LX.List.UserListInfo[]) => {
    this.userLists.splice(0, this.userLists.length, ...lists)
  }


  // const sendMyListUpdateEvent = (ids: string[]) => {
  //   window.app_event.myListUpdate(ids)
  // }


  listDataOverwrite = async ({ defaultList, loveList, userList, tempList, defaultMeta, loveMeta }: MakeOptional<LX.List.ListDataFull, 'tempList'>): Promise<string[]> => {
    const updatedListIds: string[] = []
    const newUserIds: string[] = []
    const newUserListInfos = userList.map(({ list, ...listInfo }) => {
      if (this.allMusicList.has(listInfo.id)) updatedListIds.push(listInfo.id)
      newUserIds.push(listInfo.id)
      this.setMusicList(listInfo.id, list)
      return listInfo
    })
    for (const list of this.userLists) {
      if (!this.allMusicList.has(list.id) || newUserIds.includes(list.id)) continue
      this.removeMusicList(list.id)
      updatedListIds.push(list.id)
    }
    this.overwriteUserList(newUserListInfos)

    if (this.allMusicList.has(LIST_IDS.DEFAULT)) updatedListIds.push(LIST_IDS.DEFAULT)
    this.setMusicList(LIST_IDS.DEFAULT, defaultList)
    this.setMusicList(LIST_IDS.LOVE, loveList)
    if (defaultMeta) this.defaultMeta = { ...defaultMeta }
    if (loveMeta) this.loveMeta = { ...loveMeta }
    updatedListIds.push(LIST_IDS.LOVE)

    if (tempList && this.allMusicList.has(LIST_IDS.TEMP)) {
      this.setMusicList(LIST_IDS.TEMP, tempList)
      updatedListIds.push(LIST_IDS.TEMP)
    }
    const newIds = [LIST_IDS.DEFAULT, LIST_IDS.LOVE, ...userList.map(l => l.id)]
    if (tempList) newIds.push(LIST_IDS.TEMP)
    // void overwriteListPosition(newIds)
    // void overwriteListUpdateInfo(newIds)
    return updatedListIds
  }

  userListCreate = async ({ name, id, source, sourceListId, position, locationUpdateTime }: {
    name: string
    id: string
    source?: LX.OnlineSource
    sourceListId?: string
    position: number
    locationUpdateTime: number | null
  }) => {
    if (this.userLists.some(item => item.id == id)) return
    const newList: LX.List.UserListInfo = {
      name,
      id,
      source,
      sourceListId,
      locationUpdateTime,
    }
    this.createUserList(newList, position)
  }

  userListsRemove = async (ids: string[]) => {
    const changedIds = []
    for (const id of ids) {
      if (id === LIST_IDS.DEFAULT || id === LIST_IDS.LOVE) {
        // 内置列表也允许删除：只删 Map 不行 —— getListData() 会把缺失的 key 回落成 []，
        // 前端看到的是「还在、只是空的」。必须打 deleted 标记并清空曲目。
        const meta = id === LIST_IDS.DEFAULT ? this.defaultMeta : this.loveMeta
        meta.deleted = true
        this.setMusicList(id, [])
        changedIds.push(id)
        continue
      }
      this.removeUserList(id)
      // removeListPosition(id)
      // removeListUpdateInfo(id)
      if (!this.allMusicList.has(id)) continue
      this.removeMusicList(id)
      changedIds.push(id)
    }

    return changedIds
  }

  userListsUpdate = async (listInfos: LX.List.UserListInfo[]) => {
    for (const info of listInfos) {
      this.updateList(info)
    }
  }

  userListsUpdatePosition = async (position: number, ids: string[]) => {
    const newUserLists = [...this.userLists]

    // console.log(position, ids)

    const updateLists: LX.List.UserListInfo[] = []

    // const targetItem = list[position]
    const map = new Map<string, LX.List.UserListInfo>()
    for (const item of newUserLists) map.set(item.id, item)
    for (const id of ids) {
      const listInfo = map.get(id) as LX.List.UserListInfo
      listInfo.locationUpdateTime = Date.now()
      updateLists.push(listInfo)
      map.delete(id)
    }
    newUserLists.splice(0, newUserLists.length, ...newUserLists.filter(mInfo => map.has(mInfo.id)))
    newUserLists.splice(Math.min(position, newUserLists.length), 0, ...updateLists)

    this.setUserLists(newUserLists)
  }


  /**
   * 获取列表内的歌曲
   * @param listId
   */
  getListMusics = async (listId: string): Promise<LX.Music.MusicInfo[]> => {
    if (!listId || !this.allMusicList.has(listId)) return []
    return this.allMusicList.get(listId) as LX.Music.MusicInfo[]
  }

  listMusicOverwrite = async (listId: string, musicInfos: LX.Music.MusicInfo[]): Promise<string[]> => {
    if (musicInfos.length > 0) this.markBuiltinVisible(listId)
    this.setMusicList(listId, musicInfos)
    return [listId]
  }

  listMusicAdd = async (id: string, musicInfos: LX.Music.MusicInfo[], addMusicLocationType: LX.AddMusicLocationType): Promise<string[]> => {
    if (musicInfos.length > 0) this.markBuiltinVisible(id)
    const targetList = await this.getListMusics(id)

    const listSet = new Set<string>()
    for (const item of targetList) listSet.add(item.id)
    musicInfos = musicInfos.filter(item => {
      if (listSet.has(item.id)) return false
      listSet.add(item.id)
      return true
    })
    switch (addMusicLocationType) {
      case 'top':
        arrUnshift(targetList, musicInfos)
        break
      case 'bottom':
      default:
        arrPush(targetList, musicInfos)
        break
    }

    this.setMusicList(id, targetList)

    return [id]
  }

  listMusicRemove = async (listId: string, ids: string[]): Promise<string[]> => {
    let targetList = await this.getListMusics(listId)

    const listSet = new Set<string>()
    for (const item of targetList) listSet.add(item.id)
    for (const id of ids) listSet.delete(id)
    const newList = targetList.filter(mInfo => listSet.has(mInfo.id))
    targetList.splice(0, targetList.length)
    arrPush(targetList, newList)

    return [listId]
  }

  listMusicMove = async (fromId: string, toId: string, musicInfos: LX.Music.MusicInfo[], addMusicLocationType: LX.AddMusicLocationType): Promise<string[]> => {
    return [
      ...await this.listMusicRemove(fromId, musicInfos.map(musicInfo => musicInfo.id)),
      ...await this.listMusicAdd(toId, musicInfos, addMusicLocationType),
    ]
  }

  listMusicUpdateInfo = async (musicInfos: LX.List.ListActionMusicUpdate): Promise<string[]> => {
    const updateListIds = new Set<string>()
    for (const { id, musicInfo } of musicInfos) {
      const targetList = await this.getListMusics(id)
      if (!targetList.length) continue
      const index = targetList.findIndex(l => l.id == musicInfo.id)
      if (index < 0) continue
      const info: LX.Music.MusicInfo = { ...targetList[index] }
      // console.log(musicInfo)
      Object.assign(info, {
        name: musicInfo.name,
        singer: musicInfo.singer,
        source: musicInfo.source,
        interval: musicInfo.interval,
        meta: musicInfo.meta,
      })
      targetList.splice(index, 1, info)
      updateListIds.add(id)
    }
    return Array.from(updateListIds)
  }


  listMusicUpdatePosition = async (listId: string, position: number, ids: string[]): Promise<string[]> => {
    let targetList = await this.getListMusics(listId)

    // const infos = Array(ids.length)
    // for (let i = targetList.length; i--;) {
    //   const item = targetList[i]
    //   const index = ids.indexOf(item.id)
    //   if (index < 0) continue
    //   infos.splice(index, 1, targetList.splice(i, 1)[0])
    // }
    // targetList.splice(Math.min(position, targetList.length - 1), 0, ...infos)

    // console.time('ts')

    // const list = createSortedList(targetList, position, ids)
    const infos: LX.Music.MusicInfo[] = []
    const map = new Map<string, LX.Music.MusicInfo>()
    for (const item of targetList) map.set(item.id, item)
    for (const id of ids) {
      infos.push(map.get(id) as LX.Music.MusicInfo)
      map.delete(id)
    }
    const list = targetList.filter(mInfo => map.has(mInfo.id))
    arrPushByPosition(list, infos, Math.min(position, list.length))

    targetList.splice(0, targetList.length)
    arrPush(targetList, list)

    // console.timeEnd('ts')
    return [listId]
  }


  listMusicClear = async (ids: string[]): Promise<string[]> => {
    const changedIds: string[] = []
    for (const id of ids) {
      const list = await this.getListMusics(id)
      if (!list.length) continue
      this.setMusicList(id, [])
      changedIds.push(id)
    }
    return changedIds
  }
}

