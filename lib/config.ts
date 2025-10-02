import { isAbsolute, resolve } from 'node:path'
import type { DankConfig } from './dank.ts'

const CFG_P = './dank.config.ts'

export async function loadConfig(path: string = CFG_P): Promise<DankConfig> {
    const modulePath = `${resolveConfigPath(path)}?${Date.now()}`
    const module = await import(modulePath)
    return await module.default
}

export function resolveConfigPath(path: string): string {
    if (isAbsolute(path)) {
        return path
    } else {
        return resolve(process.cwd(), path)
    }
}
