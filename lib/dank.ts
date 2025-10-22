import type { Plugin as EsbuildPlugin } from 'esbuild'

export type DankConfig = {
    // used for releases and service worker caching
    // buildTag?:  (() => Promise<string> | string) | string

    // customize esbuild configs
    esbuild?: EsbuildConfig

    // mapping url to fs paths of webpages to build
    pages: Record<`/${string}`, `${string}.html`>

    // port of `dank serve` frontend dev server
    // used for `dan serve --preview` if previewPort not specified
    port?: number

    // port used for `dank serve --preview` frontend dev server
    previewPort?: number

    // dev services launched during `dank serve`
    services?: Array<DevService>
}

export type DevService = {
    command: string
    cwd?: string
    env?: Record<string, string>
    http?: {
        port: number
    }
}

export type EsbuildConfig = {
    // mapping of extensions to loaders
    // if not specified, defaults to support WOFF/WOFF2 fonts
    // with `{'.woff': 'file', '.woff2': 'file'}`
    loaders?: Record<`.${string}`, EsbuildLoader>

    // documented on https://esbuild.github.io/plugins
    plugins?: Array<EsbuildPlugin>

    // port used by esbuild.context() during `dank serve`
    // defaults to 3995
    port?: number
}

// documented on https://esbuild.github.io/content-types
export type EsbuildLoader =
    | 'base64'
    | 'binary'
    | 'copy'
    | 'dataurl'
    | 'empty'
    | 'file'
    | 'json'
    | 'text'

export async function defineConfig(
    c: Partial<DankConfig>,
): Promise<DankConfig> {
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
    validatePages(c.pages)
    validateDevServices(c.services)
    validateEsbuildConfig(c.esbuild)
    normalizePagePaths(c.pages)
    return c as DankConfig
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
    for (const [urlPath, htmlPath] of Object.entries(pages)) {
        if (typeof htmlPath !== 'string' || !htmlPath.endsWith('.html')) {
            throw Error(
                `DankConfig.pages['${urlPath}'] must configure an html file`,
            )
        }
    }
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

function normalizePagePaths(pages: any) {
    for (const urlPath of Object.keys(pages)) {
        pages[urlPath] = pages[urlPath].replace(/^\.\//, '')
    }
}
