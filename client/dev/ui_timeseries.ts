import { NO_LIMIT } from './database.ts'
import { copy } from './navigator.ts'

const PAGE_SIZE = 20
const PAGE_TRIGGER = Math.floor(PAGE_SIZE * 0.4)

export type DankDevTimeSeriesApi = {
    readEvents(
        keyRange: IDBKeyRange | null,
        limit: number,
    ): Promise<Array<DankDevTimeSeriesEvent>>
}

export type DankDevTimeSeriesEvent = {
    eventIcon:
        | 'e-icon-create'
        | 'e-icon-message'
        | 'e-icon-message-error'
        | 'e-icon-error'
        | 'e-icon-close'
    id: string
    when: Date
    resource: string
    location: string
    message: string | null
    isMessageEvent: boolean
}

// todo stream large number of events from indexeddb cursor with paged scrolling in either direction
export class DankDevTimeSeries extends HTMLElement {
    #api: DankDevTimeSeriesApi
    #events: Array<DankDevTimeSeriesEventDetails> = []
    #eventsContainer: HTMLElement
    #pagingObserver: IntersectionObserver

    constructor(api: DankDevTimeSeriesApi) {
        super()
        this.#api = api
        this.#pagingObserver = new IntersectionObserver(this.#onPaging, {
            threshold: 0.99,
        })
        this.append((this.#eventsContainer = document.createElement('div')))
    }

    async connectedCallback() {
        const mostRecentTimeID = this.#events.at(0)?.timeID ?? null
        const events = await (mostRecentTimeID
            ? this.#api.readEvents(
                  IDBKeyRange.lowerBound(mostRecentTimeID, true),
                  NO_LIMIT,
              )
            : this.#api.readEvents(null, PAGE_SIZE))
        if (events.length) {
            const prepending = eventElementsOf(events)
            this.#events.unshift(...prepending)
            this.#eventsContainer.prepend(...prepending)
            this.#pagingObserver.observe(prepending.at(-1)!)
        }
    }

    #onPaging = async (
        entries: IntersectionObserverEntry[],
        observer: IntersectionObserver,
    ) => {
        if (entries[0].intersectionRatio === 0) {
            return
        }
        observer.unobserve(entries[0].target)
        const events = await this.#api.readEvents(
            this.#events.length
                ? IDBKeyRange.upperBound(this.#events.at(-1)!.timeID, true)
                : null,
            PAGE_SIZE,
        )
        if (events.length) {
            const appending = eventElementsOf(events)
            this.#events.push(...appending)
            this.#eventsContainer.append(...appending)
        }
        if (events.length === PAGE_SIZE) {
            observer.observe(this.#events.at(-1 * PAGE_TRIGGER)!)
        }
    }
}

function eventElementsOf(
    events: Array<DankDevTimeSeriesEvent>,
): Array<DankDevTimeSeriesEventDetails> {
    return events.map(event => new DankDevTimeSeriesEventDetails(event))
}

export class DankDevTimeSeriesEventDetails extends HTMLElement {
    #event: DankDevTimeSeriesEvent

    constructor(event: DankDevTimeSeriesEvent) {
        super()
        this.#event = event
        this.dataset['id'] = event.id
        const summaryHTML = `\
<div class="e-kind mask-icon ${this.#event.eventIcon}"></div>
<div class="e-when">${this.#event.when.toLocaleTimeString()}</div>
<div class="e-location">${this.#event.location}</div>
<div class="e-resource">${this.#event.resource}</div>
`
        if (event.isMessageEvent) {
            if (event.message !== null) {
                this.classList.add('has-message')
            }
            this.innerHTML = `\
<details open>
<summary class="e-summary">${summaryHTML}</summary>
<div class="e-detail-content">
<div class="mask-icon e-copy"></div>
<div class="e-message">${this.#event.message ?? 'null'}</div>
</div>
</details>
`
            this.querySelector('.e-copy')!.addEventListener('click', () =>
                copy(this.#event.message!),
            )
        } else {
            this.innerHTML = `<div class="e-summary">${summaryHTML}</div>`
        }
    }

    get timeID(): string {
        return this.#event.id
    }
}

customElements.define('dank-dev-ui-timeseries', DankDevTimeSeries)
customElements.define(
    'dank-dev-ui-timeseries-event',
    DankDevTimeSeriesEventDetails,
)
