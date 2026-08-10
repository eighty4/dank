import { isAbsolute, resolve } from 'node:path'
import { createBuildTag } from './build_tag.ts'
import type {
    DankConfig,
    DankDetails,
    DankMode,
    DevPageMapping,
    EsbuildConfig,
    PageMapping,
    ServiceWorkerBuilder,
} from './dank.ts'
import { LOG } from './debug_log.ts'
import { defaultProjectDirs, type DankDirectories } from './dirs.ts'
import {
    resolveFlags as lookupDankFlags,
    type DankFlags as DankFlags,
} from './flags.ts'
import { DankError } from './errors.ts'

const DEFAULT_DEV_PORT = 3000
const DEFAULT_PREVIEW_PORT = 4000
const DEFAULT_ESBUILD_PORT = 3995

const DEFAULT_CONFIG_PATH = './dank.config.ts'

export type { DevService } from './dank.ts'

export type ResolvedDankConfig = {
    // static config that does not hot reload during `dank serve`
    get dirs(): Readonly<DankDirectories>
    get flags(): Readonly<Omit<DankFlags, 'dankPort' | 'esbuildPort'>>
    get mode(): DankMode

    // reloadable from `dank.config.ts` with `reload()`
    get dankPort(): number
    get esbuildPort(): number
    get esbuild(): Readonly<Omit<EsbuildConfig, 'port'>> | undefined
    get pages(): Readonly<Record<`/${string}`, PageMapping>>
    get devPages(): Readonly<
        Record<`/${string}`, Omit<DevPageMapping & PageMapping, 'pattern'>>
    >
    get services(): Readonly<DankConfig['services']>
    get serviceWorkerBuilder(): DankConfig['serviceWorker']
    get afterBuild(): DankConfig['afterBuild']

    buildTag(): Promise<string>

    isBuildMode(): boolean
    isPreviewMode(): boolean
    isServeMode(): boolean

    pageMappings(): Record<`/${string}`, PageMapping>

    useDankDevUI(): boolean

    reload(): Promise<void>
}

export async function loadConfig(
    mode: DankMode,
    projectRootAbs: string,
): Promise<ResolvedDankConfig> {
    if (!isAbsolute(projectRootAbs)) {
        throw Error('loadConfig() must be called with an absolute path')
    }
    const modulePath = resolve(projectRootAbs, DEFAULT_CONFIG_PATH)
    const dirs = await defaultProjectDirs(projectRootAbs)
    LOG({
        realm: 'config',
        message: 'loading config module',
        data: {
            modulePath,
        },
    })
    const c = new DankConfigInternal(mode, modulePath, dirs)
    await c.reload()
    return c
}

class DankConfigInternal implements ResolvedDankConfig {
    #buildTag: Promise<string> | null = null
    #buildTagBuilder: DankConfig['buildTag']
    #dirs: Readonly<DankDirectories>
    #flags: Readonly<DankFlags>
    #mode: DankMode
    #modulePath: string
    #serviceWorkerBuilder?: ServiceWorkerBuilder
    #afterBuild: DankConfig['afterBuild']

    #dankPort: number = DEFAULT_DEV_PORT
    #esbuildPort: number = DEFAULT_ESBUILD_PORT
    #esbuild: Readonly<Omit<EsbuildConfig, 'port'>> | undefined
    #pages: Readonly<Record<`/${string}`, PageMapping>> = {}
    #devPages: Readonly<ResolvedDankConfig['devPages']> = {}
    #services: Readonly<DankConfig['services']>

    constructor(mode: DankMode, modulePath: string, dirs: DankDirectories) {
        this.#dirs = dirs
        this.#flags = lookupDankFlags(mode)
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

    get mode(): DankMode {
        return this.#mode
    }

    get pages(): Readonly<Record<`/${string}`, PageMapping>> {
        return this.#pages
    }

    get devPages(): Readonly<ResolvedDankConfig['devPages']> {
        return this.#devPages
    }

    get services(): Readonly<DankConfig['services']> {
        return this.#services
    }

    get serviceWorkerBuilder(): DankConfig['serviceWorker'] {
        return this.#serviceWorkerBuilder
    }

    get afterBuild(): DankConfig['afterBuild'] {
        return this.#afterBuild
    }

    buildTag(): Promise<string> {
        if (this.#buildTag === null) {
            this.#buildTag = createBuildTag(
                this.#dirs.projectRootAbs,
                this.#flags,
                this.#buildTagBuilder,
            )
        }
        return this.#buildTag
    }

