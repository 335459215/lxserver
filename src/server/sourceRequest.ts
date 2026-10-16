/** Request deadline/cancellation primitives, independent of VM, HTTP and global state. */
export type SourceSignal = { aborted: boolean } | AbortSignal

export function sourceAbortError(): Error {
    const error = new Error('自定义源请求已取消')
    error.name = 'AbortError'
    return error
}

export function isSourceAbort(error: unknown): boolean {
    return (error as any)?.name === 'AbortError'
}

/** Standard signals wake immediately; legacy mutable flags are observed within 20ms. */
export function observeSourceAbort(signal: SourceSignal | undefined, abort: () => void): () => void {
    if (!signal) return () => {}
    if (signal.aborted) { abort(); return () => {} }
    const eventSignal = signal as AbortSignal
    if (typeof eventSignal.addEventListener === 'function' && typeof eventSignal.removeEventListener === 'function') {
        eventSignal.addEventListener('abort', abort, { once: true })
        // Also covers a flag changed between the initial check and listener registration.
        if (signal.aborted) abort()
        return () => eventSignal.removeEventListener('abort', abort)
    }
    const timer = setInterval(() => { if (signal.aborted) abort() }, 20)
    return () => clearInterval(timer)
}

export function waitForSourceDelay(ms: number, signal?: SourceSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        let cleanup = () => {}
        let timer: ReturnType<typeof setTimeout> | undefined
        const finish = (error?: Error) => {
            if (timer) clearTimeout(timer)
            cleanup()
            if (error) reject(error)
            else resolve()
        }
        timer = setTimeout(() => finish(), Math.max(0, ms))
        cleanup = observeSourceAbort(signal, () => finish(sourceAbortError()))
    })
}

/**
 * Bounds the whole async operation, including validation/body consumption after headers.
 * start may return a Promise, a Promise with cancel/abort, {promise, cancel/abort}, or
 * a cancellation function (callback-only operation). Late settlements are always consumed.
 * Synchronous CPU loops cannot be preempted on the host event loop by a timer.
 */
export function runSourceRequest<T>(
    start: (signal: AbortSignal) => unknown,
    options: { timeoutMs?: number, signal?: SourceSignal } = {}
): Promise<T> {
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs! > 0 ? options.timeoutMs! : 10_000
    return new Promise<T>((resolve, reject) => {
        const controller = new AbortController()
        const deadline = Date.now() + timeoutMs
        let settled = false
        let cancel: (() => void) | undefined
        let cleanupAbort = () => {}
        const finish = (error: unknown, value?: T, stop = false) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            cleanupAbort()
            // End child resources even when the handler returns without awaiting them.
            controller.abort()
            if (stop) {
                try { cancel?.() } catch { /* cancellation is best-effort */ }
            }
            if (error) reject(error)
            else resolve(value as T)
        }
        const timeout = () => {
            const error = new Error(`自定义源请求超时 (${timeoutMs}ms)`)
            error.name = 'TimeoutError'
            finish(error, undefined, true)
        }
        const timer = setTimeout(timeout, timeoutMs)
        cleanupAbort = observeSourceAbort(options.signal, () => finish(sourceAbortError(), undefined, true))
        if (settled) return
        try {
            const operation: any = start(controller.signal)
            if (typeof operation === 'function') cancel = operation
            else if (operation && typeof operation.cancel === 'function') cancel = () => operation.cancel()
            else if (operation && typeof operation.abort === 'function') cancel = () => operation.abort()
            const pending = typeof operation === 'function'
                ? new Promise<never>(() => {})
                : operation && typeof operation === 'object' && 'promise' in operation ? operation.promise : operation
            // start can synchronously trigger its outer signal before returning a cancel handle.
            if (settled) { try { cancel?.() } catch {} }
            void Promise.resolve(pending).then(value => {
                if (options.signal?.aborted) finish(sourceAbortError(), undefined, true)
                else if (Date.now() >= deadline) timeout()
                else finish(null, value as T)
            }, error => {
                if (options.signal?.aborted) finish(sourceAbortError(), undefined, true)
                else if (Date.now() >= deadline) timeout()
                else finish(error)
            })
        } catch (error) {
            if (options.signal?.aborted) finish(sourceAbortError(), undefined, true)
            else if (Date.now() >= deadline) timeout()
            else finish(error)
        }
    })
}
