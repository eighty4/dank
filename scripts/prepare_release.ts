#!/usr/bin/env node
import { readdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import esbuild from 'esbuild'
import type { Plugin, OnLoadArgs, PluginBuild } from 'esbuild'

const projectDir = resolve(join(import.meta.dirname, '..'))
const libJsDir = join(projectDir, 'lib_js')
await rm(join(libJsDir, 'developer.js'), { force: true })

await esbuild.build({
    logLevel: 'info',
    allowOverwrite: true,
    absWorkingDir: libJsDir,
    entryPoints: await readdir(libJsDir),
    outdir: libJsDir,
    treeShaking: true,
    target: 'ES2024',
    bundle: false,
    minify: false,
    format: 'esm',
    platform: 'node',
    plugins: [plugin()],
})

function plugin(): Plugin {
    return {
        name: 'strip-developer-logging',
        setup(build: PluginBuild) {
            build.onLoad({ filter: /\.js$/ }, async (args: OnLoadArgs) => {
                return {
                    contents: stripDeveloperLogging(
                        await readFile(args.path, 'utf8'),
                    ),
                    loader: 'js',
                }
            })
        },
    }
}

function stripDeveloperLogging(contents: string): string {
    return contents
        .replace(
            /import\s*{\s*LOG\s*}\s*from\s*['"]\.\/developer.js['"];?/g,
            '',
        )
        .replace(/(?<!\.)LOG[\w$]*\s*\((?:[^()]+|\([^()]*\))*\);?/g, '')
}
