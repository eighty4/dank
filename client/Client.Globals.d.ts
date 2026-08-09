import { DANK_DEV_Worker, DANK_DEV_SharedWorker } from './workers.ts'

declare global {
    var DANK_DEV_Worker: DANK_DEV_Worker
    var DANK_DEV_SharedWorker: DANK_DEV_SharedWorker
}

export {}
