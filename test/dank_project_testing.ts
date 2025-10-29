import { exec, spawn } from 'node:child_process'
import EventEmitter from 'node:events'
import { readFile, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { waitForEsbuildServe } from './esbuild_events_testing.ts'
import { getAvailablePort, waitForPort } from './ports.ts'

export async function dankBuild(cwd: string): Promise<void> {
    await new Promise<void>((res, rej) => {
        exec('npm run build', { cwd }, (err, stdout) => {
            if (err) {
                rej(Error('`npm run build` error', { cause: err }))
            }
            res()
        })
    })
}

export type DankServingEvents = {
    error: [e: Error]
    exit: [e: Error]
}

export class DankServing extends EventEmitter<DankServingEvents> {
    #dankPort: number
    #esbuildPort: number
    #output: string = ''

    constructor(dankPort: number, esbuildPort: number) {
        super()
        this.#dankPort = dankPort
        this.#esbuildPort = esbuildPort
    }

    appendOutput(s: string) {
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
}

export async function dankServe(
    cwd: string,
    signal: AbortSignal,
): Promise<DankServing> {
    const dankPort = await getAvailablePort()
    const esbuildPort = await getAvailablePort(dankPort)
    const serving = new DankServing(dankPort, esbuildPort)

    const env = {
        ...process.env,
        DANK_PORT: `${dankPort}`,
        ESBUILD_PORT: `${esbuildPort}`,
    }
    const dankServe = spawn('npm', ['run', 'dev'], { cwd, env, signal })
    dankServe.stdout.on('data', chunk => serving.appendOutput(chunk.toString()))
    dankServe.stderr.on('data', chunk => serving.appendOutput(chunk.toString()))
    dankServe.on('error', e => {
        if (e.name !== 'AbortError') {
            serving.emit('error', new Error('`dank serve` error', { cause: e }))
        }
    })
    dankServe.on('exit', exitCode => {
        if (exitCode !== null && exitCode !== 0) {
            serving.emit(
                'exit',
                Error('`dank serve` exited with non-zero exit code'),
            )
        }
    })

    try {
        await waitForPort(dankPort)
        await waitForEsbuildServe(esbuildPort)
    } catch (e) {
        throw Error('timed out waiting for `dank serve`', { cause: e })
    }

    return serving
}

export async function createDank(): Promise<string> {
    const dir = join(await mkdtemp(join(tmpdir(), 'dank-test-')), 'www')
    await new Promise<void>(res => {
        exec('node create-dank/create.ts --out-dir ' + dir, (err, stdout) => {
            if (err) {
                throw Error('`node create-dank/create.ts` error', {
                    cause: err,
                })
            }
            res()
        })
    })
    await readReplaceWrite(
        join(dir, 'package.json'),
        /"@eighty4\/dank": ".*"/,
        `"@eighty4/dank": "file:${dirname(import.meta.dirname)}"`,
    )
    await new Promise<void>(res => {
        exec('npm i', { cwd: dir }, (err, stdout) => {
            if (err) {
                console.error('failed npm i:', err.message)
                process.exit(1)
            }
            res()
        })
    })
    return dir
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
