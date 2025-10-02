import { type ChildProcess, spawn } from 'node:child_process'
import { basename, isAbsolute, resolve } from 'node:path'
import type { DankConfig, DevService } from './dank.ts'

// up to date representation of dank.config.ts services
const running: Array<{ s: DevService; process: ChildProcess | null }> = []

let signal: AbortSignal

// batch of services that must be stopped before starting new services
let updating: null | {
    stopping: Array<DevService>
    starting: Array<DevService>
} = null

export function startDevServices(c: DankConfig, _signal: AbortSignal) {
    signal = _signal
    if (c.services?.length) {
        for (const s of c.services) {
            running.push({ s, process: startService(s) })
        }
    }
}

export function updateDevServices(c: DankConfig) {
    if (!c.services?.length) {
        if (running.length) {
            if (updating === null) {
                updating = { stopping: [], starting: [] }
            }
            running.forEach(({ s, process }) => {
                if (process) {
                    stopService(s, process)
                } else {
                    removeFromUpdating(s)
                }
            })
            running.length = 0
        }
    } else {
        if (updating === null) {
            updating = { stopping: [], starting: [] }
        }
        const keep = []
        const next: Array<DevService> = []
        for (const s of c.services) {
            let found = false
            for (let i = 0; i < running.length; i++) {
                const p = running[i].s
                if (matchingConfig(s, p)) {
                    found = true
                    keep.push(i)
                    break
                }
            }
            if (!found) {
                next.push(s)
            }
        }
        for (let i = running.length - 1; i >= 0; i--) {
            if (!keep.includes(i)) {
                const { s, process } = running[i]
                if (process) {
                    stopService(s, process)
                } else {
                    removeFromUpdating(s)
                }
                running.splice(i, 1)
            }
        }
        if (updating.stopping.length) {
            for (const s of next) {
                if (
                    !updating.starting.find(queued => matchingConfig(queued, s))
                ) {
                    updating.starting.push(s)
                }
            }
        } else {
            updating = null
            for (const s of next) {
                running.push({ s, process: startService(s) })
            }
        }
    }
}

function stopService(s: DevService, process: ChildProcess) {
    opPrint(s, 'stopping')
    updating!.stopping.push(s)
    process.kill()
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

function startService(s: DevService): ChildProcess {
    opPrint(s, 'starting')
    const splitCmdAndArgs = s.command.split(/\s+/)
    const cmd = splitCmdAndArgs[0]
    const args = splitCmdAndArgs.length === 1 ? [] : splitCmdAndArgs.slice(1)
    const spawned = spawn(cmd, args, {
        cwd: resolveCwd(s.cwd),
        env: s.env,
        signal,
        detached: false,
        shell: false,
    })

    const stdoutLabel = logLabel(s.cwd, cmd, args, 32)
    spawned.stdout.on('data', chunk => printChunk(stdoutLabel, chunk))

    const stderrLabel = logLabel(s.cwd, cmd, args, 31)
    spawned.stderr.on('data', chunk => printChunk(stderrLabel, chunk))

    spawned.on('error', e => {
        const cause =
            'code' in e && e.code === 'ENOENT' ? 'program not found' : e.message
        opPrint(s, 'error: ' + cause)
        removeFromRunning(s)
    })

    spawned.on('exit', () => {
        opPrint(s, 'exited')
        removeFromRunning(s)
        removeFromUpdating(s)
    })
    return spawned
}

function removeFromRunning(s: DevService) {
    for (let i = 0; i < running.length; i++) {
        if (matchingConfig(running[i].s, s)) {
            running.splice(i, 1)
            return
        }
    }
}

function removeFromUpdating(s: DevService) {
    if (updating !== null) {
        for (let i = 0; i < updating.stopping.length; i++) {
            if (matchingConfig(updating.stopping[i], s)) {
                updating.stopping.splice(i, 1)
                if (!updating.stopping.length) {
                    updating.starting.forEach(startService)
                    updating = null
                    return
                }
            }
        }
    }
}

function printChunk(label: string, c: Buffer) {
    for (const l of parseChunk(c)) console.log(label, l)
}

function parseChunk(c: Buffer): Array<string> {
    return c
        .toString()
        .replace(/\r?\n$/, '')
        .split(/\r?\n/)
}

function resolveCwd(p?: string): string | undefined {
    if (!p || isAbsolute(p)) {
        return p
    } else {
        return resolve(process.cwd(), p)
    }
}

function opPrint(s: DevService, msg: string) {
    console.log(opLabel(s), msg)
}

function opLabel(s: DevService) {
    return `\`${s.cwd ? s.cwd + ' ' : ''}${s.command}\``
}

function logLabel(
    cwd: string | undefined,
    cmd: string,
    args: Array<string>,
    ansiColor: number,
): string {
    cwd = !cwd
        ? './'
        : cwd.startsWith('/')
          ? `/.../${basename(cwd)}`
          : cwd.startsWith('.')
            ? cwd
            : `./${cwd}`
    return `\u001b[${ansiColor}m[\u001b[1m${cmd}\u001b[22m ${args.join(' ')} \u001b[2;3m${cwd}\u001b[22;23m]\u001b[0m`
}
