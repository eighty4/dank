import { isPortListening } from './ports.ts'
import type { EsbuildEvent } from '../client/esbuild.ts'

const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true'

export class EsbuildEvents {
    #buffer = ''
    #decoder = new TextDecoder('utf8')
    #events: Array<EsbuildEvent> = []
    #next: {
        reject: () => void
        resolve: (event: EsbuildEvent) => void
        timeout: ReturnType<typeof setTimeout>
    } | null = null
    #port: number
    #reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>> | null = null
    #controller: AbortController = new AbortController()

    constructor(port: number, debug: boolean = false) {
        this.#port = port
        this.#connect()
    }

    nextEvent(timeout: number = 6000): Promise<EsbuildEvent> {
        if (this.#next) throw Error()
        const next = this.#events.shift()
        if (next) {
            return Promise.resolve(next)
        } else {
            return new Promise(
                (resolve, reject) =>
                    (this.#next = {
                        resolve,
                        reject,
                        timeout: setTimeout(
                            () =>
                                reject(
                                    Error(
                                        'timeout awaiting next esbuild SSE event',
                                    ),
                                ),
                            timeout,
                        ),
                    }),
            )
        }
    }

    #connect() {
        fetch(`http://127.0.0.1:${this.#port}/esbuild`, {
            headers: new Headers({
                Accept: 'text/event-stream',
                'Cache-Control': 'no-cache',
            }),
            signal: this.#controller.signal,
        })
            .then(response => {
                if (DEBUG) console.log('sse connected')
                if (response.ok) {
                    this.#reader = response.body!.getReader()
                    this.#readUntilClosed()
                } else {
                    this.#connectRetry()
                }
            })
            .catch(e => {
                if (e.name !== 'AbortError') {
                    if (DEBUG) console.log('sse reconnect on fetch error')
                    this.#connectRetry()
                }
            })
    }

    #connectRetry() {
        setTimeout(() => this.#connect(), 10)
    }

    #consumeEvents() {
        let lastNewline = this.#buffer.lastIndexOf('\n\n')
        while (lastNewline !== -1) {
            const message = this.#buffer.substring(0, lastNewline)
            this.#buffer = this.#buffer.substring(lastNewline + 2)
            const dataMatch = message.match(/data: (.*)/)
            if (dataMatch) {
                this.#onEvent(JSON.parse(dataMatch[1]))
            }
            lastNewline = this.#buffer.lastIndexOf('\n\n')
        }
    }

    #onEvent(event: EsbuildEvent) {
        if (DEBUG) console.log('sse event: ' + JSON.stringify(event, null, 4))
        if (this.#next) {
            clearTimeout(this.#next.timeout)
            this.#next.resolve(event)
            this.#next = null
        } else {
            this.#events.push(event)
        }
    }

    #readUntilClosed() {
        this.#reader!.read()
            .then(
                (stream: ReadableStreamReadResult<Uint8Array<ArrayBuffer>>) => {
                    this.#buffer += this.#decoder.decode(stream.value, {
                        stream: true,
                    })
                    if (DEBUG) console.log(this.#buffer)
                    this.#consumeEvents()
                    if (!stream.done) {
                        this.#readUntilClosed()
                    }
                },
            )
            .catch(() => {
                if (DEBUG) console.log('sse reconnect on reader error')
                this.#connectRetry()
            })
    }

    [Symbol.dispose]() {
        if (DEBUG)
            console.debug('disposing esbuild SSE connection and event emitters')
        this.#controller.abort()
        this.#reader = null
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
