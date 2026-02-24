import assert from 'node:assert/strict'
import { suite, test } from 'node:test'
import { createDank, DankCreated } from './dank_project_testing.ts'
import { EsbuildEvents } from './esbuild_events_testing.ts'

suite('`dank serve`', () => {
    suite('serving pages', () => {
        suite('on startup', () => {
            test('ships html, js and css', async () => {
                const project = await createDank()
                using dankServing = await project.serve()
                dankServing.on('error', assert.fail)
                dankServing.on('exit', assert.fail)
                await dankServing.start()
                await dankServing.assertFetchStatus('/', 200)
                await dankServing.assertFetchStatus('/dank.js', 200)
                await dankServing.assertFetchStatus('/dank.css', 200)
            })
        })

        suite('config reload', () => {
            test('updates page to new html fs path', async () => {
                const project = await createDank()
                using dankServing = await project.serve()
                dankServing.on('error', assert.fail)
                dankServing.on('exit', assert.fail)
                await dankServing.start()

                await project.update(
                    'pages/dankest.html',
                    '<p>Danky yoodle</p>',
                )
                await project.writeConfig(
                    `export default { pages: { '/': './dankest.html' } }`,
                    375,
                )
                await dankServing.assertFetchText('/', 'Danky yoodle')
            })
        })
    })

    suite('serving url rewrites', () => {
        suite('on startup', () => {
            test('matches page pattern', async () => {
                const project = await createDank()
                await project.writeConfig(`\
        export default {
            pages: {
                '/configure': {
                    pattern: /asdf/,
                    webpage: './dank.html',
                },
            },
        }`)
                using dankServing = await project.serve()
                dankServing.on('error', assert.fail)
                dankServing.on('exit', assert.fail)
                await dankServing.start()
                await dankServing.assertFetchStatus('/asdf', 200)
                await dankServing.assertFetchStatus('/configure', 200)
            })

            suite('--preview', () => {
                test('matches page pattern', async () => {
                    const project = await createDank()
                    await project.writeConfig(`\
        export default {
            pages: {
                '/configure': {
                    pattern: /asdf/,
                    webpage: './dank.html',
                },
            },
        }`)
                    using dankServing = await project.servePreview()
                    dankServing.on('error', assert.fail)
                    dankServing.on('exit', assert.fail)
                    await dankServing.start()
                    await dankServing.assertFetchStatus('/asdf', 200)
                    await dankServing.assertFetchStatus('/configure', 200)
                })
            })
        })

        suite('config reload', () => {
            test('picks up url rewrite', async () => {
                const project = await createDank()
                using dankServing = await project.serve()
                dankServing.on('error', assert.fail)
                dankServing.on('exit', assert.fail)
                await dankServing.start()
                await dankServing.assertFetchStatus('/', 200)
                await dankServing.assertFetchStatus('/asdf', 404)

                await project.writeConfig(
                    `export default { pages: { '/': { pattern: /asdf/, webpage: './dank.html' } } }`,
                )
                await dankServing.assertFetchStatus('/', 200)
                await dankServing.assertFetchStatus('/asdf', 200)
            })
        })
    })

    suite('serving esbuild events', () => {
        test(`fires update after modifying a webpage's bundles`, async () => {
            const project = await createDank()
            using dankServing = await project.serve()
            dankServing.on('error', assert.fail)
            dankServing.on('exit', assert.fail)
            await dankServing.start()
            using esbuildEvents = new EsbuildEvents(dankServing.esbuildPort)
            await project.update('pages/dank.ts', `console.log('hello')`)
            assert.equal((await esbuildEvents.nextEvent()).added.length, 2)
            await project.update('pages/dank.ts', `console.log('and goodbye')`)
            assert.equal((await esbuildEvents.nextEvent()).updated.length, 1)
        })

        test(`fires update after modifying a partial's bundles`, async () => {
            const project = await createDank({
                files: {
                    'pages/dank.html': DankCreated.html.replace(
                        /<\/head>/,
                        `<!-- {{ ./notification_ui.html }} -->\n</head>`,
                    ),
                    'pages/notification_ui.html':
                        '<link rel="stylesheet" href="./Notifications.css"/>\n<script type="module" src="./Notifications.ts"></script>',
                    'pages/Notifications.ts': `alert('notification')`,
                    'pages/Notifications.css': `dialog[open] { display: none; }`,
                },
            })
            using dankServing = await project.serve()
            dankServing.on('error', assert.fail)
            dankServing.on('exit', assert.fail)
            await dankServing.start()
            using esbuildEvents = new EsbuildEvents(dankServing.esbuildPort)
            await project.update(
                'pages/Notifications.ts',
                `document.querySelector('dialog').open = true`,
            )
            assert.deepEqual(
                (await esbuildEvents.nextEvent()).added.toSorted(),
                [
                    '/Notifications.css',
                    '/Notifications.js',
                    '/dank.css',
                    '/dank.js',
                ],
            )
            await project.update('pages/Notifications.css', '')
            assert.deepEqual(
                (await esbuildEvents.nextEvent()).updated.toSorted(),
                ['/Notifications.css'],
            )
        })
    })
})
