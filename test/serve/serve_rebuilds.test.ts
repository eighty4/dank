import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { createDank, dankServe } from '../dank_project_testing.ts'
import { EsbuildEvents } from '../esbuild_events_testing.ts'

// first esbuild event does full rebuild includes all entrypoints in `added`
// subsequent esbuild events include the modified entrypoint in `updated`
test('js and css entrypoints dispatch esbuild events', async () => {
    const testDir = await createDank()
    using dankServing = await dankServe(testDir)
    dankServing.on('error', assert.fail)
    dankServing.on('exit', assert.fail)
    await dankServing.start()
    using esbuildEvents = new EsbuildEvents(dankServing.esbuildPort)
    await writeFile(join(testDir, 'pages', 'dank.ts'), `console.log('hello')`)
    assert.equal((await esbuildEvents.nextEvent()).added.length, 2)

    await writeFile(
        join(testDir, 'pages', 'dank.ts'),
        `console.log('and goodbye')`,
    )
    assert.equal((await esbuildEvents.nextEvent()).updated.length, 1)
})
