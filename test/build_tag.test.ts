import assert from 'node:assert/strict'
import { suite, test } from 'node:test'
import { createBuildTag } from '../lib/build_tag.ts'
import type { DankFlags } from '../lib/flags.ts'
import { testDir } from './dank_project_testing.ts'

suite('build_tag.ts', () => {
    suite('createBuildTag', () => {
        suite('default build tag', () => {
            test('combines date, timeMS and gitHash', async () => {
                const buildTag = await createBuildTag(
                    process.cwd(),
                    {} as DankFlags,
                )
                assert.ok(/^\d{4}-\d{2}-\d{2}-\d{8}-[a-f\d]{7}$/.test(buildTag))
            })
            test('omits date gitHash outside of git repo', async () => {
                const { dirs } = await testDir()
                const buildTag = await createBuildTag(
                    dirs.projectRootAbs,
                    {} as DankFlags,
                )
                assert.ok(/^\d{4}-\d{2}-\d{2}-\d{8}$/.test(buildTag))
            })
        })

        suite('build tag expression errors', () => {
            test('when non string', async () => {
                await assert.rejects(() =>
                    createBuildTag(
                        process.cwd(),
                        {} as DankFlags,
                        86 as any as string,
                    ),
                )
            })
            test('when unsupported expression param name', async () => {
                await assert.rejects(() =>
                    createBuildTag(
                        process.cwd(),
                        {} as DankFlags,
                        'make-{{ cajunJambalaya }}',
                    ),
                )
            })
            test('when expression has invalid characters', async () => {
                await assert.rejects(() =>
                    createBuildTag(process.cwd(), {} as DankFlags, 'make-$$$'),
                )
            })
            test('when expression uses `gitHash` outside of git repo', async () => {
                const { dirs } = await testDir()
                await assert.rejects(
                    () =>
                        createBuildTag(
                            dirs.projectRootAbs,
                            {} as DankFlags,
                            '{{ gitHash }}',
                        ),
                    (e: unknown) =>
                        (e as any).message ===
                        'buildTag cannot use `gitHash` in `{{ gitHash }}` outside of a git repository',
                )
            })
        })

        suite('build tag builder function', () => {
            test('passes production flag', async () => {
                const builder = (params: any) => {
                    if (params.production) {
                        return 'is-prod'
                    } else {
                        return 'is-not-prod'
                    }
                }
                assert.equal(
                    await createBuildTag(
                        process.cwd(),
                        { production: true } as DankFlags,
                        builder,
                    ),
                    'is-prod',
                )
                assert.equal(
                    await createBuildTag(
                        process.cwd(),
                        { production: false } as DankFlags,
                        builder,
                    ),
                    'is-not-prod',
                )
            })

            test('returns build tag as a promise', async () => {
                const buildTag = await createBuildTag(
                    process.cwd(),
                    {} as DankFlags,
                    () => Promise.resolve('asyncy-{{ gitHash }}'),
                )
                assert.ok(/^asyncy-[a-f\d]{7}$/.test(buildTag))
            })

            test('throw error when non string result', async () => {
                await assert.rejects(() =>
                    createBuildTag(process.cwd(), {} as DankFlags, () =>
                        Promise.resolve(86 as any as string),
                    ),
                )
            })
        })
    })
})
