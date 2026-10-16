import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSourceHealth } from '../src/server/sourceHealth'

function fixture(threshold = 2) {
    let time = 1000
    const health = createSourceHealth({
        now: () => time,
        policy: () => ({ enabled: true, threshold, cooldownMs: 100 }),
        speedTtlMs: 500
    })
    return { health, advance: (ms: number) => { time += ms } }
}

test('true cooldown blocks every request, then exactly one of two concurrent half-open probes acquires', async () => {
    const { health, advance } = fixture()
    health.acquire('same.js', 'alice')!.finish(false)
    assert.equal(health.isBlocked('same.js', 'alice'), false)
    health.acquire('same.js', 'alice')!.finish(false)
    assert.equal(health.isBlocked('same.js', 'alice'), true)
    assert.equal(health.acquire('same.js', 'alice'), null)
    advance(99)
    assert.equal(health.acquire('same.js', 'alice'), null)
    advance(1)
    // Eligibility scans have no side effects and cannot reserve or bypass a slot.
    assert.equal(health.isBlocked('same.js', 'alice'), false)
    assert.equal(health.isBlocked('same.js', 'alice'), false)
    const permits = await Promise.all([0, 1].map(() => Promise.resolve().then(() => health.acquire('same.js', 'alice'))))
    assert.equal(permits.filter(Boolean).length, 1)
    assert.equal(health.isBlocked('same.js', 'alice'), true)
    permits.find(Boolean)!.finish(true)
    assert.equal(health.isBlocked('same.js', 'alice'), false)
    assert.ok(health.acquire('same.js', 'alice'))
    assert.ok(health.acquire('same.js', 'alice'))
})

test('half-open failure reopens full cooldown; cancellation releases only its own permit', () => {
    const { health, advance } = fixture(1)
    health.acquire('source')!.finish(false)
    advance(100)
    const probe = health.acquire('source')!
    probe.finish(false)
    assert.equal(health.acquire('source'), null)
    advance(100)
    const cancelled = health.acquire('source')!
    cancelled.finish()
    const next = health.acquire('source')!
    assert.ok(next)
    cancelled.finish(false) // idempotent: must not disturb next's slot
    assert.equal(health.acquire('source'), null)
    next.finish(true)
    assert.ok(health.acquire('source'))
})

test('same ids and delimiter-containing owner/id tuples have independent breakers and speed', () => {
    const { health } = fixture(1)
    health.acquire('same.js', 'alice')!.finish(false)
    assert.equal(health.acquire('same.js', 'alice'), null)
    assert.ok(health.acquire('same.js', 'bob'))
    assert.ok(health.acquire('same.js'))
    health.recordSpeed('same.js', 100, 'alice')
    health.recordSpeed('same.js', 900, 'bob')
    health.recordSpeed('same.js', 300, 'alice')
    assert.equal(health.getSpeed('same.js', 'alice'), 170)
    assert.equal(health.getSpeed('same.js', 'bob'), 900)
    assert.equal(health.getSpeed('same.js'), null)
    health.recordResult('c', false, 'a_b')
    assert.ok(health.acquire('b_c', 'a'))
})

test('speed rejects absent measurements, expires TTL, reset clears both and invalidates old permits', () => {
    const { health, advance } = fixture(1)
    for (const ms of [0, -1, NaN, Infinity, 60_001]) health.recordSpeed('s', ms)
    assert.equal(health.getSpeed('s'), null)
    health.recordSpeed('s', 50)
    advance(500)
    assert.equal(health.getSpeed('s'), null)
    const pending = health.acquire('s')!
    health.recordSpeed('s', 80)
    health.reset('s')
    pending.finish(false)
    assert.ok(health.acquire('s'))
    assert.equal(health.getSpeed('s'), null)
    const stale = health.acquire('s')!
    health.recordResult('s', false)
    health.recordSpeed('s', 90)
    health.resetAll()
    stale.finish(false)
    assert.equal(health.isBlocked('s'), false)
    assert.equal(health.getSpeed('s'), null)
})

test('disabling breaker bypasses blocked state without disabling owner-scoped speed', () => {
    let enabled = true
    const health = createSourceHealth({ policy: () => ({ enabled, threshold: 1, cooldownMs: 100 }) })
    health.recordResult('s', false)
    assert.equal(health.acquire('s'), null)
    enabled = false
    health.acquire('s')!.finish(false)
    assert.equal(health.isBlocked('s'), false)
    health.recordSpeed('s', 42)
    assert.equal(health.getSpeed('s'), 42)
})
