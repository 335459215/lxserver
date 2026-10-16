import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import {
    loadUserApi, callUserApiGetMusicUrl, reportSourceResult,
    recordSourceSpeed, getSourceSpeed, resetAllSourceBreakers
} from '../src/server/userApi'
import { handleList } from '../src/server/customSourceHandlers'

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
const opts = { requestTimeoutMs: 45, retries: 1, priorityGraceMs: 0, staggerMs: 0 }

// One sequential integration suite owns this module's global config; each subtest has a
// distinct owner/platform. Other test files run in node:test's separate processes.
test('actual userApi VM/request/race integration', { timeout: 15_000 }, async t => {
    const oldLx = (global as any).lx
    const oldDataPath = process.env.DATA_PATH
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-user-api-'))
    process.env.DATA_PATH = root
    const config: Record<string, any> = {
        'system.allowUnsafeVM': true,
        'proxy.customSource.enabled': false,
        'music.url.breakerEnabled': true,
        'music.url.breakerThreshold': 1,
        'music.url.breakerCooldown': 5,
        'music.url.retryDelay': 0,
        'music.url.speedTune': false
    }
    ;(global as any).lx = { config }
    t.after(() => {
        resetAllSourceBreakers()
        ;(global as any).lx = oldLx
        if (oldDataPath === undefined) delete process.env.DATA_PATH
        else process.env.DATA_PATH = oldDataPath
        fs.rmSync(root, { recursive: true, force: true })
    })

    const identity = () => ({ owner: `test-${randomUUID()}`, platform: `p-${randomUUID()}` })
    const load = async (owner: string, platform: string, id: string, expression = '"http://127.0.0.1/audio"', unsafe = false) => {
        const result = await loadUserApi({
            id, owner, name: id, description: '', version: 1, author: '', homepage: '', enabled: true,
            sources: {}, allowUnsafeVM: unsafe,
            script: `lx.on('request', () => (${expression})); lx.send('inited', { sources: { ${JSON.stringify(platform)}: {} } });`
        })
        assert.equal(result.success, true, result.error)
        return result.apiInstance
    }
    const resolve = (owner: string, platform: string, options: any = {}) => callUserApiGetMusicUrl(
        platform, { songmid: 'synthetic' }, '128k', owner, undefined, true, undefined, { ...opts, ...options }
    )

    await t.test('never-resolving VM handler times out in serial and next source wins with owner attempts', async () => {
        const { owner, platform } = identity()
        await load(owner, platform, 'hang.js', 'new Promise(() => {})')
        await load(owner, platform, 'next.js')
        const start = Date.now()
        const result = await resolve(owner, platform, { race: false })
        assert.equal(result.sourceId, 'next.js')
        assert.equal(result.sourceOwner, owner)
        assert.deepEqual(result.attempts!.map(a => [a.sourceId, a.sourceOwner, a.status]), [
            ['hang.js', owner, 'fail'], ['next.js', owner, 'success']
        ])
        assert.ok(Date.now() - start < 1000, 'serial fallback must not hang for 120s')
    })

    await t.test('undefined/non-HTTP handler results cannot win and validation is deadline-bounded', async () => {
        const { owner, platform } = identity()
        await load(owner, platform, 'undefined.js', 'undefined')
        await load(owner, platform, 'object.js', '({ url: "http://127.0.0.1/wrong" })')
        await load(owner, platform, 'file.js', '"file:///not-a-media-url"')
        await load(owner, platform, 'valid.js')
        const result = await resolve(owner, platform, { race: false })
        assert.equal(result.sourceId, 'valid.js')
        assert.equal(result.attempts!.filter(a => a.status === 'fail').length, 3)
        const validation = identity()
        await load(validation.owner, validation.platform, 'unvalidated.js')
        await assert.rejects(resolve(validation.owner, validation.platform, {
            validateLink: () => new Promise(() => {})
        }), /超时/)
    })

    await t.test('alice failure immediately cools only alice; bob same id and speeds stay independent', async () => {
        const platform = `owners-${randomUUID()}`
        const alice = `alice-${randomUUID()}`
        const bob = `bob-${randomUUID()}`
        const a = await load(alice, platform, 'same.js')
        await load(bob, platform, 'same.js')
        let calls = 0
        a.handlers.set('request', () => { calls++; throw new Error('alice fails') })
        await assert.rejects(resolve(alice, platform), /alice fails/)
        assert.equal(calls, 1, 'threshold=1 forbids a single-candidate retry during cooldown')
        await assert.rejects(resolve(alice, platform), /熔断冷却/)
        assert.equal(calls, 1, 'no early cooldown probe')
        assert.equal((await resolve(bob, platform)).sourceOwner, bob)
        recordSourceSpeed('same.js', 100, alice)
        recordSourceSpeed('same.js', 900, bob)
        recordSourceSpeed('same.js', 500)
        assert.equal(getSourceSpeed('same.js', alice), 100)
        assert.equal(getSourceSpeed('same.js', bob), 900)
        assert.equal(getSourceSpeed('same.js'), 500)
    })

    await t.test('pre-collected candidates still contend for one half-open slot; cancellation releases it', async () => {
        const { owner, platform } = identity()
        const first = await load(owner, platform, 'blocking-first.js')
        const probe = await load(owner, platform, 'probe.js')
        let probeCalls = 0
        let entered!: () => void
        const started = new Promise<void>(resolve => { entered = resolve })
        probe.handlers.set('request', () => { probeCalls++; entered(); return new Promise(() => {}) })
        first.handlers.set('request', () => new Promise(() => {}))
        const realNow = Date.now
        let clock = realNow()
        Date.now = () => clock
        try {
            reportSourceResult('probe.js', false, owner)
            clock += 5000
            const c1 = new AbortController()
            const c2 = new AbortController()
            const one = resolve(owner, platform, { requestTimeoutMs: 1000, staggerMs: 50, signal: c1.signal })
            const two = resolve(owner, platform, { requestTimeoutMs: 1000, staggerMs: 50, signal: c2.signal })
            // Both resolvers collected probe.js before either scheduler starts it.
            const results = Promise.allSettled([one, two])
            await started
            await delay(65)
            assert.equal(probeCalls, 1)
            c1.abort()
            c2.abort()
            assert.ok((await results).every(r => r.status === 'rejected' && r.reason.name === 'AbortError'))
            probe.handlers.set('request', () => { probeCalls++; return 'http://127.0.0.1/recovered' })
            const recovered = await resolve(owner, platform, { requestTimeoutMs: 200, staggerMs: 0 })
            assert.equal(recovered.sourceId, 'probe.js')
            assert.equal(probeCalls, 2, 'cancelled probe should be immediately available, not stuck/open again')
        } finally {
            Date.now = realNow
        }
    })

    await t.test('race winner cancels loser without breaker failure and stops future staggered starts', async () => {
        const { owner, platform } = identity()
        const loser = await load(owner, platform, 'loser.js')
        const winner = await load(owner, platform, 'winner.js')
        const notStarted = await load(owner, platform, 'later.js')
        let cancellations = 0
        let laterCalls = 0
        loser.handlers.set('request', () => ({ promise: new Promise(() => {}), cancel: () => { cancellations++ } }))
        notStarted.handlers.set('request', () => { laterCalls++; return 'http://127.0.0.1/later' })
        const result = await resolve(owner, platform, { staggerMs: 35, requestTimeoutMs: 1000 })
        assert.equal(result.sourceId, 'winner.js')
        assert.equal(cancellations, 1)
        assert.equal(result.attempts!.some(a => a.sourceId === 'loser.js' && a.status === 'fail'), false)
        await delay(60)
        assert.equal(laterCalls, 0, 'owned schedule must not continue after returning a winner')
        winner.info.enabled = false
        notStarted.info.enabled = false
        loser.handlers.set('request', () => 'http://127.0.0.1/healthy-loser')
        assert.equal((await resolve(owner, platform)).sourceId, 'loser.js', 'race loss did not trip loser')
    })

    await t.test('standard and legacy outer cancellation after awaits never records late source rejection', async () => {
        for (const legacy of [false, true]) {
            const { owner, platform } = identity()
            const api = await load(owner, platform, 'cancel.js')
            let reject!: (error: Error) => void
            api.handlers.set('request', () => new Promise((_, fail) => { reject = fail }))
            const controller = new AbortController()
            const flag = { aborted: false }
            const pending = resolve(owner, platform, { signal: legacy ? flag : controller.signal, requestTimeoutMs: 1000 })
            const check = assert.rejects(pending, { name: 'AbortError' })
            if (legacy) flag.aborted = true
            else controller.abort()
            reject(new Error('late error after outer loss'))
            await check
            api.handlers.set('request', () => 'http://127.0.0.1/still-healthy')
            assert.equal((await resolve(owner, platform)).sourceId, 'cancel.js')
        }
    })

    await t.test('actual VM lx.request total timeout covers headers plus one body byte that never ends', async () => {
        const sockets = new Set<any>()
        let requestCount = 0
        const server = http.createServer((_req, res) => {
            requestCount++
            res.writeHead(200, { 'Content-Type': 'text/plain' })
            res.write('x')
        })
        server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
        server.listen(0, '127.0.0.1')
        await once(server, 'listening')
        const port = (server.address() as any).port
        try {
            for (const unsafe of [false, true]) {
                const { owner, platform } = identity()
                const api = await load(owner, platform, `body-${unsafe}.js`, `new Promise((resolve, reject) => {
                    lx.request('http://127.0.0.1:${port}/hang', { timeout: 45 }, (error) => {
                        if (error) reject(error); else resolve('http://127.0.0.1/never');
                    });
                })`, unsafe)
                const start = Date.now()
                await assert.rejects(api.callRequest('musicUrl', platform, {}, { requestTimeoutMs: 1000 }), /超时|timeout/)
                assert.ok(Date.now() - start < 750, 'HTTP body deadline, not the outer 1s safety net')
            }
            assert.equal(requestCount, 2, 'loopback request really reached headers/body')
            await delay(30)
            assert.equal(sockets.size, 0, 'timeout aborts needle stream/socket')
        } finally {
            for (const socket of sockets) socket.destroy()
            await new Promise<void>(resolve => server.close(() => resolve()))
        }
    })

    await t.test('VM Promise cancellation handle works; source reload/reset clears breaker and speed', async () => {
        const { owner, platform } = identity()
        const script = `let cancelled = 0;
            lx.on('request', ({ action }) => {
                if (action === 'stats') return cancelled;
                const pending = new Promise(() => {});
                pending.cancel = () => { cancelled++; };
                return pending;
            });
            lx.send('inited', { sources: { ${JSON.stringify(platform)}: {} } });`
        const loaded = await loadUserApi({ id: 'vm-cancel.js', owner, name: 'vm-cancel', script, enabled: true, sources: {} } as any)
        assert.equal(loaded.success, true)
        await assert.rejects(loaded.apiInstance.callRequest('musicUrl', platform, {}, { requestTimeoutMs: 25 }), { name: 'TimeoutError' })
        assert.equal(await loaded.apiInstance.callRequest('stats', platform, {}), 1)
        reportSourceResult('vm-cancel.js', false, owner)
        recordSourceSpeed('vm-cancel.js', 250, owner)
        await load(owner, platform, 'vm-cancel.js')
        assert.equal(getSourceSpeed('vm-cancel.js', owner), null)
        assert.equal((await resolve(owner, platform)).sourceId, 'vm-cancel.js')
        reportSourceResult('vm-cancel.js', false, owner)
        recordSourceSpeed('vm-cancel.js', 300, owner)
        resetAllSourceBreakers()
        assert.equal(getSourceSpeed('vm-cancel.js', owner), null)
        assert.equal((await resolve(owner, platform)).sourceId, 'vm-cancel.js')
    })

    await t.test('customSourceHandlers list queries latency with actual source.owner', async () => {
        const owner = `list-${randomUUID()}`
        const dir = path.join(root, 'users', 'source', owner)
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(path.join(dir, 'sources.json'), JSON.stringify([{ id: 'same.js', enabled: true }]))
        recordSourceSpeed('same.js', 123, owner)
        recordSourceSpeed('same.js', 999)
        let body = ''
        await handleList({} as any, {
            writeHead(code: number) { assert.equal(code, 200) },
            end(text: string) { body = text }
        } as any, owner)
        const sources = JSON.parse(body)
        assert.equal(sources.length, 1)
        assert.equal(sources[0].speedMs, 123)
        assert.equal(sources[0].owner, owner)
    })
})
