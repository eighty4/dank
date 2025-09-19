import { isProductionBuild } from './flags.ts'

export type DankGlobal = {
    IS_DEV: boolean
    IS_PROD: boolean
}

type DefineDankGlobalKey = 'dank.IS_DEV' | 'dank.IS_PROD'

export type DefineDankGlobal = Record<DefineDankGlobalKey, string>

export function createGlobalDefinitions(): DefineDankGlobal {
    const isProduction = isProductionBuild()
    return {
        'dank.IS_DEV': JSON.stringify(!isProduction),
        'dank.IS_PROD': JSON.stringify(isProduction),
    }
}
