import { DANK_DEV_BroadcastChannel } from './dev/proxies/channels.ts'
import {
    DANK_DEV_SharedWorker,
    DANK_DEV_Worker,
} from './dev/proxies/workers.ts'

globalThis.BroadcastChannel = DANK_DEV_BroadcastChannel
globalThis.Worker = DANK_DEV_Worker
globalThis.SharedWorker = DANK_DEV_SharedWorker

import './dev/ui.ts'
import './esbuild.ts'
