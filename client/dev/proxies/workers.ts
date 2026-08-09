import { WorkerCtorKind, WorkerEventLogger } from '../database.ts'
import { postSharedWorkerEvent } from './events.ts'

export class DANK_DEV_Worker extends Worker {
    readonly #L: WorkerEventLogger

    constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super(scriptURL, options)
        this.#L = new WorkerEventLogger({
            script: scriptURL instanceof URL ? scriptURL.toString() : scriptURL,
            ctor: WorkerCtorKind.Dedicated,
        })
        this.#L.create()
        this.addEventListener('error', this.#onError)
        this.addEventListener('message', this.#onMessage)
        this.addEventListener('messageerror', this.#onMessageError)
    }

    postMessage(message: any, transfer?: any) {
        this.#L.messagePost(message)
        super.postMessage(message, transfer)
    }

    terminate() {
        this.#L.closeOrTerminate()
        super.terminate()
        this.removeEventListener('error', this.#onError)
        this.removeEventListener('message', this.#onMessage)
        this.removeEventListener('messageerror', this.#onMessageError)
    }

    #onError(e: ErrorEvent) {
        this.#L.error(e)
    }

    #onMessage(e: MessageEvent<unknown>) {
        this.#L.messageReceive(e)
    }

    #onMessageError(e: MessageEvent<unknown>) {
        this.#L.messageError(e)
    }
}

export class DANK_DEV_SharedWorker extends SharedWorker {
    static #announce() {
        if (!this.#announced) {
            this.#announced = true
            postSharedWorkerEvent()
        }
    }
    static #announced: boolean = false
    readonly #L: WorkerEventLogger
    readonly #port: MessagePort
    readonly #portProxy: MessagePort

    constructor(scriptURL: string | URL, options?: string | WorkerOptions) {
        super(scriptURL, options)
        DANK_DEV_SharedWorker.#announce()
        this.#L = new WorkerEventLogger({
            script: scriptURL instanceof URL ? scriptURL.toString() : scriptURL,
            ctor: WorkerCtorKind.Shared,
        })
        this.#L.create()
        this.#port = this.port

        const portProxyRemoveListeners = () => {
            this.removeEventListener('error', this.#onError)
            this.#port.removeEventListener('message', this.#onMessage)
            this.#port.removeEventListener('messageerror', this.#onMessageError)
        }

        const portProxyLogMessage = (message: any) => {
            this.#L.messagePost(message)
        }

        this.#portProxy = new Proxy<MessagePort>(this.#port, {
            get(target, prop) {
                if (prop === 'close') {
                    return function () {
                        target.close()
                        portProxyRemoveListeners()
                    }
                } else if (prop === 'postMessage') {
                    return function (message: any, transfer?: any) {
                        target.postMessage(message, transfer)
                        portProxyLogMessage(message)
                    }
                } else {
                    const value = Reflect.get(target, prop, target)
                    return typeof value === 'function'
                        ? value.bind(target)
                        : value
                }
            },
            set(target, prop, value) {
                return Reflect.set(target, prop, value, target)
            },
        })

        this.addEventListener('error', this.#onError)
        this.#port.addEventListener('message', this.#onMessage)
        this.#port.addEventListener('messageerror', this.#onMessageError)

        Object.defineProperty(this, 'port', {
            get: () => this.#portProxy,
            enumerable: true,
            configurable: true,
        })
    }

    #onError(e: ErrorEvent) {
        this.#L.error(e)
    }

    #onMessage(e: MessageEvent<unknown>) {
        this.#L.messageReceive(e)
    }

    #onMessageError(e: MessageEvent<unknown>) {
        this.#L.messageError(e)
    }
}
