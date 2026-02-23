import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { platform } from 'node:os'
import { join } from 'node:path'
import type { DankDirectories } from './dirs.ts'

export async function copyAssets(
    dirs: DankDirectories,
): Promise<Array<`/${string}`> | null> {
    try {
        const stats = await stat(dirs.public)
        if (stats.isDirectory()) {
            await mkdir(dirs.buildDist, { recursive: true })
            return await recursiveCopyAssets(dirs)
        } else {
            throw Error('./public cannot be a file')
        }
    } catch (e) {
        return null
    }
}

const IGNORE = platform() === 'darwin' ? ['.DS_Store'] : []

async function recursiveCopyAssets(
    dirs: DankDirectories,
    dir: string = '',
): Promise<Array<`/${string}`>> {
    const copied: Array<`/${string}`> = []
    const to = join(dirs.buildDist, dir)
    let madeDir = dir === ''
    const listingDir = join(dirs.public, dir)
    for (const p of await readdir(listingDir)) {
        if (IGNORE.includes(p)) {
            continue
        }
        try {
            const stats = await stat(join(listingDir, p))
            if (stats.isDirectory()) {
                copied.push(...(await recursiveCopyAssets(dirs, join(dir, p))))
            } else {
                if (!madeDir) {
                    await mkdir(join(dirs.buildDist, dir), {
                        recursive: true,
                    })
                    madeDir = true
                }
                await copyFile(join(listingDir, p), join(to, p))
                copied.push(`/${join(dir, p).replaceAll('\\', '/')}`)
            }
        } catch (e) {
            console.error('stat error', e)
            process.exit(1)
        }
    }
    return copied
}
