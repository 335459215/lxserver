import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runSourceRequest, waitForSourceDelay } from '../src/server/sourceRequest'

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

test('never-settling handler gets a strict deadline and its cancellation handle is called once', async () => {
    let cancelled = 0
    let childSignal: AbortSignal | undefined
    const start = Date.now()
    await assert.rejects(runSourceRequest(signal => {
        childSignal = signal
        return { promise: new Promise(() => {}), cancel: () => { cancelled++ } }
    }, { timeoutMs: 35 }), { name: 'TimeoutError' })
    assert.ok(Date.now() - start < 1000)
    assert.equal(cancelled, 1)
    assert.equal(childSignal!.aborted, true)
})

test('standard AbortSignal promptly cancels; pre-aborted signal never starts operation', async () => {
    const controller = new AbortController()
    let cancelled = 0
    const request = runSourceRequest(() => ({ promise: new Promise(() => {}), abort: () => { cancelled++ } }), {
        timeoutMs: 2000, signal: controller.signal
    })
    controller.abort()
    await assert.rejects(request, { name: 'AbortError' })
    assert.equal(cancelled, 1)
    await assert.rejects(runSourceRequest(() => { assert.fail('pre-aborted operation started') }, {
        signal: controller.signal
    }), { name: 'AbortError' })
})

test('legacy mutable abort flag is observed after an awaited rejection, not recorded as failure', async () => {
    const flag = { aborted: false }
    let reject!: (error: Error) => void
    const request = runSourceRequest(() => new Promise((_, fail) => { reject = fail }), { signal: flag, timeoutMs: 1000 })
    flag.aborted = true
    reject(new Error('late upstream error'))
    await assert.rejects(request, { name: 'AbortError' })
    const pending = runSourceRequest(() => new Promise(() => {}), { signal: flag, timeoutMs: 1000 })
    await assert.rejects(pending, { name: 'AbortError' })
})

test('late rejection after timeout is consumed; successful operation never invokes cancel', async () => {
    let reject!: (error: Error) => void
    let cancelled = 0
    await assert.rejects(runSourceRequest(() => ({
        promise: new Promise((_, fail) => { reject = fail }),
        cancel: () => { cancelled++ }
    }), { timeoutMs: 20 }), { name: 'TimeoutError' })
    reject(new Error('late rejection must not become unhandled'))
    await delay(5)
    assert.equal(cancelled, 1)
    assert.equal(await runSourceRequest(() => ({ promise: Promise.resolve('ok'), cancel: () => { cancelled++ } })), 'ok')
    assert.equal(cancelled, 1)
})

test('Promise.cancel and callback-only cancellation functions are respected', async () => {
    let cancelled = 0
    const promise = Object.assign(new Promise(() => {}), { cancel: () => { cancelled++ } })
    await assert.rejects(runSourceRequest(() => promise, { timeoutMs: 15 }), { name: 'TimeoutError' })
    await assert.rejects(runSourceRequest(() => () => { cancelled++ }, { timeoutMs: 15 }), { name: 'TimeoutError' })
    assert.equal(cancelled, 2)
})

test('bounded delay cancels immediately rather than leaving stagger/retry timers alive', async () => {
    const controller = new AbortController()
    const wait = waitForSourceDelay(120_000, controller.signal)
    controller.abort()
    await assert.rejects(wait, { name: 'AbortError' })
    const flag = { aborted: false }
    const legacyWait = waitForSourceDelay(120_000, flag)
    flag.aborted = true
    await assert.rejects(legacyWait, { name: 'AbortError' })
})
