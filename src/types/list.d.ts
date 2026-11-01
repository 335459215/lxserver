declare namespace LX {
  namespace List {
    interface UserListInfo {
      id: string
      name: string
      // list: LX.Music.MusicInfo[]
      source?: LX.OnlineSource
      sourceListId?: string
      // position?: number
      locationUpdateTime: number | null
    }

    interface MyDefaultListInfo {
      id: 'default'
      name: '试听列表'
      // list: LX.Music.MusicInfo[]
    }

    interface MyLoveListInfo {
      id: 'love'
      name: '我的收藏'
      // list: LX.Music.MusicInfo[]
    }

    interface MyTempListInfo {
      id: 'temp'
      name: '临时列表'
      // list: LX.Music.MusicInfo[]
      // TODO: save default lists info
      meta: {
        id?: string
      }
    }

    type MyListInfo = MyDefaultListInfo | MyLoveListInfo | UserListInfo

    interface MyAllList {
      defaultList: MyDefaultListInfo
      loveList: MyLoveListInfo
      userList: UserListInfo[]
      tempList: MyTempListInfo
    }

    type ListActionDataOverwrite = MakeOptional<LX.List.ListDataFull, 'tempList'>
    interface ListActionAdd {
      position: number
      listInfos: UserListInfo[]
    }
    type ListActionRemove = string[]
    type ListActionUpdate = UserListInfo[]
    interface ListActionUpdatePosition {
      /**
       * 列表id
       */
      ids: string[]
      /**
       * 位置
       */
      position: number
    }

    interface ListActionMusicAdd {
      id: string
      musicInfos: LX.Music.MusicInfo[]
      addMusicLocationType: LX.AddMusicLocationType
    }

    interface ListActionMusicMove {
      fromId: string
      toId: string
      musicInfos: LX.Music.MusicInfo[]
      addMusicLocationType: LX.AddMusicLocationType
    }

    interface ListActionCheckMusicExistList {
      listId: string
      musicInfoId: string
    }

    interface ListActionMusicRemove {
      listId: string
      ids: string[]
    }

    type ListActionMusicUpdate = Array<{
      id: string
      musicInfo: LX.Music.MusicInfo
    }>

    interface ListActionMusicUpdatePosition {
      listId: string
      position: number
      ids: string[]
    }

    interface ListActionMusicOverwrite {
      listId: string
      musicInfos: LX.Music.MusicInfo[]
    }

    type ListActionMusicClear = string[]

    interface MyDefaultListInfoFull extends MyDefaultListInfo {
      list: LX.Music.MusicInfo[]
    }
    interface MyLoveListInfoFull extends MyLoveListInfo {
      list: LX.Music.MusicInfo[]
    }
    interface UserListInfoFull extends UserListInfo {
      list: LX.Music.MusicInfo[]
    }
    interface MyTempListInfoFull extends MyTempListInfo {
      list: LX.Music.MusicInfo[]
    }

    /** v2.44.0：内置列表（试听列表 / 我的收藏）的可编辑元信息。
     *
     *  【为什么必须进同步快照】此前内置列表的名字是前端写死的、删除标记也不存在，
     *  `restore()` 每次都按固定 key 重建它们 —— 于是「改不了名、删不掉」。
     *  现在 name/deleted 跟曲目一起存进快照；**旧快照没有这两个字段**，
     *  读到时按「默认名 + 未删除」处理，不能因为缺字段就把老用户的数据弄丢。 */
    interface BuiltinListMeta {
      /** 用户改过的名字；空/缺省 = 用默认名（试听列表 / 我的收藏） */
      name?: string
      /** 用户删除了这个内置列表（持久化；不会被 restore 重建） */
      deleted?: boolean
    }

    interface ListDataFull {
      defaultList: LX.Music.MusicInfo[]
      loveList: LX.Music.MusicInfo[]
      userList: UserListInfoFull[]
      tempList: LX.Music.MusicInfo[]
      /** 试听列表的元信息（可选，兼容 v2.43 及更早的快照） */
      defaultMeta?: BuiltinListMeta
      /** 我的收藏的元信息（可选，同上） */
      loveMeta?: BuiltinListMeta
    }

    type ListMusics = LX.Music.MusicInfo[]
  }
}
