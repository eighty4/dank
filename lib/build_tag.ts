import { exec } from 'node:child_process'
import type { DankFlags } from './flags.ts'

export async function createBuildTag(flags: DankFlags): Promise<string> {
    const now = new Date()
    const ms =
        now.getUTCMilliseconds() +
        now.getUTCSeconds() * 1000 +
        now.getUTCMinutes() * 1000 * 60 +
        now.getUTCHours() * 1000 * 60 * 60
    const date = now.toISOString().substring(0, 10)
    const time = String(ms).padStart(8, '0')
    const when = `${date}-${time}`
    if (flags.production) {
        const gitHash = await new Promise((res, rej) =>
            exec('git rev-parse --short HEAD', (err, stdout) => {
                if (err) rej(err)
                res(stdout.trim())
            }),
        )
        return `${when}-${gitHash}`
    } else {
        return when
    }
}
