import { join, resolve } from 'node:path'
import { cwd } from 'node:process'
import type { DankConfig } from './dank.ts'

export type DankBuild = {
    dirs: ProjectDirs
    minify: boolean
    production: boolean
}

export type ProjectDirs = {
    buildRoot: string
    buildWatch: string
    buildDist: string
    pages: string
    pagesResolved: string
    projectResolved: string
    projectRootAbs: string
    public: string
}

export function resolveBuildFlags(): DankBuild {
    const flags: DankBuild = {
        dirs: defaultProjectDirs(cwd()),
        minify: willMinify(),
        production: isProductionBuild(),
    }
    return {
        get dirs(): ProjectDirs {
            return flags.dirs
        },
        get minify(): boolean {
            return flags.minify
        },
        get production(): boolean {
            return flags.production
        },
    }
}

export type DankServe = DankBuild & {
    dankPort: number
    esbuildPort: number
    logHttp: boolean
    preview: boolean
}

export function resolveServeFlags(c: DankConfig): DankServe {
    const preview = isPreviewBuild()
    const flags: DankServe = {
        dirs: defaultProjectDirs(cwd()),
        dankPort: dankPort(c, preview),
        esbuildPort: esbuildPort(c),
        logHttp: willLogHttp(),
        minify: willMinify(),
        preview,
        production: isProductionBuild(),
    }
    return {
        get dirs(): ProjectDirs {
            return flags.dirs
        },
        get dankPort(): number {
            return flags.dankPort
        },
        get esbuildPort(): number {
            return flags.esbuildPort
        },
        get logHttp(): boolean {
            return flags.logHttp
        },
        get minify(): boolean {
            return flags.minify
        },
        get preview(): boolean {
            return flags.preview
        },
        get production(): boolean {
            return flags.production
        },
    }
}

// `dank serve` will pre-bundle and use service worker
const isPreviewBuild = () =>
    process.env.PREVIEW === 'true' || process.argv.includes('--preview')

// `dank build` will minify sources and append git release tag to build tag
// `dank serve` will pre-bundle with service worker and minify
const isProductionBuild = () =>
    process.env.PRODUCTION === 'true' || process.argv.includes('--production')

// `dank serve` dank port for frontend webserver
// alternate --preview port for service worker builds
function dankPort(c: DankConfig, preview: boolean): number {
    if (process.env.DANK_PORT?.length) {
        return parsePortEnvVar('DANK_PORT')
    }
    return preview ? c.previewPort || c.port || 4000 : c.port || 3000
}

// `dank serve` esbuild port for bundler integration
function esbuildPort(c: DankConfig): number {
    if (process.env.ESBUILD_PORT?.length) {
        return parsePortEnvVar('ESBUILD_PORT')
    }
    return c.esbuild?.port || 3995
}

function parsePortEnvVar(name: string): number {
    const port = parseInt(process.env[name]!, 10)
    if (isNaN(port)) {
        throw Error(`env var ${name}=${port} must be a valid port number`)
    } else {
        return port
    }
}

export function defaultProjectDirs(projectRootAbs: string): ProjectDirs {
    const pages = 'pages'
    const dirs: ProjectDirs = {
        buildRoot: 'build',
        buildDist: join('build', 'dist'),
        buildWatch: join('build', 'watch'),
        pages,
        pagesResolved: resolve(join(projectRootAbs, pages)),
        projectResolved: resolve(projectRootAbs),
        projectRootAbs,
        public: 'public',
    }
    return {
        get buildRoot(): string {
            return dirs.buildRoot
        },
        get buildDist(): string {
            return dirs.buildDist
        },
        get buildWatch(): string {
            return dirs.buildWatch
        },
        get pages(): string {
            return dirs.pages
        },
        get pagesResolved(): string {
            return dirs.pagesResolved
        },
        get projectResolved(): string {
            return dirs.projectResolved
        },
        get projectRootAbs(): string {
            return dirs.projectRootAbs
        },
        get public(): string {
            return dirs.public
        },
    }
}

const willMinify = () =>
    isProductionBuild() ||
    process.env.MINIFY === 'true' ||
    process.argv.includes('--minify')

// `dank serve` will print http access logs to console
const willLogHttp = () =>
    process.env.LOG_HTTP === 'true' || process.argv.includes('--log-http')
