import assert from 'node:assert/strict'
import { realpath, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import esbuild from 'esbuild'
import { workersPlugin } from '../lib/esbuild.ts'
import { type DankBuild } from '../lib/flags.ts'
import { WebsiteRegistry } from '../lib/metadata.ts'

test('worker plugin finds worker url in entrypoint', async () => {
    const projectDir = await realpath(
        await mkdtemp(join(tmpdir(), 'dank-test-')),
    )
    const pagesDir = join(projectDir, 'pages')
    await mkdir(pagesDir)
    await writeFile(
        join(pagesDir, 'mega-performant-ui-thread.ts'),
        `\
const w = new Worker('./computational-wizardry.ts')
w.onerror = console.error
`,
    )
    const build = {
        dirs: {
            projectRootAbs: projectDir,
            pagesResolved: pagesDir,
        },
    } as DankBuild
    const registry = new WebsiteRegistry(build)
    let workersEvent = 0
    registry.on('workers', () => workersEvent++)
    for (let i = 0; i < 5; i++) {
        await esbuild.build({
            absWorkingDir: projectDir,
            entryPoints: ['pages/mega-performant-ui-thread.ts'],
            metafile: true,
            plugins: [workersPlugin(registry.buildRegistry())],
            write: false,
        })
    }
    assert.equal(workersEvent, 1)
    assert.deepEqual(registry.workerEntryPoints(), [
        {
            in: 'pages/computational-wizardry.ts',
            out: 'computational-wizardry.js',
        },
    ])
})
