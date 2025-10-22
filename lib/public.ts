import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { DankBuild } from './flags.ts'

export async function copyAssets(
    build: DankBuild,
): Promise<Array<string> | null> {
    try {
        const stats = await stat(build.dirs.public)
        if (stats.isDirectory()) {
            await mkdir(build.dirs.buildDist, { recursive: true })
            return await recursiveCopyAssets(build)
        } else {
            throw Error('./public cannot be a file')
        }
    } catch (e) {
        return null
    }
}

async function recursiveCopyAssets(
    build: DankBuild,
    dir: string = '',
): Promise<Array<string>> {
    const copied: Array<string> = []
    const to = join(build.dirs.buildDist, dir)
    let madeDir = dir === ''
    const listingDir = join(build.dirs.public, dir)
    for (const p of await readdir(listingDir)) {
        try {
            const stats = await stat(join(listingDir, p))
            if (stats.isDirectory()) {
                copied.push(...(await recursiveCopyAssets(build, join(dir, p))))
            } else {
                if (!madeDir) {
                    await mkdir(join(build.dirs.buildDist, dir))
                    madeDir = true
                }
                await copyFile(join(listingDir, p), join(to, p))
                copied.push('/' + join(dir, p).replaceAll('\\', '/'))
            }
        } catch (e) {
            console.error('stat error', e)
            process.exit(1)
        }
    }
    return copied
}
