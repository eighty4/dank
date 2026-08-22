import {
    access,
    watch as createWatch,
    type WatchOptionsWithStringEncoding,
} from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

export type WatchEventKind = 'add' | 'modify' | 'remove'

export type WatchCallback = (filename: string, event: WatchEventKind) => void

const FIRE_DELAY = 90
const FIRE_TIMEOUT = 100

class FireEventDelay {
    #renamed: boolean
    threshold: number = Date.now() + FIRE_DELAY

    constructor(renamed: boolean) {
        this.#renamed = renamed
    }

    set renamed(renamed: boolean) {
        this.#renamed = renamed
    }

    get renamed(): boolean {
        return this.#renamed
    }
}

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
        AbortSignal | WatchCallback | WatchOptionsWithStringEncoding,
    fireOrUndefined?: WatchCallback,
): Promise<void> {
    if (!isAbsolute(p)) throw TypeError()
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
    let changes: Record<string, FireEventDelay> = {}

    async function drainEventsReadyToFire() {
        const now = Date.now()
        for (const [filename, eventDelay] of Object.entries(changes)) {
            if (eventDelay.threshold <= now) {
                delete changes[filename]
                if (eventDelay.renamed) {
                    try {
                        await access(join(p, filename))
                        fire(filename, 'add')
                    } catch (e) {
                        fire(filename, 'remove')
                    }
                } else {
                    fire(filename, 'modify')
                }
            }
        }
    }

    try {
        for await (const e of createWatch(p, opts)) {
            if (e.filename) {
                if (changes[e.filename]) {
                    if (e.eventType === 'rename') {
                        changes[e.filename].renamed = true
                    }
                } else {
                    changes[e.filename] = new FireEventDelay(
                        e.eventType === 'rename',
                    )
                    setTimeout(drainEventsReadyToFire, FIRE_TIMEOUT)
                }
            }
        }
    } catch (e: any) {
        if (e.name !== 'AbortError') {
            throw e
        }
    }
}
