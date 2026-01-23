import type { ResolvedDankConfig } from './config.ts'

export type DankGlobal = {
    IS_DEV: boolean
    IS_PROD: boolean
}

type DefineDankGlobalKey = 'dank.IS_DEV' | 'dank.IS_PROD'

export type DefineDankGlobal = Record<DefineDankGlobalKey, string>

export function createGlobalDefinitions(
    c: ResolvedDankConfig,
): DefineDankGlobal {
    return {
        'dank.IS_DEV': JSON.stringify(!c.flags.production),
        'dank.IS_PROD': JSON.stringify(c.flags.production),
    }
}
