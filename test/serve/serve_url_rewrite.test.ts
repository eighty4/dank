import assert from 'node:assert/strict'
import { suite, test } from 'node:test'
import { createDank } from '../dank_project_testing.ts'

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
