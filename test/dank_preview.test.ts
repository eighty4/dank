import assert from 'node:assert/strict'
import { suite, test } from 'node:test'
import { createDank } from './dank_project_testing.ts'

suite('`dank preview`', () => {
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
