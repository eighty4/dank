import EventEmitter from 'node:events'
import { isPortListening } from './ports.ts'
import type { EsbuildEvent } from '../client/esbuild.ts'

type EsbuildEventsMap = {
    error: [Error]
}

export class EsbuildEvents extends EventEmitter<EsbuildEventsMap> {
    #events: Array<EsbuildEvent> = []
    #next: ((event: EsbuildEvent) => void) | null = null
    #port: number

    constructor(port: number) {
        super()
        this.#port = port
    }

    // assign returned promise without awaiting
    // await after AbortController.abort() as part of test wrapup
    async connect(signal: AbortSignal): Promise<void> {
        const response = await fetch(`http://127.0.0.1:${this.#port}/esbuild`, {
            headers: new Headers({
                Accept: 'text/event-stream',
            }),
            signal,
        })
        if (!response.ok) {
            throw Error('esbuild sse response ' + response.status)
        }
        this.#readUntilClosed(response.body!.getReader())
    }

    nextEvent(): Promise<EsbuildEvent> {
        if (this.#next) throw Error()
        const next = this.#events.shift()
        if (next) {
            return Promise.resolve(next)
        } else {
            return new Promise(res => (this.#next = res))
        }
    }

    async #readUntilClosed(
        reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>,
    ) {
        try {
            const decoder = new TextDecoder('utf-8')
            let buffer = ''
            let stream: ReadableStreamReadResult<Uint8Array<ArrayBuffer>>
            do {
                stream = await reader.read()
                buffer += decoder.decode(stream.value, { stream: true })
                let lastNewline = buffer.lastIndexOf('\n\n')
                while (lastNewline !== -1) {
                    const message = buffer.substring(0, lastNewline)
                    buffer = buffer.substring(lastNewline + 2)
                    const dataMatch = message.match(/data: (.*)/)
                    if (dataMatch) {
                        this.#onEvent(JSON.parse(dataMatch[1]))
                    }
                    lastNewline = buffer.lastIndexOf('\n\n')
                }
            } while (!stream.done)
        } catch (e: any) {
            if (e.name !== 'AbortError') {
                this.emit(
                    'error',
                    Error('error streaming esbuild sse', { cause: e }),
                )
            }
        }
    }

    #onEvent(event: EsbuildEvent) {
        if (this.#next) {
            this.#next(event)
            this.#next = null
        } else {
            this.#events.push(event)
        }
    }
}

export async function waitForEsbuildServe(esbuildPort: number) {
    const TIMEOUT = 10000
    const DELAY = 650
    const INTERVAL = 10
    await new Promise(res => setTimeout(res, DELAY))
    const timeout = Date.now() + (TIMEOUT - DELAY)
    do {
        await new Promise(res => setTimeout(res, INTERVAL))
        if (await isPortListening(esbuildPort)) {
            return
        }
    } while (Date.now() < timeout)
    throw Error(`esbuild did not start up in ${TIMEOUT}ms`)
}
