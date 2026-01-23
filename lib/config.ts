import { isAbsolute, resolve } from 'node:path'
import type {
    DankConfig,
    DankDetails,
    EsbuildConfig,
    PageMapping,
} from './dank.ts'
import { LOG } from './developer.ts'
import { defaultProjectDirs, type DankDirectories } from './dirs.ts'
import {
    resolveFlags as lookupDankFlags,
    type DankFlags as DankFlags,
} from './flags.ts'

const DEFAULT_DEV_PORT = 3000
const DEFAULT_PREVIEW_PORT = 4000
const DEFAULT_ESBUILD_PORT = 3995

const DEFAULT_CONFIG_PATH = './dank.config.ts'

export type { DevService } from './dank.ts'

export type ResolvedDankConfig = {
    // static from process boot
    get dirs(): Readonly<DankDirectories>
    get flags(): Readonly<Omit<DankFlags, 'dankPort' | 'esbuildPort'>>
    get mode(): 'build' | 'serve'

    // reloadable from `dank.config.ts` with `reload()`
    get dankPort(): number
    get esbuildPort(): number
    get esbuild(): Readonly<Omit<EsbuildConfig, 'port'>> | undefined
    get pages(): Readonly<Record<`/${string}`, PageMapping>>
    get devPages(): Readonly<DankConfig['devPages']>
    get services(): Readonly<DankConfig['services']>

    reload(): Promise<void>
}

export async function loadConfig(
    mode: 'build' | 'serve',
    projectRootAbs: string,
): Promise<ResolvedDankConfig> {
    if (!isAbsolute(projectRootAbs)) {
        throw Error()
    }
    const modulePath = resolve(projectRootAbs, DEFAULT_CONFIG_PATH)
    LOG({
        realm: 'config',
        message: 'loading config module',
        data: {
            modulePath,
        },
    })
    const dirs = await defaultProjectDirs(projectRootAbs)
    const c = new DankConfigInternal(mode, modulePath, dirs)
    await c.reload()
    return c
}

class DankConfigInternal implements ResolvedDankConfig {
    #dirs: Readonly<DankDirectories>
    #flags: Readonly<DankFlags>
    #mode: 'build' | 'serve'
    #modulePath: string

    #dankPort: number = DEFAULT_DEV_PORT
    #esbuildPort: number = DEFAULT_ESBUILD_PORT
    #esbuild: Readonly<Omit<EsbuildConfig, 'port'>> | undefined
    #pages: Readonly<Record<`/${string}`, PageMapping>> = {}
    #devPages: Readonly<DankConfig['devPages']>
    #services: Readonly<DankConfig['services']>

    constructor(
        mode: 'build' | 'serve',
        modulePath: string,
        dirs: DankDirectories,
    ) {
        this.#dirs = dirs
        this.#flags = lookupDankFlags()
        this.#mode = mode
        this.#modulePath = modulePath
    }

    get dankPort(): number {
        return this.#dankPort
    }

    get esbuildPort(): number {
        return this.#esbuildPort
    }

    get esbuild(): Omit<EsbuildConfig, 'port'> | undefined {
        return this.#esbuild
    }

    get dirs(): Readonly<DankDirectories> {
        return this.#dirs
    }

    get flags(): Readonly<Omit<DankFlags, 'dankPort' | 'esbuildPort'>> {
        return this.#flags
    }

    get mode(): 'build' | 'serve' {
        return this.#mode
    }

    get pages(): Readonly<Record<`/${string}`, PageMapping>> {
        return this.#pages
    }

    get devPages(): Readonly<DankConfig['devPages']> {
        return this.#devPages
    }

    get services(): Readonly<DankConfig['services']> {
        return this.#services
    }

    async reload() {
        const userConfig = await resolveConfig(
            this.#modulePath,
            resolveDankDetails(this.#mode, this.#flags),
        )
        this.#dankPort = resolveDankPort(this.#flags, userConfig)
        this.#esbuildPort = resolveEsbuildPort(this.#flags, userConfig)
        this.#esbuild = Object.freeze(userConfig.esbuild)
        this.#pages = Object.freeze(normalizePages(userConfig.pages))
        this.#devPages = Object.freeze(userConfig.devPages)
        this.#services = Object.freeze(userConfig.services)
    }
}

function resolveDankPort(flags: DankFlags, userConfig: DankConfig): number {
    return (
        flags.dankPort ||
        (flags.preview
            ? userConfig.previewPort || userConfig.port || DEFAULT_PREVIEW_PORT
            : userConfig.port || DEFAULT_DEV_PORT)
    )
}

function resolveEsbuildPort(flags: DankFlags, userConfig: DankConfig): number {
    return flags.esbuildPort || userConfig.esbuild?.port || DEFAULT_ESBUILD_PORT
}

async function resolveConfig(
    modulePath: string,
    details: DankDetails,
): Promise<DankConfig> {
    const module = await import(`${modulePath}?${Date.now()}`)
    const c: Partial<DankConfig> =
        typeof module.default === 'function'
            ? await module.default(details)
            : module.default
    validateDankConfig(c)
    return c as DankConfig
}

function resolveDankDetails(
    mode: 'build' | 'serve',
    flags: DankFlags,
): DankDetails {
    return {
        dev: !flags.production,
        production: flags.production,
        mode,
    }
}

function validateDankConfig(c: Partial<DankConfig>) {
    try {
        validatePorts(c)
        validatePages(c.pages)
        validateDevPages(c.devPages)
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

function validateDevPages(devPages?: DankConfig['devPages']) {
    if (devPages) {
        for (const [urlPath, mapping] of Object.entries(devPages)) {
            if (!urlPath.startsWith('/__')) {
                throw Error(
                    `DankConfig.devPages['${urlPath}'] must start \`${urlPath}\` with a \`/__\` path prefix`,
                )
            }
            if (typeof mapping === 'string') {
                if (!mapping.endsWith('.html')) {
                    throw Error(
                        `DankConfig.devPages['${urlPath}'] must configure an html file or DevPageMapping config`,
                    )
                }
            } else if (typeof mapping === 'object') {
                if (
                    typeof mapping.label !== 'string' ||
                    !mapping.label.length
                ) {
                    throw Error(
                        `DankConfig.devPages['${urlPath}'].label must declare a label`,
                    )
                }
                if (
                    typeof mapping.webpage !== 'string' ||
                    !mapping.webpage.endsWith('.html')
                ) {
                    throw Error(
                        `DankConfig.devPages['${urlPath}'].webpage must configure an html file`,
                    )
                }
            } else {
                throw Error(
                    `DankConfig.devPages['${urlPath}'] must be a DevPageMapping config with \`label\` and \`webpage\` values`,
                )
            }
        }
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

function normalizePages(
    pages: DankConfig['pages'],
): Record<`/${string}`, PageMapping> {
    const result: Record<`/${string}`, PageMapping> = {}
    for (const [pageUrl, mapping] of Object.entries(pages)) {
        const mappedMapping =
            typeof mapping === 'string' ? { webpage: mapping } : mapping
        mappedMapping.webpage = mappedMapping.webpage.replace(
            /^\.\//,
            '',
        ) as `${string}.html`
        result[pageUrl as `/${string}`] = mappedMapping
    }
    return result
}
