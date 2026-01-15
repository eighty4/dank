import { isAbsolute, resolve } from 'node:path'
import type {
    DankConfig,
    DankDetails,
    EsbuildConfig,
    PageMapping,
} from './dank.ts'
import { LOG } from './developer.ts'
import { isProductionBuild } from './flags.ts'

const CFG_P = './dank.config.ts'

export async function loadConfig(
    mode: 'build' | 'serve',
    path: string = CFG_P,
): Promise<DankConfig> {
    const modulePath = resolveConfigPath(path)
    LOG({
        realm: 'config',
        message: 'loading config module',
        data: {
            modulePath,
        },
    })
    const c = await resolveConfig(mode, modulePath)
    normalizePagePaths(c.pages)
    return c
}

export function resolveConfigPath(path: string): string {
    if (isAbsolute(path)) {
        return path
    } else {
        return resolve(process.cwd(), path)
    }
}

export async function resolveConfig(
    mode: 'build' | 'serve',
    modulePath: string,
): Promise<DankConfig> {
    const module = await import(`${modulePath}?${Date.now()}`)
    const c: Partial<DankConfig> =
        typeof module.default === 'function'
            ? await module.default(resolveDankDetails(mode))
            : module.default
    validateDankConfig(c)
    return c as DankConfig
}

function resolveDankDetails(mode: 'build' | 'serve'): DankDetails {
    const production = isProductionBuild()
    return {
        dev: !production,
        production,
        mode,
    }
}

function validateDankConfig(c: Partial<DankConfig>) {
    try {
        validatePorts(c)
        validatePages(c.pages)
        validateDevServices(c.services)
        validateEsbuildConfig(c.esbuild)
    } catch (e: any) {
        LOG({
            realm: 'config',
            message: 'validation error',
            data: {
                error: e.message,
            },
        })
        throw e
    }
}

function validatePorts(c: Partial<DankConfig>) {
    if (c.port !== null && typeof c.port !== 'undefined') {
        if (typeof c.port !== 'number') {
            throw Error('DankConfig.port must be a number')
        }
    }
    if (c.previewPort !== null && typeof c.previewPort !== 'undefined') {
        if (typeof c.previewPort !== 'number') {
            throw Error('DankConfig.previewPort must be a number')
        }
    }
}

function validateEsbuildConfig(esbuild?: EsbuildConfig) {
    if (esbuild?.loaders !== null && typeof esbuild?.loaders !== 'undefined') {
        if (typeof esbuild.loaders !== 'object') {
            throw Error(
                'DankConfig.esbuild.loaders must be a map of extensions to esbuild loaders',
            )
        } else {
            for (const [ext, loader] of Object.entries(esbuild.loaders)) {
                if (typeof loader !== 'string') {
                    throw Error(
                        `DankConfig.esbuild.loaders['${ext}'] must be a string of a loader name`,
                    )
                }
            }
        }
    }
    if (esbuild?.plugins !== null && typeof esbuild?.plugins !== 'undefined') {
        if (!Array.isArray(esbuild.plugins)) {
            throw Error(
                'DankConfig.esbuild.plugins must be an array of esbuild plugins',
            )
        }
    }
    if (esbuild?.port !== null && typeof esbuild?.port !== 'undefined') {
        if (typeof esbuild.port !== 'number') {
            throw Error('DankConfig.esbuild.port must be a number')
        }
    }
}

function validatePages(pages?: DankConfig['pages']) {
    if (
        pages === null ||
        typeof pages === 'undefined' ||
        Object.keys(pages).length === 0
    ) {
        throw Error('DankConfig.pages is required')
    }
    for (const [urlPath, mapping] of Object.entries(pages)) {
        if (typeof mapping === 'string' && mapping.endsWith('.html')) {
            continue
        }
        if (typeof mapping === 'object') {
            validatePageMapping(urlPath, mapping)
            continue
        }
        throw Error(
            `DankConfig.pages['${urlPath}'] must configure an html file`,
        )
    }
}

function validatePageMapping(urlPath: string, mapping: PageMapping) {
    if (
        mapping.webpage === null ||
        typeof mapping.webpage !== 'string' ||
        !mapping.webpage.endsWith('.html')
    ) {
        throw Error(
            `DankConfig.pages['${urlPath}'].webpage must configure an html file`,
        )
    }
    if (mapping.pattern === null || typeof mapping.pattern === 'undefined') {
        return
    }
    if (
        typeof mapping.pattern === 'object' &&
        mapping.pattern.constructor.name === 'RegExp'
    ) {
        return
    }
    throw Error(`DankConfig.pages['${urlPath}'].pattern must be a RegExp`)
}

function validateDevServices(services: DankConfig['services']) {
    if (services === null || typeof services === 'undefined') {
        return
    }
    if (!Array.isArray(services)) {
        throw Error(`DankConfig.services must be an array`)
    }
    for (let i = 0; i < services.length; i++) {
        const s = services[i]
        if (s.command === null || typeof s.command === 'undefined') {
            throw Error(`DankConfig.services[${i}].command is required`)
        } else if (typeof s.command !== 'string' || s.command.length === 0) {
            throw Error(
                `DankConfig.services[${i}].command must be a non-empty string`,
            )
        }
        if (s.cwd !== null && typeof s.cwd !== 'undefined') {
            if (typeof s.cwd !== 'string' || s.cwd.trim().length === 0) {
                throw Error(
                    `DankConfig.services[${i}].cwd must be a non-empty string`,
                )
            }
        }
        if (s.env !== null && typeof s.env !== 'undefined') {
            if (typeof s.env !== 'object') {
                throw Error(
                    `DankConfig.services[${i}].env must be an env variable map`,
                )
            }
            for (const [k, v] of Object.entries(s.env)) {
                if (typeof v !== 'string') {
                    throw Error(
                        `DankConfig.services[${i}].env[${k}] must be a string`,
                    )
                }
            }
        }
        if (s.http !== null && typeof s.http !== 'undefined') {
            if (typeof s.http.port !== 'number') {
                throw Error(
                    `DankConfig.services[${i}].http.port must be a number`,
                )
            }
        }
    }
}

function normalizePagePaths(pages: DankConfig['pages']) {
    for (const [pageUrl, mapping] of Object.entries(pages)) {
        if (typeof mapping === 'string') {
            pages[pageUrl as `/${string}`] = normalizePagePath(mapping)
        } else {
            mapping.webpage = normalizePagePath(mapping.webpage)
        }
    }
}

function normalizePagePath(p: `${string}.html`): `${string}.html` {
    return p.replace(/^\.\//, '') as `${string}.html`
}
