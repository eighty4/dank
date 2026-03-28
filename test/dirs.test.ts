import assert from 'node:assert/strict'
import { join } from 'node:path'
import { suite, test } from 'node:test'
import { testDir } from './dank_project_testing.ts'

suite('dirs.ts', () => {
    suite('Resolver', () => {
        suite('isPagesSubpathResolvedToPagesDirSubpath', () => {
            test('resolves whether path is pages subdir', async () => {
                const { resolver } = await testDir()
                assert.equal(
                    resolver.isPagesSubpathResolvedToPagesDirSubpath(
                        './profile/Profile.html',
                    ),
                    true,
                )
                assert.equal(
                    resolver.isPagesSubpathResolvedToPagesDirSubpath(
                        '../profile/Profile.html',
                    ),
                    false,
                )
            })
            test('resolves whether path is pages subdir', async () => {
                const { resolver } = await testDir()
                assert.equal(
                    resolver.isPagesSubpathResolvedToPagesDirSubpath(
                        '/pages/profile/Profile.html',
                    ),
                    true,
                )
            })
        })
        suite('isPagesSubpathResolvedToProjectDirSubpath', () => {
            test('resolves whether path is project subdir', async () => {
                const { resolver } = await testDir()
                assert.equal(
                    resolver.isPagesSubpathResolvedToProjectDirSubpath(
                        './profile/Profile.html',
                    ),
                    true,
                )
                assert.equal(
                    resolver.isPagesSubpathResolvedToProjectDirSubpath(
                        '../profile/Profile.html',
                    ),
                    true,
                )
                assert.equal(
                    resolver.isPagesSubpathResolvedToProjectDirSubpath(
                        '../../profile/Profile.html',
                    ),
                    false,
                )
            })
        })
        suite('isProjectSubpathResolvedToPagesDirSubpath', () => {
            test('resolves whether path is project subdir', async () => {
                const { resolver } = await testDir()
                assert.equal(
                    resolver.isProjectSubpathResolvedToPagesDirSubpath(
                        './pages/profile/Profile.html',
                    ),
                    true,
                )
                assert.equal(
                    resolver.isProjectSubpathResolvedToPagesDirSubpath(
                        './profile/Profile.html',
                    ),
                    false,
                )
                assert.equal(
                    resolver.isProjectSubpathResolvedToPagesDirSubpath(
                        '../profile/Profile.html',
                    ),
                    false,
                )
            })
        })
        suite('isProjectSubpathResolvedToProjectDirSubpath', () => {
            test('resolves whether path is project subdir', async () => {
                const { resolver } = await testDir()
                assert.equal(
                    resolver.isProjectSubpathResolvedToProjectDirSubpath(
                        './pages/profile/Profile.html',
                    ),
                    true,
                )
                assert.equal(
                    resolver.isProjectSubpathResolvedToProjectDirSubpath(
                        './profile/Profile.html',
                    ),
                    true,
                )
                assert.equal(
                    resolver.isProjectSubpathResolvedToProjectDirSubpath(
                        '../profile/Profile.html',
                    ),
                    false,
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
