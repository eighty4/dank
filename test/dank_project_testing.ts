import {
    type ChildProcessWithoutNullStreams,
    exec,
    spawn,
} from 'node:child_process'
import EventEmitter from 'node:events'
import { readFile, realpath, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { waitForEsbuildServe } from './esbuild_events_testing.ts'
import { getAvailablePort, waitForPort } from './ports.ts'
import { defaultProjectDirs, type DankBuild } from '../lib/flags.ts'

const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true'

export async function testDir(): Promise<DankBuild['dirs']> {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'dank-test-')))
    const dirs = defaultProjectDirs(dir)
    await mkdir(join(dir, dirs.pages))
    await mkdir(join(dir, dirs.public))
    return dirs
}

export async function createDank(): Promise<string> {
    const dir = join(await mkdtemp(join(tmpdir(), 'dank-test-')), 'www')
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
    await readReplaceWrite(
        join(dir, 'package.json'),
        /"@eighty4\/dank": ".*"/,
        `"@eighty4/dank": "file:${dirname(import.meta.dirname)}"`,
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
        const TIMEOUT = 3000
        timeout = setTimeout(() => {
            npmInstall.kill()
            rej(Error(`failed \`npm i\`: timed out after ${TIMEOUT / 1000}s`))
        }, TIMEOUT)
    })
    return dir
}

export async function dankBuild(cwd: string): Promise<void> {
    await new Promise<void>((res, rej) => {
        exec('npm run build 2>&1', { cwd }, (err, stdout) => {
            if (err) {
                if (DEBUG && stdout) console.log(stdout)
                rej(Error('`npm run build` error', { cause: err }))
            } else {
                if (DEBUG) console.log(stdout)
                res()
            }
        })
    })
}

export async function dankServe(
    cwd: string,
    preview: boolean = false,
): Promise<DankServing> {
    const dankPort = await getAvailablePort()
    const esbuildPort = await getAvailablePort(dankPort)
    const serving = new DankServing(cwd, dankPort, esbuildPort, preview)
    return serving
}

export async function dankServePreview(cwd: string): Promise<DankServing> {
    return await dankServe(cwd, true)
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

    async start() {
        const env = {
            ...process.env,
            DANK_PORT: `${this.dankPort}`,
            ESBUILD_PORT: `${this.esbuildPort}`,
        }
        const args = ['run', 'dev']
        if (this.#preview) {
            args.push('--', '--preview')
        }
        this.#process = spawn('npm', args, { cwd: this.#cwd, env })
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
        this.#process?.removeAllListeners()
        this.#process?.stdout.removeAllListeners()
        this.#process?.stderr.removeAllListeners()
        this.#process?.kill()
        this.removeAllListeners()
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

export async function readTest(p: string, pattern: RegExp): Promise<boolean> {
    return pattern.test(await readFile(p, 'utf8'))
}

export async function fetchPageHtml(
    dankPort: number,
    path: `/${string}`,
    cb: (html: string) => void,
) {
    cb(await fetch(`http://127.0.0.1:${dankPort}${path}`).then(r => r.text()))
}