    isBuildMode(): boolean {
        return this.#mode === 'build'
    }

    isPreviewMode(): boolean {
        return this.#mode === 'preview'
    }

    isServeMode(): boolean {
        return this.#mode === 'serve'
    }

    pageMappings(): ResolvedDankConfig['pages'] {
        if (this.#mode === 'serve') {
            return {
                ...this.#pages,
                ...this.#devPages,
            }
        } else {
            return this.#pages
        }
    }

    useDankDevUI(): boolean {
        return this.isServeMode() && !this.#flags.noDankUI
    }

    async reload() {
        const userConfig = await resolveConfig(
            this.#modulePath,
            resolveDankDetails(this.#mode, this.#flags),
        )
        this.#buildTag = null
        this.#buildTagBuilder = userConfig.buildTag
        this.#dankPort = resolveDankPort(this.#mode, this.#flags, userConfig)
        this.#esbuildPort = resolveEsbuildPort(this.#flags, userConfig)
        this.#esbuild = Object.freeze(userConfig.esbuild)
        this.#pages = Object.freeze(normalizePages(userConfig.pages))
        this.#devPages = Object.freeze(normalizeDevPages(userConfig.devPages))
        this.#services = Object.freeze(userConfig.services)
        this.#serviceWorkerBuilder = userConfig.serviceWorker
        this.#afterBuild = userConfig.afterBuild
    }
}

function resolveDankPort(
    mode: DankMode,
    flags: DankFlags,
    userConfig: DankConfig,
): number {
    return (
        flags.dankPort ||
        (mode === 'preview'
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
    const module = await import(`file:${modulePath}?${Date.now()}`)
    const c: Partial<DankConfig> =
        typeof module.default === 'function'
            ? await module.default(details)
            : module.default
    validateDankConfig(c)
    return c as DankConfig
}

function resolveDankDetails(mode: DankMode, flags: DankFlags): DankDetails {
    return {
        dev: !flags.production,
        production: flags.production,
        mode,
    }
}

function validateDankConfig(c: Partial<DankConfig>) {
    try {
        validatePorts(c)
        validateBuildTag(c.buildTag)
        validatePages(c.pages)
        validateDevPages(c.devPages)
        validateDevServices(c.services)
        validateEsbuildConfig(c.esbuild)
        validateServiceWorker(c.serviceWorker)
        validateAfterBuild(c.afterBuild)
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
            throw new DankError('DankConfig.port must be a number')
        }
    }
    if (c.previewPort !== null && typeof c.previewPort !== 'undefined') {
        if (typeof c.previewPort !== 'number') {
            throw new DankError('DankConfig.previewPort must be a number')
        }
    }
}

function validateBuildTag(buildTag: DankConfig['buildTag']) {
    if (buildTag === null) {
        return
    }
    switch (typeof buildTag) {
        case 'undefined':
        case 'string':
        case 'function':
            return
        default:
            throw new DankError(
                'DankConfig.buildTag must be a string or function',
            )
    }
}

function validateServiceWorker(serviceWorker: DankConfig['serviceWorker']) {
    if (serviceWorker === null) {
        return
    }
    switch (typeof serviceWorker) {
        case 'undefined':
        case 'function':
            return
        default:
            throw new DankError('DankConfig.serviceWorker must be a function')
    }
}

function validateEsbuildConfig(esbuild?: EsbuildConfig) {
    if (esbuild?.loaders !== null && typeof esbuild?.loaders !== 'undefined') {
        if (typeof esbuild.loaders !== 'object') {
            throw new DankError(
                'DankConfig.esbuild.loaders must be a map of extensions to esbuild loaders',
            )
        } else {
            for (const [ext, loader] of Object.entries(esbuild.loaders)) {
                if (typeof loader !== 'string') {
                    throw new DankError(
                        `DankConfig.esbuild.loaders['${ext}'] must be a string of a loader name`,
                    )
                }
            }
        }
    }
    if (esbuild?.plugins !== null && typeof esbuild?.plugins !== 'undefined') {
        if (!Array.isArray(esbuild.plugins)) {
            throw new DankError(
                'DankConfig.esbuild.plugins must be an array of esbuild plugins',
            )
        }
    }
    if (esbuild?.port !== null && typeof esbuild?.port !== 'undefined') {
        if (typeof esbuild.port !== 'number') {
            throw new DankError('DankConfig.esbuild.port must be a number')
        }
    }
}

function validatePages(pages?: DankConfig['pages']) {
    if (
        pages === null ||
        typeof pages === 'undefined' ||
        Object.keys(pages).length === 0
    ) {
        throw new DankError('DankConfig.pages is required')
    }
    for (const [urlPath, mapping] of Object.entries(pages)) {
        if (typeof mapping === 'string' && mapping.endsWith('.html')) {
            continue
        }
        if (typeof mapping === 'object') {
            validatePageMapping(urlPath, mapping)
            continue
        }
        throw new DankError(
            `DankConfig.pages['${urlPath}'] must configure an html file`,
        )
    }
}

function validateDevPages(devPages?: DankConfig['devPages']) {
    if (devPages) {
        for (const [urlPath, mapping] of Object.entries(devPages)) {
            if (!urlPath.startsWith('/__')) {
                throw new DankError(
                    `DankConfig.devPages['${urlPath}'] url must start with \`/__\` path prefix`,
                )
            }
            if (typeof mapping === 'string') {
                if (!mapping.endsWith('.html')) {
                    throw new DankError(
                        `DankConfig.devPages['${urlPath}'] mapped to \`${mapping}\` must be a path to an html file or DevPageMapping config`,
                    )
                }
            } else if (typeof mapping === 'object') {
                if (
                    typeof mapping.label !== 'string' ||
                    !mapping.label.length
                ) {
                    throw new DankError(
                        `DankConfig.devPages['${urlPath}'].label is required`,
                    )
                }
                if (
                    typeof mapping.webpage !== 'string' ||
                    !mapping.webpage.endsWith('.html')
                ) {
                    throw new DankError(
                        `DankConfig.devPages['${urlPath}'].webpage mapped to \`${mapping.webpage}\` must be a path to an html file`,
                    )
                }
            } else {
                throw new DankError(
                    `DankConfig.devPages['${urlPath}'] must be a path to an html file or DevPageMapping config`,
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
        throw new DankError(
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
    throw new DankError(
        `DankConfig.pages['${urlPath}'].pattern must be a RegExp`,
    )
}

function validateDevServices(services: DankConfig['services']) {
    if (services === null || typeof services === 'undefined') {
        return
    }
    if (!Array.isArray(services)) {
        throw new DankError(`DankConfig.services must be an array`)
    }
    for (let i = 0; i < services.length; i++) {
        const s = services[i]
        if (!!s.label && typeof s.label !== 'string') {
            throw new DankError(
                `DankConfig.services[${i}].label must be a string`,
            )
        }
        if (s.command === null || typeof s.command === 'undefined') {
            throw new DankError(`DankConfig.services[${i}].command is required`)
        } else if (typeof s.command !== 'string' || s.command.length === 0) {
            throw new DankError(
                `DankConfig.services[${i}].command must be a non-empty string`,
            )
        }
        if (s.cwd !== null && typeof s.cwd !== 'undefined') {
            if (typeof s.cwd !== 'string' || s.cwd.trim().length === 0) {
                throw new DankError(
                    `DankConfig.services[${i}].cwd must be a non-empty string`,
                )
            }
        }
        if (s.env !== null && typeof s.env !== 'undefined') {
            if (typeof s.env !== 'object') {
                throw new DankError(
                    `DankConfig.services[${i}].env must be an env variable map`,
                )
            }
            for (const [k, v] of Object.entries(s.env)) {
                if (typeof v !== 'string') {
                    throw new DankError(
                        `DankConfig.services[${i}].env[${k}] must be a string`,
                    )
                }
            }
        }
        if (s.http !== null && typeof s.http !== 'undefined') {
            if (typeof s.http.port !== 'number') {
                throw new DankError(
                    `DankConfig.services[${i}].http.port must be a number`,
                )
            }
        }
    }
}

function validateAfterBuild(afterBuild: DankConfig['afterBuild']) {
    if (!afterBuild) {
        return
    }
    if (typeof afterBuild !== 'function') {
        throw new DankError(`DankConfig.afterBuild must be a function`)
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

function normalizeDevPages(
    pages: DankConfig['devPages'],
): Record<string, Omit<DevPageMapping & PageMapping, 'pattern'>> {
    if (pages) {
        const result: Record<
            string,
            Omit<DevPageMapping & PageMapping, 'pattern'>
        > = {}
        for (const [url, mapping] of Object.entries(pages)) {
            if (typeof mapping === 'string') {
                result[url] = {
                    label: url,
                    webpage: mapping,
                }
            } else {
                result[url] = mapping
            }
        }
        return result
    } else {
        return {}
    }
}
