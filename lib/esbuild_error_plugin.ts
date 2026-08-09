import type {
    BuildFailure,
    BuildResult,
    Message,
    Plugin,
    PluginBuild,
} from 'esbuild'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path/posix'
import { buildMessageLocation } from './esbuild_messages.ts'
import {
    printEsbuildBuildFailureMessages,
    printEsbuildRecovered,
} from './errors.ts'
import type { WebsiteRegistry, WorkerManifest } from './registry.ts'

// added to `esbuild.context({plugins})` to enhance errors logged by `esbuild.Context.serve()`
export function createErrorPlugin(r: WebsiteRegistry): Plugin {
    return {
        name: '@eighty4/dank/esbuild/errors',
        setup(build: PluginBuild) {
            if (!build.initialOptions.metafile)
                throw TypeError('plugin requires metafile')

            let prevHadErrors = false

            build.onEnd(async (result: BuildResult<{ metafile: true }>) => {
                if (result.errors.length) {
                    await enhanceEsbuildBuildFailure(r, result)
                    printEsbuildBuildFailureMessages(result)
                    prevHadErrors = true
                } else if (prevHadErrors) {
                    printEsbuildRecovered()
                    prevHadErrors = false
                }
            })
        },
    }
}

export async function enhanceEsbuildBuildFailure(
    r: WebsiteRegistry,
    e: Pick<BuildFailure, 'errors'>,
) {
    const unresolvedEntrypointPattern = new RegExp(
        /^Could not resolve "(?<p>.+?)"$/,
    )
    for (const m of e.errors) {
        const unresolvedEntrypointMatch = unresolvedEntrypointPattern.exec(
            m.text,
        )
        if (unresolvedEntrypointMatch) {
            const p = unresolvedEntrypointMatch.groups!.p.replace(
                /^\.[\/\\]/,
                '',
            )
            const w = r.workers!.find(w => w.entrypoint.in === p)
            if (w) {
                await enhanceUnresolvedWorkerEntrypointMessage(r, m, p, w)
            }
        }
    }
}

async function enhanceUnresolvedWorkerEntrypointMessage(
    r: WebsiteRegistry,
    m: Message,
    unresolvePath: string,
    w: WorkerManifest,
) {
    const workerClient = w.clients[0]
    m.text = `Could not find ${workerClient.ctor} entrypoint "${unresolvePath}"`
    const source = await readFile(
        join(r.config.dirs.projectRootAbs, workerClient.script),
        'utf8',
    )
    const workerUrl = RegExp.escape(workerClient.originalCtorSrc)
    const sourcePattern = new RegExp(
        `new(?:\\s|\\r?\\n)+${workerClient.ctor}(?:\\s|\\r?\\n)*\\((?:\\s|\\r?\\n)*(?<url>('${workerUrl}'|"${workerUrl}"))(?:\\s|\\r?\\n)*[),]`,
    )
    const sourceMatch = sourcePattern.exec(source)
    if (sourceMatch) {
        const location = buildMessageLocation(
            workerClient.script,
            source,
            sourceMatch.index + sourceMatch[0].indexOf(sourceMatch.groups!.url),
            sourceMatch.groups!.url.length,
        )
        m.notes = [
            {
                text: `The ${workerClient.ctor} entrypoint was found in "${workerClient.script}":`,
                location,
            },
        ]
    }
}
