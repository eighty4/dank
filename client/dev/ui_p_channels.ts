import { decodeTime } from 'ulid'
import {
    ChannelEventKind,
    type ChannelRecord,
    readChannelEvents,
} from './database.ts'
import { DankDevPane } from './ui_pane.ts'
import {
    DankDevTimeSeries,
    type DankDevTimeSeriesEvent,
} from './ui_timeseries.ts'

async function readEvents(
    keyRange: IDBKeyRange | null,
    limit: number,
): Promise<Array<DankDevTimeSeriesEvent>> {
    return (await readChannelEvents(keyRange, limit)).map(mapRecordToEvent)
}

function mapRecordToEvent(record: ChannelRecord): DankDevTimeSeriesEvent {
    return {
        eventIcon: eventIcon(record.event),
        id: record.timeID,
        location: record.location,
        when: new Date(decodeTime(record.timeID)),
        resource: record.name,
        message: record.message ?? null,
        isMessageEvent: record.event === ChannelEventKind.PostMessage,
    }
}

function eventIcon(
    workerEvent: ChannelEventKind,
): DankDevTimeSeriesEvent['eventIcon'] {
    switch (workerEvent) {
        case ChannelEventKind.Create:
            return 'e-icon-create'
        case ChannelEventKind.PostMessage:
            return 'e-icon-message'
        case ChannelEventKind.MessageError:
            return 'e-icon-message-error'
        case ChannelEventKind.Close:
            return 'e-icon-close'
        default:
            throw TypeError()
    }
}

export class DankDevChannels extends HTMLElement {
    constructor() {
        super()
        this.append(new DankDevPane(new DankDevTimeSeries({ readEvents })))
    }
}

customElements.define('dank-dev-ui-channels', DankDevChannels)
