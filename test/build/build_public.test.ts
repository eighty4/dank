import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { createDank, dankBuild, readTest } from '../dank_project_testing.ts'

// todo test content hashing on public assets and href rewriting
// todo test public asset subdirectories
test('public assets copied to build/dist', async () => {
    const testDir = await createDank()
    await dankBuild(testDir)
    assert.ok(
        await readTest(
            join(testDir, 'build', 'dist', '.webmanifest'),
            /"name": "Dank 'n Eggs"/,
        ),
    )
})
