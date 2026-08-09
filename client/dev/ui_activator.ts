import { isActiveElementChildOf } from './ui_dom.ts'
import type { DankDevUI } from './ui_element.ts'

function isActivator(e: KeyboardEvent): boolean {
    return e.key === 'd'
}

function isDeactivator(e: KeyboardEvent): boolean {
    return e.key === 'Escape'
}

function doesActiveElementPreventActivator(): boolean {
    if (document.activeElement) {
        switch (document.activeElement.tagName) {
            case 'DATALIST':
            case 'INPUT':
            case 'SELECT':
            case 'TEXTAREA':
                return true
        }
        return (
            document.activeElement instanceof HTMLElement &&
            document.activeElement.isContentEditable
        )
    }
    return false
}

function doesActiveElementPermitDeactivator(ui: HTMLElement): boolean {
    return (
        document.activeElement === null ||
        document.body === document.activeElement ||
        isActiveElementChildOf(ui)
    )
}

enum KeyEventEffect {
    Activate,
    Deactivate,
}

export class DankDevActivator extends HTMLElement {
    static TIMEOUT = 250

    #count = 0
    #eggs: Array<HTMLElement>
    #reset: ReturnType<typeof setTimeout> | undefined = undefined
    #ui: DankDevUI | null = null

    constructor() {
        super()
        this.style.setProperty('--egg-timeout', `${DankDevActivator.TIMEOUT}ms`)
        this.innerHTML = `\
<div class="egg"></div>
<div class="egg"></div>
`
        this.#eggs = Array.from(this.querySelectorAll<HTMLElement>('.egg'))
    }

    register(ui: DankDevUI) {
        this.#ui = ui
        window.addEventListener('keyup', this.#onKeyUp)
    }

    #eggSync() {
        for (let i = 0; i < this.#eggs.length; i++) {
            if (this.#count > i) {
                this.#eggs[i].classList.add('show')
            } else {
                this.#eggs[i].classList.remove('show')
            }
        }
    }

    #onActivate() {
        this.#count = 0
        this.#eggSync()
        this.#ui!.activate()
    }

    #onActivator() {
        clearTimeout(this.#reset)
        if (this.#count === 2) {
            this.#onActivate()
        } else {
            this.#count++
            this.#eggSync()
            this.#reset = setTimeout(() => {
                this.#count = 0
                this.#eggSync()
            }, DankDevActivator.TIMEOUT)
        }
    }

    #onDeactivator() {
        this.#ui!.deactivate()
    }

    #onKeyUp = (e: KeyboardEvent) => {
        switch (this.#resolveKeyEventEffect(e)) {
            case KeyEventEffect.Activate:
                this.#onActivator()
                break
            case KeyEventEffect.Deactivate:
                this.#onDeactivator()
                break
        }
    }

    #resolveKeyEventEffect(e: KeyboardEvent): KeyEventEffect | null {
        if (this.#ui!.isActive()) {
            if (
                isDeactivator(e) &&
                doesActiveElementPermitDeactivator(this.#ui!)
            ) {
                return KeyEventEffect.Deactivate
            }
        } else if (isActivator(e) && !doesActiveElementPreventActivator()) {
            return KeyEventEffect.Activate
        }
        return null
    }
}

customElements.define('dank-dev-ui-activator', DankDevActivator)
