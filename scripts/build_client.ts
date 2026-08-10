#!/usr/bin/env node
import { join, resolve } from 'node:path'
import esbuild from 'esbuild'

const projectDir = resolve(join(import.meta.dirname, '..'))
const clientDir = join(projectDir, 'client')
const buildDir = join(clientDir, 'build')

const minify = false

const entryPoints = [
    'esbuild.ts',
    ...['page', 'dw', 'sw'].map(w => ({
        in: `dev/bootstrap.${w}.ts`,
        out: 'bootstrap.' + w,
    })),
]

await esbuild.build({
    absWorkingDir: clientDir,
    bundle: true,
    entryPoints,
    format: 'esm',
    loader: {
        '.css': 'text',
    },
    logLevel: 'info',
    minify,
    outdir: buildDir,
    platform: 'browser',
    splitting: false,
    target: 'ES2022',
    treeShaking: true,
})
