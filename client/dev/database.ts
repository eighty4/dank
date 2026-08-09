import { ulid } from 'ulid'
import { getScriptLocation } from './location.ts'
import { postChannelEvent, postWorkerEvent } from './proxies/events.ts'

export const NO_LIMIT = -1

export enum ChannelEventKind {
    Create = 0,
    PostMessage = 1,
    MessageError = 2,
    Close = 3,
}

export type ChannelRecord = {
    timeID: string
    name: string
    location: string

    instanceID: string
    message?: string
    event: ChannelEventKind
}

export enum WorkerCtorKind {
    Dedicated = 0,
    Shared = 1,
}

export enum WorkerEventKind {
    Create = 0,
    PostMessage = 1,
    OnMessage = 2,
    MessageError = 3,
    Error = 4,
    Terminate = 5,
}

export type WorkerRecord = {
    timeID: string
    script: string
    location: string

    ctor: WorkerCtorKind
    instanceID: string
    event: WorkerEventKind
    message?: string
}

const OS_CHANNEL_LOG = 'channels-log'

const OSI_CHANNEL_LOG_BY_INSTANCE = OS_CHANNEL_LOG + '-by-instance'

const OS_WORKER_LOG = 'workers-log'

const OSI_WORKER_LOG_BY_INSTANCE = OS_WORKER_LOG + '-by-instance'

function connectToDB(): Promise<IDBDatabase> {
    return new Promise(async (res, rej) => {
        const opening = indexedDB.open('__DANK_DEV__')
        opening.onupgradeneeded = () => {
            const db = opening.result
            db.createObjectStore(OS_CHANNEL_LOG, {
                keyPath: 'timeID',
            }).createIndex(OSI_CHANNEL_LOG_BY_INSTANCE, [
                'instanceID',
                'timeID',
            ])
            db.createObjectStore(OS_WORKER_LOG, {
                keyPath: 'timeID',
            }).createIndex(OSI_WORKER_LOG_BY_INSTANCE, ['instanceID', 'timeID'])
        }
        opening.onsuccess = () => {
            res(opening.result)
        }
        opening.onerror = rej
    })
}

const connected = connectToDB()

function logRecord(os: typeof OS_CHANNEL_LOG, record: ChannelRecord): void
function logRecord(os: typeof OS_WORKER_LOG, record: WorkerRecord): void
function logRecord(
    os: typeof OS_CHANNEL_LOG | typeof OS_WORKER_LOG,
    record: ChannelRecord | WorkerRecord,
) {
    connected.then(db => {
        db.transaction(os, 'readwrite').objectStore(os).add(record)
    })
}

export async function readChannelEvents(
    keyRange: IDBKeyRange | null,
    limit: number,
): Promise<Array<ChannelRecord>> {
    return await readEvents(OS_CHANNEL_LOG, keyRange, limit)
}

export async function readWorkerEvents(
    keyRange: IDBKeyRange | null,
    limit: number,
): Promise<Array<WorkerRecord>> {
    return await readEvents(OS_WORKER_LOG, keyRange, limit)
}

async function readEvents<R>(
    os: typeof OS_CHANNEL_LOG | typeof OS_WORKER_LOG,
    keyRange: IDBKeyRange | null,
    limit: number,
): Promise<Array<R>> {
    const db = await connected
    return new Promise((res, rej) => {
        const tx = db.transaction(os, 'readonly')
        const req = tx.objectStore(os).openCursor(keyRange, 'prev')

        const results: Array<R> = []

        req.onsuccess = () => {
            if (req.result) {
                const cursor = req.result
                results.push(cursor.value)
                if (results.length !== limit) {
                    cursor.continue()
                }
            }
        }

        tx.oncomplete = () => res(results)
        tx.onerror = rej
    })
}

type ChannelEventLoggerInit = Pick<ChannelRecord, 'name'>

export class ChannelEventLogger {
    readonly #base: ChannelEventLoggerInit
    readonly #instanceID: string = ulid()

    constructor(init: ChannelEventLoggerInit) {
        this.#base = init
    }

    create() {
        this.#addEvent({ event: ChannelEventKind.Create })
    }

    messagePost(message: any) {
        this.#addEvent({
            event: ChannelEventKind.PostMessage,
            message: JSON.stringify(message),
        })
    }

    messageError(e: MessageEvent) {
        this.#addEvent({
            event: ChannelEventKind.MessageError,
            message: e.data,
        })
    }

    close() {
        this.#addEvent({ event: ChannelEventKind.Close })
    }

    #addEvent(e: Pick<ChannelRecord, 'event'> & Partial<ChannelRecord>) {
        postChannelEvent()
        logRecord(OS_CHANNEL_LOG, {
            ...e,
            ...this.#base,
            instanceID: this.#instanceID,
            location: getScriptLocation(),
            timeID: ulid(),
        })
    }
}

type WorkerEventLoggerInit = Pick<WorkerRecord, 'ctor' | 'script'>

export class WorkerEventLogger {
    #base: WorkerEventLoggerInit
    #instanceID: string = ulid()

    constructor(init: WorkerEventLoggerInit) {
        this.#base = init
    }

    create() {
        this.#addEvent({ event: WorkerEventKind.Create })
    }

    messagePost(message: any) {
        this.#addEvent({
            event: WorkerEventKind.PostMessage,
            message: JSON.stringify(message),
        })
    }

    messageReceive(e: MessageEvent) {
        this.#addEvent({
            event: WorkerEventKind.OnMessage,
            message: JSON.stringify(e.data),
        })
    }

    messageError(e: MessageEvent) {
        this.#addEvent({
            event: WorkerEventKind.MessageError,
            message: JSON.stringify(e.data),
        })
    }

    error(e: ErrorEvent) {
        this.#addEvent({
            event: WorkerEventKind.Error,
            message:
                e.error instanceof Error
                    ? e.error.message
                    : JSON.stringify(e.error),
        })
    }

    closeOrTerminate() {
        this.#addEvent({ event: WorkerEventKind.Terminate })
    }

    #addEvent(e: Pick<WorkerRecord, 'event'> & Partial<WorkerRecord>) {
        postWorkerEvent()
        logRecord(OS_WORKER_LOG, {
            ...e,
            ...this.#base,
            instanceID: this.#instanceID,
            location: getScriptLocation(),
            timeID: ulid(),
        })
    }
}
