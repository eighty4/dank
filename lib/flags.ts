export type DankFlags = {
    dankPort?: number
    esbuildPort?: number
    logHttp: boolean
    minify: boolean
    preview: boolean
    production: boolean
}

export function resolveFlags(): Readonly<DankFlags> {
    return Object.freeze({
        dankPort: resolveDankPort(),
        esbuildPort: resolveEsbuildPort(),
        logHttp: willLogHttp(),
        minify: willMinify(),
        preview: isPreviewBuild(),
        production: isProductionBuild(),
    })
}

// `dank serve` will pre-bundle and use service worker
const isPreviewBuild = () =>
    process.env.PREVIEW === 'true' || process.argv.includes('--preview')

// `dank build` will minify sources and append git release tag to build tag
// `dank serve` will pre-bundle with service worker and minify
const isProductionBuild = () =>
    process.env.PRODUCTION === 'true' || process.argv.includes('--production')

// `dank serve` port for frontend webserver
function resolveDankPort(): number | undefined {
    if (process.env.DANK_PORT?.length) {
        return parsePortEnvVar('DANK_PORT')
    }
}

// `dank serve` port for esbuild bundler integration
function resolveEsbuildPort(): number | undefined {
    if (process.env.ESBUILD_PORT?.length) {
        return parsePortEnvVar('ESBUILD_PORT')
    }
}

function parsePortEnvVar(name: string): number {
    const port = parseInt(process.env[name]!, 10)
    if (isNaN(port)) {
        throw Error(`env var ${name}=${port} must be a valid port number`)
    } else {
        return port
    }
}

const willMinify = () =>
    isProductionBuild() ||
    process.env.MINIFY === 'true' ||
    process.argv.includes('--minify')

// `dank serve` will print http access logs to console
const willLogHttp = () =>
    process.env.LOG_HTTP === 'true' || process.argv.includes('--log-http')
