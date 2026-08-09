import { ChannelEventLogger } from '../database.ts'
import { DANK_CHANNEL_NAME } from '../messaging.ts'

export class DANK_DEV_BroadcastChannel extends BroadcastChannel {
    readonly #L?: ChannelEventLogger

    constructor(name: string) {
        super(name)
        if (name !== DANK_CHANNEL_NAME) {
            this.#L = new ChannelEventLogger({ name })
            this.#L.create()
            this.addEventListener('messageerror', this.#onMessageError)
        }
    }

    postMessage(message: any) {
        super.postMessage(message)
        this.#L?.messagePost(message)
    }

    close() {
        super.close()
        this.removeEventListener('messageerror', this.#onMessageError)
        this.#L?.close()
    }

    #onMessageError(e: MessageEvent) {
        this.#L?.messageError(e)
    }
}
