import assert from 'node:assert/strict'
import { suite, test } from 'node:test'
import { createDank, readTest } from '../dank_project_testing.ts'

// todo test content hashing on public assets and href rewriting
// todo test public asset subdirectories

suite('building public assets', () => {
    suite('succeeds', () => {
        test('copying to build/dist', async () => {
            const project = await createDank()
            await project.build()
            assert.ok(
                await readTest(
                    project.path('build', 'dist', '.webmanifest'),
                    /"name": "Dank 'n Eggs"/,
                ),
            )
        })
    })
})
