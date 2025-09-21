import { spawn } from 'node:child_process'
import { basename, isAbsolute, resolve } from 'node:path'
import type { DankConfig, DevService } from './dank.ts'

export function startDevServices(c: DankConfig) {
    if (c.services?.length) {
        const ac = new AbortController()
        try {
            for (const s of c.services) {
                startService(s, ac.signal)
            }
        } catch (e) {
            ac.abort()
            throw e
        }
    }
}

function startService(s: DevService, signal: AbortSignal) {
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

    spawned.on('exit', () => {
        console.log(`[${s.command}]`, 'exit')
    })
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
