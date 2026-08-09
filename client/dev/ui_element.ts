import type { DankDevEvent } from './messaging.ts'
import { DankDevActivator } from './ui_activator.ts'
import { removeChildElements } from './ui_dom.ts'
import './ui_menu.ts'
import {
    type DankDevMenu,
    type MenuPane,
    PaneSelectionEvent,
} from './ui_menu.ts'
import { DankDevChannels } from './ui_p_channels.ts'
import { DankDevPages } from './ui_p_dev_pages.ts'
import { DankDevOpfs } from './ui_p_opfs.ts'
import { DankDevWorkers } from './ui_p_workers.ts'

// todo write state to DANK dev api so it is cached in ~/.config/DANK
function writeOpenPaneToLocalStorage(pane: MenuPane) {
    localStorage.setItem('__DANK__dev_ui_menu', pane)
}

// todo read from ~/.config/DANK and write into client.js on index.html
function readOpenPaneFromLocalStorage(): MenuPane | null {
    const pane = localStorage.getItem('__DANK__dev_ui_menu')
    switch (pane) {
        case 'channels':
        case 'opfs':
        case 'workers':
            return pane
        default:
            return null
    }
}

type MenuPaneElements = {
    channels: DankDevChannels
    opfs: DankDevOpfs
    workers: DankDevWorkers
    pages: DankDevPages
}

export type OpenMenuPanes = {
    [K in MenuPane]?: MenuPaneElements[K]
}

export class DankDevUI extends HTMLElement {
    #activator: DankDevActivator
    #container: HTMLDivElement
    #menu: DankDevMenu
    #open: boolean = false
    #panes: OpenMenuPanes = {}
    #shadow: ShadowRoot

    constructor(css: CSSStyleSheet) {
        super()
        this.#shadow = this.attachShadow({ mode: 'open' })
        this.#shadow.adoptedStyleSheets = [css]
        this.#shadow.innerHTML = `\
<div id="grid">
    <div id="placement">
        <dank-dev-ui-activator></dank-dev-ui-activator>
        <div id="ui">
            <dank-dev-ui-menu></dank-dev-ui-menu>
            <div id="pane"></div>
        </div>
    </div>
</div>
`
        this.#activator = this.#shadow.querySelector(
            'dank-dev-ui-activator',
        ) as DankDevActivator
        this.#activator.register(this)
        this.#container = this.#shadow.getElementById('pane') as HTMLDivElement
        this.#menu = this.#shadow.querySelector(
            'dank-dev-ui-menu',
        ) as DankDevMenu
        this.#menu.addEventListener('pane-selection', ((
            e: PaneSelectionEvent,
        ) => this.#changePane(e.detail.pane)) as (e: Event) => void)
    }

    isActive(): boolean {
        return this.#open
    }

    activate() {
        this.#open = true
        if (!this.#container.hasChildNodes()) {
            this.#menu.select(readOpenPaneFromLocalStorage() ?? 'workers')
        }
        this.#shadow.getElementById('ui')!.classList.add('open')
        this.style.position = 'fixed'
        this.style.top = this.style.left = '0'
    }

    deactivate() {
        this.#open = false
        this.#shadow.getElementById('ui')!.classList.remove('open')
    }

    postEvent(e: DankDevEvent) {
        switch (e.kind) {
            case 'channel-event':
                this.#menu.notify('channels')
                break
            case 'worker-event':
                this.#menu.notify('workers')
                break
            case 'shared-worker':
                if (this.#panes.workers) {
                    this.#panes.workers.sharedWorkerUsed()
                } else {
                    DankDevWorkers.sharedWorkerUsed()
                }
                break
            default:
                throw TypeError()
        }
    }

    #changePane(pane: MenuPane) {
        if (this.#open) {
            writeOpenPaneToLocalStorage(pane)
            removeChildElements(this.#container)
            this.#container.appendChild(this.#changeToPane(pane))
        }
    }

    #changeToPane(pane: MenuPane) {
        if (this.#panes[pane]) {
            return this.#panes[pane]
        }
        switch (pane) {
            case 'channels':
                return (this.#panes[pane] = new DankDevChannels())
            case 'opfs':
                return (this.#panes[pane] = new DankDevOpfs())
            case 'workers':
                return (this.#panes[pane] = new DankDevWorkers())
            case 'pages':
                return (this.#panes[pane] = new DankDevPages())
            default:
                throw TypeError()
        }
    }
}

customElements.define('dank-dev-ui', DankDevUI)
