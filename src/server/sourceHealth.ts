/** Owner-scoped runtime health. No global/config/IO dependencies; each instance is isolated. */
interface BreakerState {
    fails: number
    openUntil: number
    probe?: symbol
}

interface BreakerPolicy {
    enabled: boolean
    threshold: number
    cooldownMs: number
}

interface SourcePermit {
    /** Omit the result for cancellation, race losers, or success deferred to link validation. */
    finish: (ok?: boolean) => void
}

export function createSourceHealth(options: {
    policy: () => BreakerPolicy
    now?: () => number
    speedTtlMs?: number
}): {
    isBlocked: (id: string, owner?: string) => boolean
    acquire: (id: string, owner?: string) => SourcePermit | null
    recordResult: (id: string, ok: boolean, owner?: string) => void
    recordSpeed: (id: string, ms: number, owner?: string) => void
    getSpeed: (id: string, owner?: string) => number | null
    reset: (id: string, owner?: string) => void
    resetAll: () => void
} {
    const now = options.now ?? (() => Date.now())
    // JSON tuples, unlike owner_id concatenation, cannot collide on underscores/delimiters.
    const keyOf = (id: string, owner = 'open') => JSON.stringify([owner, id])
    const breakers = new Map<string, BreakerState>()
    const speeds = new Map<string, { ms: number, at: number }>()
    const speedTtlMs = options.speedTtlMs ?? 30 * 60_000
    // Reset invalidates outstanding permits, so an old request cannot recreate cleared health.
    let generation = 0
    const versions = new Map<string, object>()

    const isBlocked = (id: string, owner = 'open') => {
        if (!options.policy().enabled) return false
        const state = breakers.get(keyOf(id, owner))
        return !!state && (state.openUntil > now() || !!state.probe)
    }

    const record = (key: string, ok: boolean) => {
        const policy = options.policy()
        if (!policy.enabled) return
        if (ok) { breakers.delete(key); return }
        const state = breakers.get(key)
        const fails = (state?.fails ?? 0) + 1
        // A failed half-open probe (or any reported failure while open) starts a fresh cooldown.
        const reopen = !!state?.openUntil || fails >= Math.max(1, policy.threshold)
        breakers.set(key, {
            fails,
            openUntil: reopen ? now() + Math.max(1, policy.cooldownMs) : 0
        })
    }

    const acquire = (id: string, owner = 'open'): SourcePermit | null => {
        const key = keyOf(id, owner)
        const policy = options.policy()
        let state = breakers.get(key)
        let probe: symbol | undefined
        if (policy.enabled && state) {
            if (state.openUntil > now() || state.probe) return null
            if (state.openUntil > 0) {
                // Synchronous check-and-set: candidate collection never reserves this slot.
                probe = Symbol('half-open')
                state.probe = probe
            }
        }
        let version = versions.get(key)
        if (!version) { version = {}; versions.set(key, version) }
        const acquiredGeneration = generation
        let finished = false
        return {
            finish(ok) {
                if (finished) return
                finished = true
                if (generation !== acquiredGeneration || versions.get(key) !== version) return
                // A stale probe cannot clear/reopen a newer probe's state.
                if (probe && breakers.get(key)?.probe !== probe) return
                if (ok === undefined) {
                    if (probe) delete state!.probe
                    return
                }
                record(key, ok)
            }
        }
    }

    return {
        isBlocked,
        acquire,
        recordResult(id, ok, owner = 'open') { if (id) record(keyOf(id, owner), ok) },
        recordSpeed(id, ms, owner = 'open') {
            if (!id || !Number.isFinite(ms) || ms <= 0 || ms > 60_000) return
            const key = keyOf(id, owner)
            const timestamp = now()
            const previous = speeds.get(key)
            const fresh = previous && timestamp - previous.at < speedTtlMs
            speeds.delete(key)
            speeds.set(key, { ms: fresh ? previous.ms * 0.65 + ms * 0.35 : ms, at: timestamp })
            if (speeds.size > 500) speeds.delete(speeds.keys().next().value!)
        },
        getSpeed(id, owner = 'open') {
            const key = keyOf(id, owner)
            const value = speeds.get(key)
            if (!value) return null
            if (now() - value.at >= speedTtlMs) { speeds.delete(key); return null }
            return value.ms
        },
        reset(id, owner = 'open') {
            const key = keyOf(id, owner)
            versions.delete(key)
            breakers.delete(key)
            speeds.delete(key)
        },
        resetAll() {
            generation++
            versions.clear()
            breakers.clear()
            speeds.clear()
        }
    }
}
