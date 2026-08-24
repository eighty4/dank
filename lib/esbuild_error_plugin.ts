import type {
    BuildFailure,
    BuildResult,
    Location,
    Message,
    Plugin,
    PluginBuild,
} from 'esbuild'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path/posix'
import type { DankDirectories } from './dirs.ts'
import { buildMessageLocation } from './esbuild_messages.ts'
import {
    printEsbuildBuildFailureMessages,
    printEsbuildRecovered,
} from './errors.ts'
import type {
    WebsiteRegistry,
    WorkerClientManifest,
    WorkerManifest,
} from './registry.ts'

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
        if (isIifeTopLevelAwait(m)) {
            enhanceIifeTopLevelAwaitMessage(m)
        } else {
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
}

function isIifeTopLevelAwait(m: Message): boolean {
    return (
        m.text ===
        'Top-level await is currently not supported with the "iife" output format'
    )
}

function enhanceIifeTopLevelAwaitMessage(m: Message) {
    m.text = `Top-level await is not supported with the "iife" output format used to bundle web workers`
}

async function enhanceUnresolvedWorkerEntrypointMessage(
    r: WebsiteRegistry,
    m: Message,
    unresolvePath: string,
    w: WorkerManifest,
) {
    const wc = w.clients[0]
    m.text = `Could not find ${wc.ctor} entrypoint "${unresolvePath}"`
    const location = await buildLocationOfWorkerClient(r.config.dirs, wc)
    if (location) {
        m.notes = [
            {
                text: `The ${wc.ctor} entrypoint was found in "${wc.script}":`,
                location,
            },
        ]
    }
}

async function buildLocationOfWorkerClient(
    dirs: DankDirectories,
    wc: WorkerClientManifest,
): Promise<Location | null> {
    const source = await readFile(join(dirs.projectRootAbs, wc.script), 'utf8')
    const workerUrl = RegExp.escape(wc.originalCtorSrc)
    const sourcePattern = new RegExp(
        `new(?:\\s|\\r?\\n)+${wc.ctor}(?:\\s|\\r?\\n)*\\((?:\\s|\\r?\\n)*(?<url>('${workerUrl}'|"${workerUrl}"))(?:\\s|\\r?\\n)*[),]`,
    )
    const sourceMatch = sourcePattern.exec(source)
    if (!sourceMatch) {
        return null
    }

    return buildMessageLocation(
        wc.script,
        source,
        sourceMatch.index + sourceMatch[0].indexOf(sourceMatch.groups!.url),
        sourceMatch.groups!.url.length,
    )
}
