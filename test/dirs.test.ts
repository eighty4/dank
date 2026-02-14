import assert from 'node:assert/strict'
import { join } from 'node:path'
import { suite, test } from 'node:test'
import { testDir } from './dank_project_testing.ts'

suite('dirs.ts', () => {
    suite('Resolver', () => {
        suite('isPagesSubpathInPagesDir', () => {
            test('resolves whether path is pages subdir', async () => {
                const { resolver } = await testDir()
                assert.equal(
                    resolver.isPagesSubpathInPagesDir('./profile/Profile.html'),
                    true,
                )
                assert.equal(
                    resolver.isPagesSubpathInPagesDir(
                        '../profile/Profile.html',
                    ),
                    false,
                )
            })
            test('resolves whether path is pages subdir', async () => {
                const { resolver } = await testDir()
                assert.equal(
                    resolver.isProjectSubpathInPagesDir(
                        '/pages/profile/Profile.html',
                    ),
                    true,
                )
            })
            test('resolves to the same results regardless of posix or windows paths', async () => {
                const { resolver } = await testDir()
                assert.equal(
                    resolver.isPagesSubpathInPagesDir(
                        '\\pages\\profile\\Profile.html',
                    ),
                    resolver.isPagesSubpathInPagesDir(
                        '/pages/profile/Profile.html',
                    ),
                )
                assert.equal(
                    resolver.isPagesSubpathInPagesDir(
                        '\\pages\\profile\\Profile.html',
                    ),
                    resolver.isPagesSubpathInPagesDir(
                        '/pages/profile/Profile.html',
                    ),
                )
            })
        })
        suite('projectPathFromAbsolute', () => {
            test('creates project path without slash prepend', async () => {
                const {
                    dirs: { projectRootAbs },
                    resolver,
                } = await testDir()
                assert.equal(
                    resolver.projectPathFromAbsolute(
                        join(projectRootAbs, 'pages/Profile.html'),
                    ),
                    'pages/Profile.html',
                )
            })
        })
    })
})
