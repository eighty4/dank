#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const args = (function collectProgramArgs(): Array<string> {
    const programNames: Array<string> = [
        // bunx / bun create / npm create
        'create-dank',
        // npx / pnpm
        'create.js',
        // node create.ts (for dev)
        'create.ts',
    ]
    let args = [...process.argv]
    while (true) {
        const shifted = args.shift()
        if (!shifted || programNames.some(name => shifted.endsWith(name))) {
            return args
        }
    }
})()

type CreateDankOpts = {
    outDir: string
}

const opts: CreateDankOpts = (function parseCreateOpts() {
    const result: Partial<CreateDankOpts> = {}
    let shifted: string | undefined
    while ((shifted = args.shift())) {
        switch (shifted) {
            case '--out-dir':
                if (typeof (shifted = args.shift()) === 'undefined') {
                    printHelp('--out-dir value is missing')
                }
                result.outDir = shifted
                break
        }
    }
    if (!result.outDir) {
        printHelp('--out-dir is required')
    }
    if (process.env.NODE_ENV !== 'production') console.log('opts', result)
    return result as CreateDankOpts
})()

try {
    await mkdir(opts.outDir)
} catch (e) {
    errorExit(opts.outDir + ' already exists')
}

await Promise.all(
    ['pages', 'public'].map(subdir => mkdir(join(opts.outDir, subdir))),
)

const latestVersion = await getLatestDankVersion()

await Promise.all([
    await writeFile(
        join(opts.outDir, 'package.json'),
        `\
{
    "name": "dank-n-eggs",
    "version": "0.0.0",
    "type": "module",
    "scripts": {
        "build": "dank build",
        "dev": "dank serve"
    },
    "devDependencies": {
        "@eighty4/dank": "${latestVersion}"
    }
}
`,
    ),

    // todo if runtime is node and version < 24, use .js
    await writeFile(
        join(opts.outDir, 'dank.config.ts'),
        `\
import { defineConfig } from '@eighty4/dank'

export default defineConfig({
    pages: {
        '/': 'dank.html',
    },
})
`,
    ),

    await writeFile(
        join(opts.outDir, 'pages', 'dank.html'),
        `\
<DOCTYPE!>
<html>
<head>
<title>Dank 'n Eggs</title>
<link rel="stylesheet" href="./dank.css"/>
</head>
<body>
<h1>Your skillet is ready.</h1>
</body>
</html>
`,
    ),

    await writeFile(
        join(opts.outDir, 'pages', 'dank.css'),
        `\
* {
    margin: 0;
    padding: 0;
}

h1 {
    font-family: monospace;
    text-align: center;
}
`,
    ),
])

// todo resolve bun, npm or pnpm for getting started instructions
console.log(
    green('✔'),
    'created your new',
    bold('dank'),
    'project in',
    bold(opts.outDir),
)
console.log()
console.log('        cd', opts.outDir)
console.log('        npm i')
console.log('        npm run dev')
console.log()
console.log('  Enjoy!')

async function getLatestDankVersion() {
    try {
        const response = await fetch(
            `https://registry.npmjs.org/@eighty4/dank/latest`,
        )
        if (response.ok) {
            const { version } = await response.json()
            return version
        }
    } catch (error) {}
    return '0.0.0'
}

function printHelp(e?: string): never {
    if (e) printError(e)
    process.exit(1)
}

function printError(e: string | Error) {
    if (typeof e === 'string') {
        console.log(red('error:'), e)
    } else {
        console.log(red('error:'), e.message)
        if (e.stack) {
            console.log(e.stack)
        }
    }
}

function errorExit(e: string | Error) {
    printError(e)
    process.exit(1)
}

function bold(s: string): string {
    return `\u001b[1m${s}\u001b[0m`
}

function green(s: string): string {
    return `\u001b[32m${s}\u001b[0m`
}

function red(s: string): string {
    return `\u001b[31m${s}\u001b[0m`
}
