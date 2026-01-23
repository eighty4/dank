import type { Plugin as EsbuildPlugin } from 'esbuild'

export type DankConfig = {
    // used for releases and service worker caching
    // buildTag?:  (() => Promise<string> | string) | string

    // customize esbuild configs
    esbuild?: EsbuildConfig

    // mapping url to html files in the project pages dir
    // page url (map key) represents html output path in build dir
    // regardless of the html path in the pages dir
    // cdn url rewriting can be simulated with PageMapping
    pages: Record<`/${string}`, `${string}.html` | PageMapping>

    devPages?: Record<`/__${string}`, `${string}.html` | DevPageMapping>

    // port of `dank serve` frontend dev server
    // used for `dan serve --preview` if previewPort not specified
    port?: number

    // port used for `dank serve --preview` frontend dev server
    previewPort?: number

    // dev services launched during `dank serve`
    services?: Array<DevService>
}

// extend an html entrypoint with url rewriting similar to cdn configurations
// after trying all webpage, bundle and asset paths, mapping patterns
// will be tested in the alphabetical order of the webpage paths
export type PageMapping = {
    pattern?: RegExp
    webpage: `${string}.html`
}

export type DevPageMapping = {
    label: string
    webpage: `${string}.html`
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

// DankConfigFunction arg details about a dank process used when building DankConfig
export type DankDetails = {
    dev: boolean
    production: boolean
    mode: 'build' | 'serve'
}

export type DankConfigFunction = (
    dank: DankDetails,
) => Partial<DankConfig> | Promise<Partial<DankConfig>>

export function defineConfig(config: Partial<DankConfig>): Partial<DankConfig>
export function defineConfig(config: DankConfigFunction): DankConfigFunction
export function defineConfig(
    config: Partial<DankConfig> | DankConfigFunction,
): Partial<DankConfig> | DankConfigFunction {
    return config
}
