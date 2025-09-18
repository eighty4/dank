// serve.ts will pre-bundle and use service worker
export const isPreviewBuild = () =>
    process.env.PREVIEW === 'true' || process.argv.includes('--preview')

// build.ts will minify sources and append git release tag to build tag
// serve.ts will pre-bundle with service worker and minify
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
