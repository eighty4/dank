import assert from 'node:assert/strict'
import { suite, test } from 'node:test'
import { createDank } from '../dank_project_testing.ts'

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

            await project.update('pages/dankest.html', '<p>Danky yoodle</p>')
            await project.writeConfig(
                `export default { pages: { '/': './dankest.html' } }`,
                375,
            )
            await dankServing.assertFetchText('/', 'Danky yoodle')
        })
    })
})
