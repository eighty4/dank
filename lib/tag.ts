import { exec } from 'node:child_process'
import { isProductionBuild } from './flags.ts'

export async function createBuildTag(): Promise<string> {
    const now = new Date()
    const ms =
        now.getUTCMilliseconds() +
        now.getUTCSeconds() * 1000 +
        now.getUTCMinutes() * 1000 * 60 +
        now.getUTCHours() * 1000 * 60 * 60
    const date = now.toISOString().substring(0, 10)
    const time = String(ms).padStart(8, '0')
    const when = `${date}-${time}`
    if (isProductionBuild()) {
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
