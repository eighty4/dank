import { DANK_DEV_BroadcastChannel } from './proxies/channels.ts'
import { DANK_DEV_SharedWorker, DANK_DEV_Worker } from './proxies/workers.ts'

globalThis.BroadcastChannel = DANK_DEV_BroadcastChannel
globalThis.Worker = DANK_DEV_Worker
globalThis.SharedWorker = DANK_DEV_SharedWorker

import './ui.ts'
