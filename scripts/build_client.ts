#!/usr/bin/env node
import { join, resolve } from 'node:path'
import esbuild from 'esbuild'

const projectDir = resolve(join(import.meta.dirname, '..'))
const clientDir = join(projectDir, 'client')
const buildDir = join(clientDir, 'build')

const minify = false

await esbuild.build({
    absWorkingDir: clientDir,
    bundle: true,
    entryPoints: [
        'client.ts',
        ...['dw', 'sw'].map(w => ({
            in: `dev/bootstrap.${w}.ts`,
            out: 'bootstrap.' + w,
        })),
    ],
    format: 'esm',
    loader: {
        '.css': 'text',
        '.svg': 'text',
    },
    logLevel: 'info',
    minify,
    outdir: buildDir,
    platform: 'browser',
    splitting: false,
    target: 'ES2022',
    treeShaking: true,
})
