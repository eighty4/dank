import type { Plugin as EsbuildPlugin } from 'esbuild'

export type DankMode = 'build' | 'preview' | 'serve'

// input to DankConfigFunction detailing a DANK process
export type DankDetails = {
    dev: boolean
    production: boolean
    mode: DankMode
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

export type DankConfig = {
    // used for service worker caching
    buildTag?: string | BuildTagBuilder

    // customize esbuild
    esbuild?: EsbuildConfig

    // explicit mapping of urls to webpages in the pages dir
    // the url with be the html output path in `build/dist`
    //   regardless of the html path in the pages dir
    // PageMapping extends webpage mapping with simulating
    //   of cdn style url rewrites
    pages: Record<`/${string}`, `${string}.html` | PageMapping>

    // enable additional development pages only during `dank serve`
    devPages?: Record<`/__${string}`, `${string}.html` | DevPageMapping>

    // port of `dank serve` frontend dev server
    // used for `dank preview` if previewPort not specified
    port?: number

    // port used for `dank preview` frontend dev server
    previewPort?: number

    // dev services launched during `dank serve` and `dank preview`
    services?: Array<DevService>

    // generate a service worker with `dank build --service-worker`
    // and when previewing with `dank preview --service-worker`
    serviceWorker?: ServiceWorkerBuilder

    afterBuild?: AfterBuild
}

export type BuildTagParams = {
    production: boolean
}

export type BuildTagBuilder = (
    build: BuildTagParams,
) => Promise<string> | string

// a webpage mapping that can be extended with cdn style url rewrites
export type PageMapping = {
    pattern?: RegExp
    webpage: `${string}.html`
}

export type DevPageMapping = {
    label: string
    webpage: `${string}.html`
}

// a process that is started up with `dank serve` and `dank preview`
export type DevService = {
    label?: string
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

// written to `build/website.json` and an input of ServiceWorkerBuilder
export type WebsiteManifest = {
    buildTag: string
    files: Array<`/${string}`>
    pageUrls: Array<`/${string}`>
}

export type ServiceWorkerParams = {
    website: WebsiteManifest
}

// result of a ServiceWorkerBuilder build
export type ServiceWorkerBuild = {
    // outputs will be written to `build/dist`
    // and added to the WebsiteManifest written to `build/website.json`
    outputs: Array<{
        url: `/${string}.js`
        content: string
    }>
}

// the signature of DankConfig.serviceWorker
export type ServiceWorkerBuilder = (
    params: ServiceWorkerParams,
) => ServiceWorkerBuild | Promise<ServiceWorkerBuild>

// APIs that can be used by a ServiceWorkerBuilder
export {
    createServiceWorker,
    type ServiceWorkerCaching,
} from './service_worker.ts'

export type AfterBuildArgs = {
    website: WebsiteManifest
}

// the signature of DankConfig.afterBuild
export type AfterBuild = (args: AfterBuildArgs) => Promise<void> | void
