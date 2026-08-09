import { removeChildElements } from './ui_dom.ts'

export class DankDevPane extends HTMLElement {
    #content: HTMLElement
    #footer: HTMLElement
    constructor(content: HTMLElement, footer?: HTMLElement | null) {
        super()
        this.append((this.#content = document.createElement('main')))
        this.#content.append(content)
        this.#footer = document.createElement('footer')
        if (footer) {
            this.#setFooter(footer)
        }
    }

    set footer(footer: HTMLElement | undefined | null) {
        removeChildElements(this.#footer)
        if (footer) {
            this.#setFooter(footer)
        } else if (this.#footer.isConnected) {
            this.#footer.remove()
        }
    }

    #setFooter(footer: HTMLElement) {
        if (!this.#footer.isConnected) {
            this.#footer.append(footer)
        }
        this.append(this.#footer)
    }
}

customElements.define('dank-dev-ui-pane', DankDevPane)
