import assert from 'node:assert/strict'
import { suite, test } from 'node:test'
import { createDank } from './dank_project_testing.ts'

suite('Dev pages', () => {
    suite('`dank build`', () => {
        test('does not build dev pages', async () => {
            const project = await createDank({
                files: {
                    'pages/dev.html': '<script src="./dev.ts"></script>',
                    'pages/dev.ts': 'console.log()',
                },
            })
            await project.writeConfig(`\
import {defineConfig} from '@eighty4/dank'
export default defineConfig({
    devPages: {
        '/__': './dev.html',
    },
    pages: {
        '/': './dank.html',
    },
})
`)
            const result = await project.build()
            result.assertSuccess()
            project.assertDistExists('dev.html', false)
            project.assertDistExists('dev.js', false)
        })

        suite('errors', () => {
            test('when url does not start with /__', async () => {
                const project = await createDank({
                    files: {
                        'pages/dev.html': '<p>DEEEEEEEEEEEV</p>',
                    },
                })
                await project.writeConfig(`\
import {defineConfig} from '@eighty4/dank'
export default defineConfig({
    devPages: {
        '/_': './dev.html',
    },
    pages: {
        '/': './dank.html',
    },
})
`)
                const result = await project.build()
                result.assertFailed()
                result.assertOutput(
                    `DankConfig.devPages['/_'] url must start with \`/__\` path prefix`,
                )
            })
        })

        suite('with webpage path', () => {
            test('mapped to wrong extension file', async () => {
                const project = await createDank({
                    files: {
                        'pages/dev.html': '<p>DEEEEEEEEEEEV</p>',
                    },
                })
                await project.writeConfig(`\
    import {defineConfig} from '@eighty4/dank'
    export default defineConfig({
    devPages: {
        '/__': './dev.txt',
    },
    pages: {
        '/': './dank.html',
    },
})
    `)
                const result = await project.build()
                result.assertFailed()
                result.assertOutput(
                    `DankConfig.devPages['/__'] mapped to \`./dev.txt\` must be a path to an html file or DevPageMapping config`,
                )
            })

            test('not html filename', async () => {
                const project = await createDank({
                    files: {
                        'pages/dev.html': '<p>DEEEEEEEEEEEV</p>',
                    },
                })
                await project.writeConfig(`\
    import {defineConfig} from '@eighty4/dank'
    export default defineConfig({
    devPages: {
        '/__': './dev.txt',
    },
    pages: {
        '/': './dank.html',
    },
})
    `)
                const result = await project.build()
                result.assertFailed()
                result.assertOutput(
                    `DankConfig.devPages['/__'] mapped to \`./dev.txt\` must be a path to an html file or DevPageMapping config`,
                )
            })
        })

        suite('with DevPageMapping', () => {
            test('missing label', async () => {
                const project = await createDank({
                    files: {
                        'pages/dev.html': '<p>DEEEEEEEEEEEV</p>',
                    },
                })
                await project.writeConfig(`\
    import {defineConfig} from '@eighty4/dank'
    export default defineConfig({
    devPages: {
        '/__': {
            webpage: './dev.html'
        },
    },
    pages: {
        '/': './dank.html',
    },
})
    `)
                const result = await project.build()
                result.assertFailed()
                result.assertOutput(
                    `DankConfig.devPages['/__'].label is required`,
                )
            })
            test('webpage not html filename', async () => {
                const project = await createDank({
                    files: {
                        'pages/dev.html': '<p>DEEEEEEEEEEEV</p>',
                    },
                })
                await project.writeConfig(`\
    import {defineConfig} from '@eighty4/dank'
    export default defineConfig({
    devPages: {
        '/__': {
            label: 'Foos all on one dev page',
            webpage: './dev.txt',
        },
    },
    pages: {
        '/': './dank.html',
    },
})
    `)
                const result = await project.build()
                result.assertFailed()
                result.assertOutput(
                    `DankConfig.devPages['/__'].webpage mapped to \`./dev.txt\` must be a path to an html file`,
                )
            })
        })
    })

    suite('`dank serve`', () => {
        test('serves dev pages', async () => {
            const project = await createDank({
                files: {
                    'pages/dev.html': '<script src="./dev.ts"></script>',
                    'pages/dev.ts': 'console.log()',
                },
            })
            await project.writeConfig(`\
import {defineConfig} from '@eighty4/dank'
export default defineConfig({
    devPages: {
        '/__': './dev.html',
    },
    pages: {
        '/': './dank.html',
    },
})
`)
            using dankServing = await project.serve()
            dankServing.on('error', assert.fail)
            dankServing.on('exit', assert.fail)
            await dankServing.start()
            await dankServing.assertFetchStatus('/__', 'text/html', 200)
            await dankServing.assertFetchStatus('/dev.js', null, 200)
        })
    })

    suite('`dank preview`', () => {
        test('does not serve dev pages', async () => {
            const project = await createDank({
                files: {
                    'pages/dev.html': '<script src="./dev.ts"></script>',
                    'pages/dev.ts': 'console.log()',
                },
            })
            await project.writeConfig(`\
import {defineConfig} from '@eighty4/dank'
export default defineConfig({
    devPages: {
        '/__': './dev.html',
    },
    pages: {
        '/': './dank.html',
    },
})
`)
            using dankServing = await project.servePreview()
            dankServing.on('error', assert.fail)
            dankServing.on('exit', assert.fail)
            await dankServing.start()
            await dankServing.assertFetchStatus('/__', 'text/html', 404)
            await dankServing.assertFetchStatus('/dev.js', null, 404)
        })
    })
})
