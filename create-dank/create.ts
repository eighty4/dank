#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// fallbacks for npm packages if network error
const FALLBACKS: Record<string, string> = {
    '@eighty4/dank': '0.0.0',
    'npm': '11.6.1',
    'pnpm': '10.17.1',
}

function isCorepackEnabled(): boolean {
    return !!process.env['COREPACK_ROOT']?.length
}

function isCorepackBundled(): boolean {
    return nodeMajorVersion() < 25
}

const runtime: 'bun' | 'node' | 'unknown' = (function resolveRuntime() {
    if ('Bun' in globalThis) {
        return 'bun'
    } else if (process.versions.node) {
        return 'node'
    } else {
        return 'unknown'
    }
})()

const packageManager: 'bun' | 'npm' | 'pnpm' = (function resolvePackageManager() {
    if (process.env['npm_config_user_agent']?.includes('pnpm')) {
        return 'pnpm'
    } else if (process.env['npm_lifecycle_event'] === 'bunx') {
        return 'bun'
    } else {
        return 'npm'
    }
})()

if (process.argv.some(arg => arg === '-h' || arg === '--help')) {
    printHelp()
}

function printHelp(e?: string): never {
    if (e) printError(e)
    console.log(packageManager, 'create dank [OPTIONS...] --out-dir OUT_DIR')
    console.log()
    console.log('OPTIONS:')
    if (!isCorepackEnabled()) {
        console.log(`   --corepack         ${packageManager === 'bun' || runtime === 'bun' ? `${red('✗')} not applicable for Bun` : `Use latest version of ${packageManager} via corepack`}`)
    }
    console.log('   --package-name     Specify name for package.json')
    process.exit(1)
}

function runtimeNativeTS() {
    if (runtime !== 'node') {
        return true
    } else {
        return nodeMajorVersion() >= 24
    }
}

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
    corepack: boolean
    outDir: string
    packageName?: string
}

const opts: CreateDankOpts = (function parseCreateOpts() {
    const result: Partial<CreateDankOpts> = {
        corepack: isCorepackEnabled(),
    }
    let shifted: string | undefined
    while ((shifted = args.shift())) {
        switch (shifted) {
            case '--corepack':
                result.corepack = true
                break
            case '--out-dir':
                if (typeof (shifted = args.shift()) === 'undefined' || shifted.startsWith('--')) {
                    printHelp('--out-dir value is missing')
                }
                result.outDir = shifted
                break
            case '--package-name':
                if (typeof (shifted = args.shift()) === 'undefined' || shifted.startsWith('--')) {
                    printHelp('--package-name value is missing')
                }
                result.packageName = shifted
                break
        }
    }
    if (!result.outDir) {
        printHelp('--out-dir is required')
    }
    return result as CreateDankOpts
})()

try {
    await mkdir(opts.outDir)
} catch {
    errorExit(opts.outDir + ' already exists')
}

await Promise.all(
    ['pages', 'public'].map(subdir => mkdir(join(opts.outDir, subdir))),
)

const latestVersion = await getLatestVersion('@eighty4/dank')

type PackageManagerJson = '' | `\n    "packageManager": "${'npm'|'pnpm'}@${string}",`

const packageManagerJson = await (async function resolveVersion(): Promise<PackageManagerJson> {
    if (opts.corepack) {
        switch (packageManager) {
            case 'npm':
            case 'pnpm':
                const version = await getLatestVersion(packageManager)
                return `
    "packageManager": "${packageManager}@${version}",`
        }
    }
    return ''
})()

await Promise.all([
    await writeFile(
        join(opts.outDir, '.gitignore'),
        'build\nnode_modules\n',
    ),

    await writeFile(
        join(opts.outDir, 'package.json'),
        `\
{
    "name": "${opts.packageName || 'dank-n-eggs'}",
    "version": "0.0.0",${packageManagerJson}
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

    await writeFile(
        join(opts.outDir, runtimeNativeTS()  ? 'dank.config.ts' : 'dank.config.js'),
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
<!DOCTYPE html>
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
    color: #111;
    font-family: monospace;
    font-size: 1.5rem;
    margin-top: calc(50vh - 1rem);
    text-align: center;
}
`,
    ),
])

console.log(
    green('✔'),
    'created your',
    bold('dank'),
    'new project in',
    bold(/^(\.|\/)/.test(opts.outDir) ? opts.outDir : `./${opts.outDir}`),
)
console.log()
console.log('        cd', /^\.?\//.test(opts.outDir) ? opts.outDir : `./${opts.outDir}`)
if (opts.corepack && !isCorepackEnabled()) {
    if (!isCorepackBundled()) {
        console.log(`        ${packageManager} i -g corepack`)
    }
    console.log(`        corepack enable`)
}
console.log(`        ${packageManager} i`)
console.log(`        ${packageManager === 'npm' ? 'npm run' : packageManager} dev`)
console.log()
console.log('    Enjoy!')
console.log()

function nodeMajorVersion(): number {
    if (runtime !== 'node') {
        throw Error('not node')
    }
    const [major] = process.version.substring(1).split('.')
    return parseInt(major, 10)
}

async function getLatestVersion(packageName: string): Promise<string> {
    try {
        const response = await fetch(
            `https://registry.npmjs.org/${packageName}/latest`,
        )
        if (response.ok) {
            const { version } = await response.json()
            return version
        }
    } catch (error) {}
    return FALLBACKS[packageName]
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
