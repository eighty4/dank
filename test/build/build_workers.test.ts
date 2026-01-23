import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { suite, test } from 'node:test'
import { createDank } from '../dank_project_testing.ts'

suite('building web workers', () => {
    suite('succeeds', () => {
        test('rewriting worker url with build hash', async () => {
            for (const ctor of ['Worker', 'SharedWorker']) {
                const project = await createDank({
                    files: {
                        'pages/dank.ts': `\
                            const w = new ${ctor}('./computational-wizardry.ts')
                            w.onerror = console.error`,
                        'pages/computational-wizardry.ts': '',
                    },
                })
                await project.build()
                const output = await readBundleOutput(project.dir, 'dank.ts')
                const pattern = new RegExp(
                    `new ${ctor}\\('\\/computational-wizardry-[A-Z\\d]{8}\\.js'\\)`,
                    'g',
                )
                assert.ok(pattern.test(output))
                assert.equal(
                    await readBundleOutput(
                        project.dir,
                        'computational-wizardry.ts',
                    ),
                    '',
                )
            }
        })
    })
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
