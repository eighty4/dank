import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

export async function copyAssets(
    outRoot: string,
): Promise<Array<string> | null> {
    try {
        const stats = await stat('public')
        if (stats.isDirectory()) {
            await mkdir(outRoot, { recursive: true })
            return await recursiveCopyAssets(outRoot)
        } else {
            throw Error('./public cannot be a file')
        }
    } catch (e) {
        return null
    }
}

async function recursiveCopyAssets(
    outRoot: string,
    dir: string = '',
): Promise<Array<string>> {
    const copied: Array<string> = []
    const to = join(outRoot, dir)
    let madeDir = dir === ''
    for (const p of await readdir(join('public', dir))) {
        try {
            const stats = await stat(join('public', dir, p))
            if (stats.isDirectory()) {
                copied.push(
                    ...(await recursiveCopyAssets(outRoot, join(dir, p))),
                )
            } else {
                if (!madeDir) {
                    await mkdir(join(outRoot, dir))
                    madeDir = true
                }
                await copyFile(join('public', dir, p), join(to, p))
                copied.push('/' + join(dir, p).replaceAll('\\', '/'))
            }
        } catch (e) {
            console.error('stat error', e)
            process.exit(1)
        }
    }
    return copied
}
