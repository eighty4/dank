import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import {
    createDank,
    dankServe,
    dankServePreview,
} from '../dank_project_testing.ts'

test('matches url rewrite on page pattern', async () => {
    const testDir = await createDank()
    await writeFile(
        join(testDir, 'dank.config.ts'),
        `\
export default {
    pages: {
        '/configure': {
            pattern: /asdf/,
            webpage: './Configure.html',
        },
    },
}
`,
    )
    await writeFile(
        join(testDir, 'pages', 'Configure.html'),
        `<p>Configuring</p>`,
    )
    using dankServing = await dankServe(testDir)
    dankServing.on('error', assert.fail)
    dankServing.on('exit', assert.fail)
    await dankServing.start()
    for (const path of ['/asdf', '/configure']) {
        const r = await fetch(`http://localhost:${dankServing.dankPort}${path}`)
        assert.equal(r.status, 200)
    }
})

test('resolves url rewrite html from preview dist', async () => {
    const testDir = await createDank()
    await writeFile(
        join(testDir, 'dank.config.ts'),
        `\
export default {
    pages: {
        '/configure': {
            pattern: /asdf/,
            webpage: './Configure.html',
        },
    },
}
`,
    )
    await writeFile(
        join(testDir, 'pages', 'Configure.html'),
        `<p>Configuring</p>`,
    )
    using dankServing = await dankServePreview(testDir)
    dankServing.on('error', assert.fail)
    dankServing.on('exit', assert.fail)
    await dankServing.start()
    for (const path of ['/asdf', '/configure']) {
        const r = await fetch(`http://localhost:${dankServing.dankPort}${path}`)
        assert.equal(r.status, 200)
    }
})
