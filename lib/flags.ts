// `dank serve` override for dank port
export function dankPort(): number | undefined {
    if (process.env.DANK_PORT?.length) {
        return parsePortEnvVar('DANK_PORT')
    }
}

// `dank serve` override for esbuild port
export function esbuildPort(): number | undefined {
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

// `dank serve` will print http access logs to console
export const isLogHttp = () =>
    process.env.LOG_HTTP === 'true' || process.argv.includes('--log-http')

// `dank serve` will pre-bundle and use service worker
export const isPreviewBuild = () =>
    process.env.PREVIEW === 'true' || process.argv.includes('--preview')

// `dank build` will minify sources and append git release tag to build tag
// `dank serve` will pre-bundle with service worker and minify
export const isProductionBuild = () =>
    process.env.PRODUCTION === 'true' || process.argv.includes('--production')

export const willMinify = () =>
    isProductionBuild() ||
    process.env.MINIFY === 'true' ||
    process.argv.includes('--minify')

export const willTsc = () =>
    isProductionBuild() ||
    process.env.TSC === 'true' ||
    process.argv.includes('--tsc')
