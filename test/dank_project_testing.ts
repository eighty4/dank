import assert from 'node:assert'
import {
    type ChildProcessWithoutNullStreams,
    exec,
    spawn,
} from 'node:child_process'
import EventEmitter from 'node:events'
import { readFile, mkdir, mkdtemp, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { waitForEsbuildServe } from './esbuild_events_testing.ts'
import { getAvailablePort, waitForPort } from './ports.ts'
import { loadConfig, type ResolvedDankConfig } from '../lib/config.ts'
import type { WebsiteManifest } from '../lib/dank.ts'
import {
    defaultProjectDirs,
    Resolver,
    type DankDirectories,
} from '../lib/dirs.ts'

const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true'

const DANK_BIN_PATH = join(import.meta.dirname, '../lib/bin.ts')

export type DankProjectScaffolding = {
    // files to write to project dir from project root
    files?: Record<string, DankCreated | string>
    // html files to declare in `dank.config.ts`
    pages?: Record<`/${string}`, `./${string}.html`>
}

// scaffold a file from the `dank create` generated sources
export class DankCreated {
    #src: 'pages/dank.html' | 'pages/dank.css' | 'pages/dank.js'
    #ops: Array<{
        kind: 'replace'
        pattern: RegExp
        replace: string
    }>

    static get html(): DankCreated {
        return new DankCreated('pages/dank.html')
    }

    static get css(): DankCreated {
        return new DankCreated('pages/dank.html')
    }

    static get js(): DankCreated {
        return new DankCreated('pages/dank.html')
    }

    private constructor(
        src: 'pages/dank.html' | 'pages/dank.css' | 'pages/dank.js',
    ) {
        this.#src = src
        this.#ops = []
    }

    replace(pattern: RegExp, replace: string): this {
        this.#ops.push({
            kind: 'replace',
            pattern,
            replace,
        })
        return this
    }

    async result(dir: string): Promise<string> {
        let result = await readFile(join(dir, this.#src), 'utf8')
        for (const op of this.#ops) {
            if (op.kind === 'replace') {
                result = result.replace(op.pattern, op.replace)
            } else {
                throw Error(op.kind)
            }
        }
        return result
    }
}

// gen `dank.config.ts` and project files from DankProjectScaffolding
async function setupScaffolding(
    dir: string,
    scaffolding?: DankProjectScaffolding,
) {
    if (scaffolding?.pages) {
        if (!scaffolding?.files)
            throw Error(
                `scaffolding pages requires including file content with DankProjectScaffolding['files']`,
            )
        const missingFiles = Object.values(scaffolding.pages).filter(
            fsPath =>
                fsPath !== './dank.html' &&
                !scaffolding.files![fsPath.replace('./', 'pages/')],
        )
        if (missingFiles.length)
            throw Error(
                `scaffolding pages [${missingFiles.join(', ')}] requires including file content with DankProjectScaffolding['files']`,
            )
        await writeFile(
            join(dir, 'dank.config.ts'),
            `export default ${JSON.stringify({ pages: scaffolding.pages })}`,
        )
    }
    if (scaffolding?.files) {
        await writeScaffoldingFiles(dir, scaffolding.files)
    }
}

async function writeScaffoldingFiles(
    dir: string,
    files: NonNullable<DankProjectScaffolding['files']>,
) {
    await Promise.all(
        Object.entries(files).map(async ([path, content]) => {
            await writeScaffoldingFile(dir, path, content)
        }),
    )
}

async function writeScaffoldingFile(
    dir: string,
    path: string,
    content: DankCreated | string,
) {
    const filepath = join(dir, path)
    await mkdir(dirname(filepath), { recursive: true })
    if (typeof content === 'string') {
        await writeFile(filepath, content)
    } else {
        await writeFile(filepath, await content.result(dir))
    }
}

export type DankProjectShim = {
    dirs: DankDirectories
    resolver: Resolver
}

// lightweight testing against source files
// that do not require running `dank build` or `dank serve`
export async function testDir(
    scaffolding?: DankProjectScaffolding,
): Promise<DankProjectShim> {
    const dir = await mkdtemp(join(tmpdir(), 'dank-test-'))
    await Promise.all([mkdir(join(dir, 'pages')), mkdir(join(dir, 'public'))])
    await setupScaffolding(dir, scaffolding)
    const dirs = await defaultProjectDirs(await realpath(dir))
    return { dirs, resolver: Resolver.create(dirs) }
}

class DankTestProject {
    #dir: string

    constructor(dir: string) {
        this.#dir = dir
    }

    get dir(): string {
        return this.#dir
    }

    async loadConfig(
        mode: 'build' | 'serve' = 'build',
    ): Promise<ResolvedDankConfig> {
        return await loadConfig(mode, this.#dir)
    }

    async writeConfig(
        dankConfigTs: string,
        waitForConfigReload: number | false = 100,
    ) {
        await writeFile(this.path('dank.config.ts'), dankConfigTs)
        if (waitForConfigReload) {
            await new Promise(res => setTimeout(res, waitForConfigReload))
        }
    }

    async build(): Promise<void> {
        await dankBuild(this.#dir)
    }

    path(...p: Array<string>): string {
        return join(this.#dir, ...p)
    }

    async readFromBuild(path: string): Promise<string> {
        return await readFile(this.path(join('build/dist', path)), 'utf8')
    }

    async readManifest(): Promise<WebsiteManifest> {
        return JSON.parse(
            await readFile(this.path('build/website.json'), 'utf8'),
        )
    }

    async update(path: string, content: DankCreated | string) {
        await writeScaffoldingFile(this.#dir, path, content)
    }

    async updates(files: NonNullable<DankProjectScaffolding['files']>) {
        await writeScaffoldingFiles(this.#dir, files)
    }

    async serve(preview?: boolean): Promise<DankServing> {
        return await dankServe(this.#dir, preview)
    }

    async servePreview(): Promise<DankServing> {
        return await this.serve(true)
    }
}

export async function makeTempDir(): Promise<string> {
    return await mkdtemp(join(tmpdir(), 'dank-test-'))
}

export async function createDank(
    scaffolding?: DankProjectScaffolding,
): Promise<DankTestProject> {
    const dir = join(await makeTempDir(), 'www')
    await npmCreateDank(dir)
    await npmInstall(dir)
    await setupScaffolding(dir, scaffolding)
    return new DankTestProject(await realpath(dir))
}

async function npmCreateDank(dir: string) {
    await new Promise<void>((res, rej) => {
        exec(
            `node create-dank/create.ts --out-dir ${dir} 2>&1`,
            (err, stdout) => {
                if (err) {
                    rej(
                        Error('`node create-dank/create.ts` error', {
                            cause: err,
                        }),
                    )
                } else {
                    if (DEBUG) console.log(stdout)
                    res()
                }
            },
        )
    })
}

async function npmInstall(dir: string) {
    const absPathToDank = dirname(import.meta.dirname)
    await readReplaceWrite(
        join(dir, 'package.json'),
        /"@eighty4\/dank": ".*"/,
        `"@eighty4/dank": "file:${absPathToDank.replaceAll('\\', '\\\\')}"`,
    )
    await new Promise<void>((res, rej) => {
        let timeout: ReturnType<typeof setTimeout> | null = null
        const npmInstall = exec('npm i', { cwd: dir }, err => {
            if (timeout) clearTimeout(timeout)
            if (err) {
                rej(Error(`failed \`npm i\`: ${err.message}`))
            } else {
                res()
            }
        })
        const TIMEOUT = 20000
        timeout = setTimeout(() => {
            npmInstall.kill()
            rej(Error(`failed \`npm i\`: timed out after ${TIMEOUT / 1000}s`))
        }, TIMEOUT)
    })
}

async function dankBuild(cwd: string): Promise<void> {
    await new Promise<void>((res, rej) => {
        exec(`node ${DANK_BIN_PATH} build 2>&1`, { cwd }, (err, stdout) => {
            if (err) {
                if (DEBUG && stdout) console.log(stdout)
                rej(Error('`node lib/build.ts` error', { cause: err }))
            } else {
                if (DEBUG) console.log(stdout)
                res()
            }
        })
    })
}

async function dankServe(
    cwd: string,
    preview: boolean = false,
): Promise<DankServing> {
    const dankPort = await getAvailablePort()
    const esbuildPort = await getAvailablePort(dankPort)
    const serving = new DankServing(cwd, dankPort, esbuildPort, preview)
    return serving
}

export type DankServingEvents = {
    error: [e: Error]
    exit: [e: Error]
}

export class DankServing extends EventEmitter<DankServingEvents> {
    #cwd: string
    #dankPort: number
    #esbuildPort: number
    #output: string = ''
    #preview: boolean
    #process: ChildProcessWithoutNullStreams | null = null

    constructor(
        cwd: string,
        dankPort: number,
        esbuildPort: number,
        preview: boolean,
    ) {
        super()
        this.#cwd = cwd
        this.#dankPort = dankPort
        this.#esbuildPort = esbuildPort
        this.#preview = preview
    }

    async assertFetch(
        path: `/${string}`,
        cb: (r: Response) => Promise<void> | void,
    ) {
        await cb(await fetch(`http://localhost:${this.#dankPort}${path}`))
    }

    async assertFetchStatus(path: `/${string}`, status: number) {
        await this.assertFetch(path, r => assert.equal(r.status, status))
    }

    async assertFetchText(
        path: `/${string}`,
        pattern: RegExp | string | ((text: string) => Promise<void> | void),
    ) {
        await this.assertFetch(path, async r => {
            assert.equal(r.status, 200)
            const text = await r.text()
            if (typeof pattern === 'function') {
                await pattern(text)
            } else if (typeof pattern === 'string') {
                assert.ok(
                    text.includes(pattern),
                    `expected ${path} to include pattern \`${pattern}\``,
                )
            } else {
                assert.ok(
                    pattern.test(text),
                    `expected ${path} to match pattern \`${pattern.source}\``,
                )
            }
        })
    }

    async start() {
        const env = {
            ...process.env,
            DANK_PORT: `${this.dankPort}`,
            ESBUILD_PORT: `${this.esbuildPort}`,
        }
        const args = [DANK_BIN_PATH, 'serve']
        if (this.#preview) {
            args.push('--', '--preview')
        }
        // do not spawn `npm run dev` bc on windows process.kill an npm
        // process will not delegate shutdown to `dank serve` process
        this.#process = spawn('node', args, { cwd: this.#cwd, env })
        this.#process.stdout.on('data', chunk =>
            this.#appendOutput(chunk.toString()),
        )
        this.#process.stderr.on('data', chunk =>
            this.#appendOutput(chunk.toString()),
        )
        this.#process.on('error', e => {
            if (e.name !== 'AbortError') {
                this.emit(
                    'error',
                    new Error('`dank serve` error', { cause: e }),
                )
            }
        })
        this.#process.on('exit', exitCode => {
            if (exitCode !== null && exitCode !== 0) {
                this.emit(
                    'exit',
                    Error('`dank serve` exited with non-zero exit code'),
                )
                if (DEBUG) {
                    console.log(this.#output)
                }
            }
        })
        try {
            await waitForPort(this.dankPort)
            if (!this.#preview) {
                await waitForEsbuildServe(this.esbuildPort)
            }
        } catch (e) {
            throw Error('failed waiting for `dank serve` to be ready', {
                cause: e,
            })
        }
    }

    shutdown() {
        this.#process?.removeAllListeners()
        this.#process?.stdout.removeAllListeners()
        this.#process?.stderr.removeAllListeners()
        this.#process?.kill()
        this.removeAllListeners()
    }

    #appendOutput(s: string) {
        if (DEBUG) console.log(s)
        this.#output += s
    }

    get dankPort(): number {
        return this.#dankPort
    }

    get esbuildPort(): number {
        return this.#esbuildPort
    }

    get output(): string {
        return this.#output
    }

    [Symbol.dispose]() {
        if (DEBUG)
            console.debug('disposing `dank serve` process and event emitters')
        this.shutdown()
    }
}

export async function readReplaceWrite(
    p: string,
    pattern: RegExp,
    replace: string,
) {
    await writeFile(
        p,
        await readFile(p, 'utf8').then(s => s.replace(pattern, replace)),
    )
}

export async function readTest(
    p: string,
    ...pattern: Array<RegExp>
): Promise<boolean> {
    const content = await readFile(p, 'utf8')
    return pattern.every(pattern => pattern.test(content))
}

export async function fetchPageHtml(
    dankPort: number,
    path: `/${string}`,
    cb: (html: string) => void,
) {
    const INTERVAL = 50
    const TIMEOUT = 2000
    let start = Date.now()
    while (true) {
        await new Promise(res => setTimeout(res, INTERVAL))
        try {
            cb(
                await fetch(`http://127.0.0.1:${dankPort}${path}`).then(r =>
                    r.text(),
                ),
            )
            return
        } catch (e) {
            if (Date.now() - start > TIMEOUT) {
                throw e
            }
        }
    }
}
