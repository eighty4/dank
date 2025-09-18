import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { join as fsJoin } from 'node:path'

const cached: Array<string> = ['/icons/logo.svg']

// written to /assets/sidelines in outRoot
export async function copyAssets(
    outRoot: string,
): Promise<{ all: Array<string>; cached: Array<string> }> {
    outRoot = fsJoin(outRoot, 'assets', 'sidelines')
    await mkdir(outRoot, { recursive: true })
    const copied = (await recursiveCopyAssets(outRoot, '')).map(
        p => '/assets/sidelines' + p,
    )
    return {
        all: copied,
        cached: copied.filter(p => cached.includes(p)),
    }
}

async function recursiveCopyAssets(
    outRoot: string,
    dir: string,
): Promise<Array<string>> {
    const copied: Array<string> = []
    const to = fsJoin(outRoot, dir)
    let madeDir = dir === ''
    for (const p of await readdir(fsJoin('public', dir))) {
        try {
            const stats = await stat(fsJoin('public', dir, p))
            if (stats.isDirectory()) {
                copied.push(
                    ...(await recursiveCopyAssets(outRoot, fsJoin(dir, p))),
                )
            } else {
                if (!madeDir) {
                    await mkdir(fsJoin(outRoot, dir))
                    madeDir = true
                }
                await copyFile(fsJoin('public', dir, p), fsJoin(to, p))
                copied.push('/' + fsJoin(dir, p).replaceAll('\\', '/'))
            }
        } catch (e) {
            console.error('stat error', e)
            process.exit(1)
        }
    }
    return copied
}
