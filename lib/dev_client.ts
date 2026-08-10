import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { join } from 'node:path/posix'
import type { ResolvedDankConfig } from './config.ts'

const [BOOTSTRAP_PAGE_JS, BOOTSTRAP_DW_JS, BOOTSTRAP_SW_JS, ESBUILD_CLIENT_JS] =
    (() => {
        const clientRoot = resolve(import.meta.dirname, join('../client/build'))
        return [
            'bootstrap.page.js',
            'bootstrap.dw.js',
            'bootstrap.sw.js',
            'esbuild.js',
        ].map(filename => {
            return readFile(join(clientRoot, filename), 'utf-8')
        })
    })()

export function prependDankDevPageJS(): Promise<string> {
    return BOOTSTRAP_PAGE_JS
}

export function prependDedicatedWorkerJS(): Promise<string> {
    return BOOTSTRAP_DW_JS
}

export function prependSharedWorkerJS(): Promise<string> {
    return BOOTSTRAP_SW_JS
}

// reads dank dev and esbuild clients and rewrites the esbuild port
export class PageClientJS {
    static #instance: PageClientJS | null = null

    static initialize(c: ResolvedDankConfig): PageClientJS | null {
        if (!c.isServeMode()) {
            return null
        } else if (!PageClientJS.#instance) {
            PageClientJS.#instance = new PageClientJS(
                c.useDankDevUI() ? BOOTSTRAP_PAGE_JS : null,
                ESBUILD_CLIENT_JS,
                c.esbuildPort,
            )
        }
        return PageClientJS.#instance
    }

    #dankDevJS: Promise<string> | null
    #esbuildJS: Promise<string>
    #esbuildPort: number
    #result: Promise<Array<string>>

    private constructor(
        dankDevJS: Promise<string> | null,
        esbuildJS: Promise<string>,
        esbuildPort: number,
    ) {
        this.#dankDevJS = dankDevJS
        this.#esbuildJS = esbuildJS
        this.#esbuildPort = esbuildPort
        this.#result = Promise.all(this.#buildPackagedJS())
    }

    async retrieve(esbuildPort: number): Promise<Array<string>> {
        if (esbuildPort !== this.#esbuildPort) {
            this.#esbuildPort = esbuildPort
            this.#result = Promise.all(this.#buildPackagedJS())
        }
        return this.#result
    }

    #buildPackagedJS(): Array<Promise<string>> {
        if (this.#dankDevJS) {
            return [this.#dankDevJS, this.#esbuildJS.then(this.#transform)]
        } else {
            return [this.#esbuildJS.then(this.#transform)]
        }
    }

    #transform = (js: string): string => {
        return js.replace('3995', '' + this.#esbuildPort)
    }
}
