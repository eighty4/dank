import { decodeTime } from 'ulid'
import {
    readWorkerEvents,
    WorkerEventKind,
    type WorkerRecord,
} from './database.ts'
import { copy, isChromium, isFirefox } from './navigator.ts'
import { DankDevPane } from './ui_pane.ts'
import {
    DankDevTimeSeries,
    type DankDevTimeSeriesEvent,
} from './ui_timeseries.ts'

async function readEvents(
    keyRange: IDBKeyRange | null,
    limit: number,
): Promise<Array<DankDevTimeSeriesEvent>> {
    return (await readWorkerEvents(keyRange, limit)).map(mapRecordToEvent)
}

function mapRecordToEvent(record: WorkerRecord): DankDevTimeSeriesEvent {
    return {
        eventIcon: eventIcon(record.event),
        id: record.timeID,
        location: record.location,
        when: new Date(decodeTime(record.timeID)),
        resource: record.script,
        message: record.message ?? null,
        isMessageEvent:
            record.event === WorkerEventKind.PostMessage ||
            record.event === WorkerEventKind.OnMessage,
    }
}

function eventIcon(
    workerEvent: WorkerEventKind,
): DankDevTimeSeriesEvent['eventIcon'] {
    switch (workerEvent) {
        case WorkerEventKind.Create:
            return 'e-icon-create'
        case WorkerEventKind.PostMessage:
        case WorkerEventKind.OnMessage:
            return 'e-icon-message'
        case WorkerEventKind.MessageError:
            return 'e-icon-message-error'
        case WorkerEventKind.Error:
            return 'e-icon-error'
        case WorkerEventKind.Terminate:
            return 'e-icon-close'
        default:
            throw TypeError()
    }
}

export class DankDevWorkers extends HTMLElement {
    static footer(): HTMLElement | undefined {
        if (this.#sharedWorkerUsed) {
            if (isChromium()) {
                return new DankDevWorkersDebugLink(
                    'Chromium',
                    'chrome://inspect/#workers',
                )
            } else if (isFirefox()) {
                return new DankDevWorkersDebugLink(
                    'Firefox',
                    'about:debugging#/runtime/this-firefox',
                )
            }
        }
    }

    static sharedWorkerUsed() {
        DankDevWorkers.#sharedWorkerUsed = true
    }

    static #sharedWorkerUsed: boolean = false

    #pane: DankDevPane

    constructor() {
        super()
        this.append(
            (this.#pane = new DankDevPane(
                new DankDevTimeSeries({ readEvents }),
                DankDevWorkers.footer(),
            )),
        )
    }

    sharedWorkerUsed() {
        DankDevWorkers.#sharedWorkerUsed = true
        this.#pane.footer = DankDevWorkers.footer()
    }
}

class DankDevWorkersDebugLink extends HTMLElement {
    #url: string
    constructor(browser: 'Chromium' | 'Firefox', url: string) {
        super()
        this.#url = url
        this.innerHTML = `\
<div class="link">
    <span class="mask-icon"></span>
    <span class="text">Link to ${browser} SharedWorker logs</span>
</div>
`
        this.querySelector('.link')!.addEventListener('click', () => {
            copy(this.#url)
        })
    }
}

customElements.define('dank-dev-ui-workers', DankDevWorkers)
customElements.define('dank-dev-ui-workers-debug-link', DankDevWorkersDebugLink)
