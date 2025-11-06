import assert from 'node:assert/strict'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { test } from 'node:test'
import { createDank, dankBuild } from '../dank_project_testing.ts'

test('html entrypoint rewrites worker url', async () => {
    const testDir = await createDank()
    await writeFile(
        join(testDir, 'pages', 'dank.ts'),
        `\
        const w = new Worker('./computational-wizardry.ts')
        w.onerror = console.error
        `,
    )
    await writeFile(join(testDir, 'pages', 'computational-wizardry.ts'), ``)
    await dankBuild(testDir)

    const output = await readBundleOutput(testDir, 'dank.ts')
    assert.ok(
        /new Worker\('\/computational-wizardry-[A-Z\d]{8}\.js/.test(output),
    )
    assert.equal(
        await readBundleOutput(testDir, 'computational-wizardry.ts'),
        '',
    )
})

async function readBundleOutput(projectDir: string, entrypoint: string) {
    if (entrypoint.startsWith('pages')) {
        entrypoint = entrypoint.substring(6)
    }
    const ext = extname(entrypoint) === 'css' ? 'css' : 'js'
    const filename = basename(entrypoint)
    const dir = join(projectDir, 'build', 'dist', dirname(entrypoint))
    const files = await readdir(dir)
    const regex = new RegExp(
        `${filename.substring(0, filename.indexOf('.'))}-[A-Z\\d]{8}\\.${ext}$`,
    )
    const matches = files.filter(p => regex.test(p))
    switch (matches.length) {
        case 0:
            throw Error(`no matches in ${dir} for file ${basename(entrypoint)}`)
        case 1:
            return await readFile(join(dir, matches[0]), 'utf8')
        default:
            throw Error(
                `> 1 match in ${dir} for file ${basename(entrypoint)}: ${matches.join(', ')}`,
            )
    }
}
