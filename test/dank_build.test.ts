import assert from 'node:assert/strict'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { suite, test } from 'node:test'
import {
    createDank,
    DankCreated,
    readReplaceWrite,
    readTest,
} from './dank_project_testing.ts'

suite('`dank build`', () => {
    suite('succeeds', () => {
        suite('building website.json manifest', () => {
            test('is written to build dir', async () => {
                const project = await createDank()
                const result = await project.build()
                result.assertSuccess()
                const websiteJson = await readFile(
                    project.path('build/website.json'),
                    'utf8',
                )
                const website = JSON.parse(websiteJson)
                assert.ok('buildTag' in website)
                assert.ok('files' in website)
                assert.ok('pageUrls' in website)
                assert.ok(website.files.includes('/index.html'))
                assert.ok(website.pageUrls.includes('/'))
            })
        })
        test('rewriting hrefs', async () => {
            const project = await createDank()
            const result = await project.build()
            result.assertSuccess()
            assert.ok(
                await readTest(
                    project.path('build', 'dist', 'index.html'),
                    /<script src="\/dank-[A-Z\d]{8}\.js" type="module"><\/script>/,
                ),
                `js script not found in ${project.path('build', 'dist', 'index.html')}`,
            )
            assert.ok(
                await readTest(
                    project.path('build', 'dist', 'index.html'),
                    /<link rel="stylesheet" href="\/dank-[A-Z\d]{8}\.css">/,
                ),
                `css link not found in ${project.path('build', 'dist', 'index.html')}`,
            )
        })

        test('resolves page and bundles configured in child dir', async () => {
            const project = await createDank({
                pages: {
                    '/': './dank.html',
                    '/subdir': './subdir/dank.html',
                },
                files: {
                    'pages/subdir/dank.html': `\
<link rel="stylesheet" href="./dank.css"/>
<script src="./dank.ts" type="module"></script>
`,
                    'pages/subdir/dank.css': `body { background: red; }`,
                    'pages/subdir/dank.ts': `console.log(document.body.style.background)`,
                },
            })
            const result = await project.build()
            result.assertSuccess()
            assert.ok(
                await readTest(
                    project.path('build', 'dist', 'index.html'),
                    /<script src="\/dank-[A-Z\d]{8}\.js" type="module"><\/script>/,
                    /<link rel="stylesheet" href="\/dank-[A-Z\d]{8}\.css">/,
                ),
                `bundles not found in ${project.path('build', 'dist', 'index.html')}`,
            )
            assert.ok(
                await readTest(
                    project.path('build', 'dist', 'subdir', 'index.html'),
                    /<script src="\/subdir\/dank-[A-Z\d]{8}\.js" type="module"><\/script>/,
                    /<link rel="stylesheet" href="\/subdir\/dank-[A-Z\d]{8}\.css">/,
                ),
                `bundles not found in ${project.path('build', 'dist', 'subdir', 'index.html')}`,
            )
        })

        test('resolves bundle in parent dir', async () => {
            const project = await createDank({
                pages: {
                    '/': './dank.html',
                    '/subdir': './subdir/dank.html',
                },
                files: {
                    'pages/subdir/dank.html': DankCreated.html
                        .replace(/\.\/dank\.ts/, '../dank.ts')
                        .replace(/\.\/dank\.css/, '../dank.css'),
                },
            })
            const result = await project.build()
            result.assertSuccess()
            assert.ok(
                await readTest(
                    project.path('build', 'dist', 'subdir', 'index.html'),
                    /<script src="\/dank-[A-Z\d]{8}\.js" type="module"><\/script>/,
                ),
                `js script not found in ${project.path('build', 'dist', 'subdir', 'index.html')}`,
            )
            assert.ok(
                await readTest(
                    project.path('build', 'dist', 'subdir', 'index.html'),
                    /<link rel="stylesheet" href="\/dank-[A-Z\d]{8}\.css">/,
                ),
                `css link not found in ${project.path('build', 'dist', 'subdir', 'index.html')}`,
            )
        })

        test('copying public assets to build/dist', async () => {
            const project = await createDank()
            const result = await project.build()
            result.assertSuccess()
            assert.ok(
                await readTest(
                    project.path('build', 'dist', '.webmanifest'),
                    /"name": "Dank 'n Eggs"/,
                ),
            )
        })

        test('writes build/metafiles webpages.json and workers.json', async () => {
            const project = await createDank({
                files: {
                    'pages/dank.ts': `\
                        const w = new Worker('./computational-wizardry.ts')
                        w.onerror = console.error`,
                    'pages/computational-wizardry.ts': '',
                },
            })
            const result = await project.build()
            result.assertSuccess()
            assert.ok(
                await readTest(
                    project.path('build', 'metafiles', 'webpages.json'),
                    /"inputs"/,
                    /"outputs"/,
                ),
            )
            assert.ok(
                await readTest(
                    project.path('build', 'metafiles', 'workers.json'),
                    /"inputs"/,
                    /"outputs"/,
                ),
            )
        })

        suite('es module importing css bundle', () => {
            test('added to build output and html document', async () => {
                const project = await createDank({
                    pages: {
                        '/': './dank.html',
                    },
                    files: {
                        'pages/dank.css':
                            'html, body { background: rebeccapurple; }',
                        'pages/list.module.css':
                            '.list { background: orange; }',
                        'pages/dank.ts': `import { makeList } from './list.ts'; document.body.appendChild(makeList())`,
                        'pages/list.ts': `import styles from './list.module.css'; export const makeList = () => { const ol = document.createElement('ol'); ol.classList.add(styles.list); return ol }`,
                    },
                })
                const result = await project.build()
                result.assertSuccess()
                assert.ok(
                    await readTest(
                        project.path('build/dist/index.html'),
                        /<link rel="stylesheet" href="\/dank-[A-Z\d]{8}\.css">/,
                        /<link rel="stylesheet" href="\/dank-[A-Z\d]{8}\.css">/,
                    ),
                    `css links not found in ${project.path('build/dist/index.html')}`,
                )
                await project.assertDistExists('dank.page.css')
                await project.assertDistExists('dank.css')
            })
        })
    })

    suite('errors', () => {
        test('importing from parent dir of pages dir', async () => {
            const project = await createDank()
            await readReplaceWrite(
                project.path('pages', 'dank.html'),
                /\.\/dank\.ts/,
                '../dank.ts',
            )
            const result = await project.build()
            result.assertFailed()
        })

        test('page does not exist', async () => {
            const project = await createDank()
            await rm(project.path('pages/dank.html'))
            const result = await project.build()
            result.assertFailed()
        })
    })

    suite('configuring afterBuild hook', () => {
        test('invokes function when configured', async () => {
            const project = await createDank()
            await project.writeConfig(`\
import { writeFileSync } from 'node:fs'
export default {
    pages: { '/': './dank.html' },
    afterBuild: ({website}) => {
        writeFileSync('test', 'test')
    }
}
`)
            const result = await project.build()
            result.assertSuccess()
            assert.equal(
                await readFile(join(project.dir, 'test'), 'utf8'),
                'test',
            )
        })

        test('works if null', async () => {
            const project = await createDank()
            await project.writeConfig(`\
import { writeFileSync } from 'node:fs'
export default {
    pages: { '/': './dank.html' },
    afterBuild: null,
}
`)
            const result = await project.build()
            result.assertSuccess()
        })

        test('awaits async function', async () => {
            const project = await createDank()
            await project.writeConfig(`\
import { writeFile } from 'node:fs/promises'
export default {
    pages: { '/': './dank.html' },
    afterBuild: async ({website}) => {
        await new Promise(res => setTimeout(res, 500))
        await writeFile('test', 'test')
    }
}
`)
            const result = await project.build()
            result.assertSuccess()
            assert.equal(
                await readFile(join(project.dir, 'test'), 'utf8'),
                'test',
            )
        })
    })
})
