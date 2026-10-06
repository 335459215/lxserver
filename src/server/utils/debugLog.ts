/** 分级日志（阶段 A）：「每次请求/每次播放」级别的输出统一走 debugLog，
 * 仅在 config.debug.enabled=true 时打印；异常路径继续用 console.warn/error 原样输出。
 * 背景：NAS 上 docker json-file 日志驱动默认无上限，解析路径每次播放会打
 * 2~3 条常规日志，长期运行会持续膨胀（计划阶段 A 明确要求收敛）。 */
export const debugLog = (...args: unknown[]) => {
  if (global.lx?.config?.['debug.enabled']) console.log(...args)
}
