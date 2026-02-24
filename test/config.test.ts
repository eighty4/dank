import assert from 'node:assert/strict'
import { suite, test } from 'node:test'
import { createDank } from './dank_project_testing.ts'

suite('config.ts', () => {
    suite('ResolvedDankConfig', () => {
        test('builds default build tag', async () => {
            const project = await createDank()
            const config = await project.loadConfig()
            assert.ok(/^\d{4}-\d{2}-\d{2}-\d{8}$/.test(await config.buildTag()))
        })

        test('builds expression string build tag', async () => {
            const project = await createDank()
            await project.writeConfig(`\
import {defineConfig} from '@eighty4/dank'

export default defineConfig({
    buildTag: 'build-{{ timeMS }}',
    pages: { '/': './home.html' },
})`)
            const config = await project.loadConfig()
            assert.ok(/^build-\d{8}$/.test(await config.buildTag()))
        })

        test('builds builder function build tag', async () => {
            const project = await createDank()
            await project.writeConfig(`\
import {defineConfig} from '@eighty4/dank'

export default defineConfig({
    buildTag: () => Promise.resolve('yoda-eats-{{ timeMS }}'),
    pages: { '/': './home.html' },
})`)
            const config = await project.loadConfig()
            assert.ok(/^yoda-eats-[\d]{8}$/.test(await config.buildTag()))
        })
    })
})
