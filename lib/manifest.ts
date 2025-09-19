import { writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

// catalog of build's filesystem output
export type BuildManifest = {
    buildTag: string
    files: Array<string>
}

// functional data for service worker
export type CacheManifest = {
    apiRoutes: Array<string>
    buildTag: string
    files: Array<string>
}

export async function writeBuildManifest(buildTag: string, files: Set<string>) {
    await writeJsonToBuildDir('manifest.json', {
        buildTag,
        files: Array.from(files).map(f =>
            extname(f).length
                ? f
                : f === '/'
                  ? '/index.html'
                  : f + '/index.html',
        ),
    })
}

export async function writeJsonToBuildDir(
    filename: `${string}.json`,
    json: any,
) {
    await writeFile(join('./build', filename), JSON.stringify(json, null, 4))
}

export async function writeMetafile(filename: `${string}.json`, json: any) {
    await writeJsonToBuildDir(
        join('metafiles', filename) as `${string}.json`,
        json,
    )
}

export async function writeCacheManifest(buildTag: string, files: Set<string>) {
    await writeJsonToBuildDir('cache.json', {
        apiRoutes: [],
        buildTag,
        files: Array.from(files).map(filenameToWebappPath),
    })
}

// drops index.html from path
function filenameToWebappPath(p: string): string {
    if (p === '/index.html') {
        return '/'
    } else if (p.endsWith('/index.html')) {
        return p.substring(0, p.length - '/index.html'.length) as `/${string}`
    } else {
        return p
    }
}
