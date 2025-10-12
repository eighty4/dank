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
