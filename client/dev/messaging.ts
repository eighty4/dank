export const DANK_CHANNEL_NAME = '__DANK_DEV__'

export function createChannel(): DankDevBroadcastChannel {
    return new BroadcastChannel(DANK_CHANNEL_NAME)
}

export type DankDevBroadcastChannel = {
    onmessage: ((e: MessageEvent<DankDevEvent>) => void) | null
    postMessage(message: DankDevEvent): void
}

export type DankDevEvent =
    | {
          kind: 'channel-event'
      }
    | {
          kind: 'worker-event'
      }
    | {
          kind: 'shared-worker'
      }
