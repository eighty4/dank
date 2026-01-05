import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import esbuild from 'esbuild'
import { workersPlugin } from '../lib/esbuild.ts'
import { type DankBuild } from '../lib/flags.ts'
import { WebsiteRegistry } from '../lib/metadata.ts'
import { testDir } from './dank_project_testing.ts'

test('worker plugin registers worker manifest', async () => {
    const dirs = await testDir()
    const build = { dirs } as DankBuild
    await writeFile(
        join(dirs.pagesResolved, 'mega-performant-ui-thread.ts'),
        `\
const w = new Worker('./computational-wizardry.ts')
w.onerror = console.error
`,
    )
    const registry = new WebsiteRegistry(build)
    let workersEvent = 0
    registry.on('workers', () => workersEvent++)
    for (let i = 0; i < 5; i++) {
        await esbuild.build({
            absWorkingDir: dirs.projectRootAbs,
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
