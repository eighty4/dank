import {
    type ChildProcess,
    type ChildProcessWithoutNullStreams,
    execSync,
    spawn,
} from 'node:child_process'
import EventEmitter from 'node:events'
import { basename, isAbsolute, resolve } from 'node:path'
import type { DevService, ResolvedDankConfig } from './config.ts'

export class ManagedServiceLabel {
    #command: string
    #cwd: string

    constructor(spec: DevService) {
        this.#command = spec.command
        this.#cwd = !spec.cwd
            ? './'
            : spec.cwd.startsWith('/')
              ? `/.../${basename(spec.cwd)}`
              : spec.cwd.startsWith('.')
                ? spec.cwd
                : `./${spec.cwd}`
    }

    get command(): string {
        return this.#command
    }

    get cwd(): string {
        return this.#cwd
    }
}

export type HttpService = NonNullable<DevService['http']>

export type DevServiceEvents = {
    error: [label: ManagedServiceLabel, cause: string]
    exit: [label: ManagedServiceLabel, code: number | string]
    launch: [label: ManagedServiceLabel]
    stdout: [label: ManagedServiceLabel, output: Array<string>]
    stderr: [label: ManagedServiceLabel, output: Array<string>]
}

class ManagedService extends EventEmitter<DevServiceEvents> {
    #label: ManagedServiceLabel
    #process: ChildProcess | null
    #spec: DevService
    // #status: ManagedServiceStatus = 'starting'

    constructor(spec: DevService) {
        super()
        this.#label = new ManagedServiceLabel(spec)
        this.#spec = spec
        this.#process = this.#start()
    }

    get spec(): DevService {
        return this.#spec
    }

    get httpSpec(): HttpService | undefined {
        return this.#spec.http
    }

