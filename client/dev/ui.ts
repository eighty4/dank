import { createChannel, type DankDevEvent } from './messaging.ts'
import { DankDevUI } from './ui_element.ts'
import css from './ui.css'

let ui: DankDevUI | null = null
const channel = createChannel()
const outOfOrderEvents: Array<DankDevEvent> = []
channel.onmessage = ({ data }: MessageEvent<DankDevEvent>) => {
    if (ui) {
        ui.postEvent(data)
    } else {
        outOfOrderEvents.push(data)
    }
}

const styleSheet = new CSSStyleSheet()
await styleSheet.replace(css)

ui = new DankDevUI(styleSheet)

if (outOfOrderEvents.length) {
    for (const event of outOfOrderEvents) {
        ui.postEvent(event)
    }
    outOfOrderEvents.length = 0
}

document.body.insertAdjacentElement('afterbegin', ui)
