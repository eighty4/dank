import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { join } from 'node:path/posix'
import type { ResolvedDankConfig } from './config.ts'
import type {
    DankDevApiMethodKind,
    DankDevApiRequest,
    DankDevApiResponse,
    DankDevPage,
} from './dev_api.ts'

export async function dankDevApi<
    K extends DankDevApiMethodKind,
    REQ extends DankDevApiRequest<K>,
>(c: ResolvedDankConfig, req: REQ): Promise<DankDevApiResponse<K>> {
    return await apiHandlers[req.kind](c, req)
}

type DankDevApiHandlers = {
    [K in DankDevApiMethodKind]: DankDevApiHandler<K>
}

type DankDevApiHandler<K extends DankDevApiMethodKind> = (
    c: ResolvedDankConfig,
    req: DankDevApiRequest<K>,
) => Promise<DankDevApiResponse<K>>

const apiHandlers: DankDevApiHandlers = {
    'dev-pages': fetchDevPages,
}

async function fetchDevPages(
    c: ResolvedDankConfig,
    _: DankDevApiRequest<'dev-pages'>,
): Promise<DankDevApiResponse<'dev-pages'>> {
    const pages: Array<DankDevPage> = Object.entries(c.devPages).map(
        ([url, mapping]) => {
            return {
                url: url as `/${string}`,
                label: mapping.label || mapping.webpage,
            }
        },
    )
    return { kind: 'dev-pages', pages }
}

const [BOOTSTRAP_DW_JS, BOOTSTRAP_SW_JS, CLIENT_JS] = (() => {
    const clientRoot = resolve(import.meta.dirname, join('../client/build'))
    return ['bootstrap.dw.js', 'bootstrap.sw.js', 'client.js'].map(filename => {
        return readFile(join(clientRoot, filename), 'utf-8')
    })
})()

export function prependDedicatedWorkerJS(): Promise<string> {
    return BOOTSTRAP_DW_JS
}

export function prependSharedWorkerJS(): Promise<string> {
    return BOOTSTRAP_SW_JS
}

// reads client/client.js and rewrites the esbuild port
export class PageClientJS {
    static #instance: PageClientJS | null = null

    static initialize(c: ResolvedDankConfig): PageClientJS | null {
        if (!c.isServeMode()) {
            return null
        } else if (!PageClientJS.#instance) {
            PageClientJS.#instance = new PageClientJS(c.esbuildPort)
        }
        return PageClientJS.#instance
    }

    #esbuildPort: number
    #result: Promise<string>

    private constructor(esbuildPort: number) {
        this.#esbuildPort = esbuildPort
        this.#result = CLIENT_JS.then(this.#transform)
    }

    async retrieve(esbuildPort: number): Promise<string> {
        if (esbuildPort !== this.#esbuildPort) {
            this.#result = CLIENT_JS.then(this.#transform)
        }
        return await this.#result
    }

    #transform = (js: string): string => {
        return js.replace('3995', '' + this.#esbuildPort)
    }
}
