import {
    watch as createWatch,
    type WatchOptionsWithStringEncoding,
} from 'node:fs/promises'

type WatchCallback = (filename: string) => void

export async function watch(p: string, fire: WatchCallback): Promise<void>

export async function watch(
    p: string,
    signal: AbortSignal,
    fire: WatchCallback,
): Promise<void>

export async function watch(
    p: string,
    opts: WatchOptionsWithStringEncoding,
    fire: WatchCallback,
): Promise<void>

export async function watch(
    p: string,
    signalFireOrOpts:
        | AbortSignal
        | WatchCallback
        | WatchOptionsWithStringEncoding,
    fireOrUndefined?: WatchCallback,
): Promise<void> {
    let opts: WatchOptionsWithStringEncoding | undefined
    let fire: WatchCallback
    if (signalFireOrOpts instanceof AbortSignal) {
        opts = { signal: signalFireOrOpts }
    } else if (typeof signalFireOrOpts === 'object') {
        opts = signalFireOrOpts
    } else {
        fire = signalFireOrOpts
    }
    if (opts && typeof fireOrUndefined === 'function') {
        fire = fireOrUndefined
    }
    const delayFire = 90
    const timeout = 100
    let changes: Record<string, number> = {}
    try {
        for await (const { filename } of createWatch(p, opts)) {
            if (filename) {
                if (!changes[filename]) {
                    const now = Date.now()
                    changes[filename] = now + delayFire
                    setTimeout(() => {
                        const now = Date.now()
                        for (const [filename, then] of Object.entries(
                            changes,
                        )) {
                            if (then <= now) {
                                fire(filename)
                                delete changes[filename]
                            }
                        }
                    }, timeout)
                }
            }
        }
    } catch (e: any) {
        if (e.name !== 'AbortError') {
            throw e
        }
    }
}
