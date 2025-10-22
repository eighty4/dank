import type { DankBuild } from './flags.ts'

export type DankGlobal = {
    IS_DEV: boolean
    IS_PROD: boolean
}

type DefineDankGlobalKey = 'dank.IS_DEV' | 'dank.IS_PROD'

export type DefineDankGlobal = Record<DefineDankGlobalKey, string>

export function createGlobalDefinitions(build: DankBuild): DefineDankGlobal {
    return {
        'dank.IS_DEV': JSON.stringify(!build.production),
        'dank.IS_PROD': JSON.stringify(build.production),
    }
}
