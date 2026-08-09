import { removeChildElements } from './ui_dom.ts'

export class DankDevPane extends HTMLElement {
    #content: HTMLElement
    #footer: HTMLElement
    constructor(content: HTMLElement, footer?: HTMLElement | null) {
        super()
        this.append(
            (this.#content = document.createElement('main')),
            (this.#footer = document.createElement('footer')),
        )
        this.#content.append(content)
        if (footer) {
            this.#footer.append(footer)
        }
    }

    set footer(footer: HTMLElement | undefined | null) {
        removeChildElements(this.#footer)
        if (footer) {
            this.#footer.append(footer)
        }
    }
}

customElements.define('dank-dev-ui-pane', DankDevPane)
