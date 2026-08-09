export class DankDevPages extends HTMLElement {
    constructor() {
        super()
        this.innerHTML = `<div>dev pages</div>`
    }

    connectedCallback() {}

    disconnectedCallback() {}
}

customElements.define('dank-dev-ui-pages', DankDevPages)
