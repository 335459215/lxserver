# `public/music/bin/` —— 请勿删除

这个目录**不是旧版播放器的残留**，而是服务端功能依赖的二进制工具目录。

`bin/fpcalc*` 是 [Chromaprint](https://acoustid.org/chromaprint) 的音频指纹工具，
被 `src/server/utils/identify.ts` 用于 **AcoustID 歌曲识别**。代码在这里找它：

```
path.join(process.cwd(), 'public/music/bin')
```

注意：`public/music/` 下的**播放器文件**（index.html / app.js / css / js / assets 等）
已于 v2.23.0 随旧版播放器一并移除，只剩这个 `bin/` 目录。
若将来要调整目录位置，需同步修改 `identify.ts` 的 `getFpcalcPath()`。
