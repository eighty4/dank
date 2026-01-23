#!/usr/bin/env node
import { join, resolve } from 'node:path'
import esbuild from 'esbuild'

const projectDir = resolve(join(import.meta.dirname, '..'))
const clientDir = join(projectDir, 'client')

await esbuild.build({
    logLevel: 'info',
    allowOverwrite: true,
    absWorkingDir: clientDir,
    entryPoints: ['client.ts'],
    outdir: clientDir,
    treeShaking: true,
    target: 'ES2022',
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    loader: {
        '.css': 'text',
    },
})
