import { isAbsolute, resolve } from 'node:path'
import type { DankConfig } from './dank.ts'
import { LOG } from './developer.ts'

const CFG_P = './dank.config.ts'

export async function loadConfig(path: string = CFG_P): Promise<DankConfig> {
    const modulePath = resolveConfigPath(path)
    LOG({
        realm: 'config',
        message: 'loading config module',
        data: {
            modulePath,
        },
    })
    const module = await import(`${modulePath}?${Date.now()}`)
    return await module.default
}

export function resolveConfigPath(path: string): string {
    if (isAbsolute(path)) {
        return path
    } else {
        return resolve(process.cwd(), path)
    }
}