    matches(other: DevService): boolean {
        return matchingConfig(this.#spec, other)
    }

    kill() {
        if (this.#process) killProcess(this.#process)
    }

    #start(): ChildProcess {
        const { path, args } = parseCommand(this.#spec.command)
        const env = this.#spec.env
            ? { ...process.env, ...this.#spec.env }
            : undefined
        const cwd =
            !this.#spec.cwd || isAbsolute(this.#spec.cwd)
                ? this.#spec.cwd
                : resolve(process.cwd(), this.#spec.cwd)
        const spawned = spawnProcess(path, args, env, cwd)
        this.emit('launch', this.#label)
        spawned.stdout.on('data', chunk =>
            this.emit('stdout', this.#label, parseChunk(chunk)),
        )
        spawned.stderr.on('data', chunk =>
            this.emit('stderr', this.#label, parseChunk(chunk)),
        )
        spawned.on('error', e => {
            if (e.name === 'AbortError') {
                return
            }
            const cause =
                'code' in e && e.code === 'ENOENT'
                    ? 'program not found'
                    : e.message
            this.emit('error', this.#label, cause)
        })
        spawned.on('exit', (code, signal) =>
            this.emit('exit', this.#label, code || signal!),
        )
        return spawned
    }
}

type SpawnProcess = (
    program: string,
    args: Array<string>,
    env: NodeJS.ProcessEnv | undefined,
    cwd: string | undefined,
) => ChildProcessWithoutNullStreams

type KillProcess = (p: ChildProcess) => void

const killProcess: KillProcess =
    process.platform === 'win32'
        ? p => execSync(`taskkill /pid ${p.pid} /T /F`)
        : p => p.kill()

const spawnProcess: SpawnProcess =
    process.platform === 'win32'
        ? (
              path: string,
              args: Array<string>,
              env: NodeJS.ProcessEnv | undefined,
              cwd: string | undefined,
          ) =>
              spawn('cmd', ['/c', path, ...args], {
                  cwd,
                  env,
                  detached: false,
                  shell: false,
                  windowsHide: true,
              })
        : (
              path: string,
              args: Array<string>,
              env: NodeJS.ProcessEnv | undefined,
              cwd: string | undefined,
          ) =>
              spawn(path, args, {
                  cwd,
                  env,
                  detached: false,
                  shell: false,
              })

export class DevServices extends EventEmitter<DevServiceEvents> {
    #running: Array<ManagedService>

    constructor(services: ResolvedDankConfig['services']) {
        super()
        this.#running = services ? this.#start(services) : []
        if (process.platform === 'win32') {
            process.once('SIGINT', () => process.exit())
        }
        process.once('exit', this.shutdown)
    }

    get httpServices(): Array<HttpService> {
        return this.#running.map(s => s.httpSpec).filter(http => !!http)
    }

    shutdown = () => {
        this.#running.forEach(s => {
            s.kill()
            s.removeAllListeners()
        })
        this.#running.length = 0
    }

    update(services: ResolvedDankConfig['services']) {
        if (!services?.length) {
            this.shutdown()
        } else if (
            !matchingConfigs(
                this.#running.map(s => s.spec),
                services,
            )
        ) {
            this.shutdown()
            this.#running = this.#start(services)
        }
    }

    #start(
        services: NonNullable<ResolvedDankConfig['services']>,
    ): Array<ManagedService> {
        return services.map(spec => {
            const service = new ManagedService(spec)
            service.on('error', (label, cause) =>
                this.emit('error', label, cause),
            )
            service.on('exit', (label, code) => this.emit('exit', label, code))
            service.on('launch', label => this.emit('launch', label))
            service.on('stdout', (label, output) =>
                this.emit('stdout', label, output),
            )
            service.on('stderr', (label, output) =>
                this.emit('stderr', label, output),
            )
            return service
        })
    }
}

function matchingConfigs(
    a: Array<DevService>,
    b: NonNullable<ResolvedDankConfig['services']>,
): boolean {
    if (a.length !== b.length) {
        return false
    }
    const crossRef = [...a]
    for (const toFind of b) {
        const found = crossRef.findIndex(spec => matchingConfig(spec, toFind))
        if (found === -1) {
            return false
        } else {
            crossRef.splice(found, 1)
        }
    }
    return true
}

function matchingConfig(a: DevService, b: DevService): boolean {
    if (a.command !== b.command) {
        return false
    }
    if (a.cwd !== b.cwd) {
        return false
    }
    if (!a.env && !b.env) {
        return true
    } else if (a.env && !b.env) {
        return false
    } else if (!a.env && b.env) {
        return false
    } else if (Object.keys(a.env!).length !== Object.keys(b.env!).length) {
        return false
    } else {
        for (const k of Object.keys(a.env!)) {
            if (!b.env![k]) {
                return false
            } else if (a.env![k] !== b.env![k]) {
                return false
            }
        }
    }
    return true
}

function parseChunk(c: Buffer): Array<string> {
    return c
        .toString()
        .replace(/\r?\n$/, '')
        .split(/\r?\n/)
}

export function parseCommand(command: string): {
    path: string
    args: Array<string>
} {
    command = command.trimStart()
    const programSplitIndex = command.indexOf(' ')
    if (programSplitIndex === -1) {
        return { path: command.trim(), args: [] }
    }
    const path = command.substring(0, programSplitIndex)
    const args: Array<string> = []
    let argStart = programSplitIndex + 1
    let withinLiteral: false | "'" | '"' = false
    for (let i = 0; i < command.length; i++) {
        const c = command[i]
        if (!withinLiteral) {
            if (c === "'" || c === '"') {
                withinLiteral = c
                continue
            }
            if (c === '\\') {
                i++
                continue
            }
        }
        if (withinLiteral) {
            if (c === withinLiteral) {
                withinLiteral = false
                args.push(command.substring(argStart + 1, i))
                argStart = i + 1
            }
            continue
        }
        if (c === ' ' && i > argStart) {
            const maybeArg = command.substring(argStart, i).trim()
            if (maybeArg.length) {
                args.push(maybeArg)
            }
            argStart = i + 1
        }
    }
    const maybeArg = command.substring(argStart, command.length).trim()
    if (maybeArg.length) {
        args.push(maybeArg)
    }
    return { path, args }
}
