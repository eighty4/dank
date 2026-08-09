import type { DankDevPage } from '../../lib/dev_api.ts'
import { dankDevApi } from './api.ts'
import { removeChildElements } from './ui_dom.ts'
import { DankDevMenuButton } from './ui_menu.ts'

export class DankDevPages extends HTMLElement {
    connectedCallback() {
        dankDevApi({ kind: 'dev-pages' }).then(({ pages }) => {
            if (this.isConnected) {
                this.append(...pages.map(page => new DankDevPageListing(page)))
            }
        })
    }

    disconnectedCallback() {
        removeChildElements(this)
    }
}

class DankDevPageListing extends HTMLElement {
    #header: HTMLElement
    #icon: HTMLElement
    #label: HTMLElement
    #frame: DankDevPageFrame
    constructor(page: DankDevPage) {
        super()
        this.append(
            (this.#header = document.createElement('div')),
            (this.#frame = new DankDevPageFrame(page)),
        )
        this.#header.classList.add('header')
        this.#header.append(
            (this.#icon = document.createElement('span')),
            (this.#label = document.createElement('span')),
        )
        this.#icon.classList.add('mask-icon')
        this.#label.textContent = page.label
        this.#label.classList.add('label')
    }

    connectedCallback() {
        this.#icon.addEventListener('click', this.#openPage)
        this.#label.addEventListener('click', this.#openPage)
    }

    disconnectedCallback() {
        this.#icon.removeEventListener('click', this.#openPage)
        this.#label.removeEventListener('click', this.#openPage)
    }

    #openPage = () => {
        this.#frame.dispatchEvent(new CustomEvent('open'))
    }
}

class DankDevPageFrame extends HTMLElement {
    #menu: DankDevPageFrameMenu | null = null
    #frame: HTMLIFrameElement
    #page: DankDevPage
    constructor(page: DankDevPage) {
        super()
        this.append((this.#frame = document.createElement('iframe')))
        this.#frame.src = page.url
        this.#page = page
    }

    connectedCallback() {
        this.addEventListener('click', this.#onClick)
        this.addEventListener('close', this.#onClose)
        this.addEventListener('open', this.#onOpen)
    }

    disconnectedCallback() {
        this.removeEventListener('click', this.#onClick)
        this.removeEventListener('close', this.#onClose)
        this.removeEventListener('open', this.#onOpen)
    }

    #onClick = () => {
        this.dispatchEvent(new CustomEvent('open'))
    }

    #onOpen = () => {
        if (!this.classList.contains('open')) {
            this.prepend((this.#menu = new DankDevPageFrameMenu(this.#page)))
            this.classList.add('open')
        }
    }

    #onClose() {
        if (this.classList.contains('open')) {
            this.#menu?.remove()
            this.#menu = null
            this.classList.remove('open')
        }
    }
}

class DankDevPageFrameMenu extends HTMLElement {
    #close: HTMLElement

    constructor(page: DankDevPage) {
        super()
        this.classList.add('menu')
        this.append(
            new DankDevMenuButton('webpage', page.label, true),
            (this.#close = document.createElement('span')),
        )
        this.#close.classList.add('icon-button', 'mask-icon', 'close')
    }

    connectedCallback() {
        this.addEventListener('click', this.#onClick)
        this.#close.addEventListener('click', this.#onClose)
    }

    disconnectedCallback() {
        this.removeEventListener('click', this.#onClick)
        this.#close.removeEventListener('click', this.#onClose)
    }

    #onClick(e: Event) {
        e.stopPropagation()
    }

    #onClose(e: Event) {
        e.stopPropagation()
        this.dispatchEvent(new CustomEvent('close', { bubbles: true }))
    }
}

customElements.define('dank-dev-ui-pages', DankDevPages)
customElements.define('dank-dev-ui-page-deets', DankDevPageListing)
customElements.define('dank-dev-ui-page-frame', DankDevPageFrame)
customElements.define('dank-dev-ui-page-frame-menu', DankDevPageFrameMenu)
