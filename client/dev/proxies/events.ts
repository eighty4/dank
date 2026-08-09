import { createChannel } from '../messaging.ts'

const c = createChannel()

export function postChannelEvent() {
    c.postMessage({ kind: 'channel-event' })
}

export function postWorkerEvent() {
    c.postMessage({ kind: 'worker-event' })
}

export function postSharedWorkerEvent() {
    c.postMessage({ kind: 'shared-worker' })
}
