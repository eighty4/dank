import type { MenuPane } from '../../lib/dev_api.ts'

export type { MenuPane } from '../../lib/dev_api.ts'

export type MenuPaneSelection = {
    pane: MenuPane
}

export class PaneSelectionEvent extends CustomEvent<MenuPaneSelection> {
    static TYPE = 'pane-selection'

    constructor(pane: MenuPane) {
        super(PaneSelectionEvent.TYPE, {
            detail: {
                pane,
            },
        })
    }
}

export class DankDevMenu extends HTMLElement {
    #buttons: Partial<Record<MenuPane, HTMLElement>> = {}
    #selected: HTMLElement | null = null

    constructor() {
        super()
        this.innerHTML = `\
<div id="menu" class="menu" role="tabpanel">
    <div class="button" data-pane="workers" role="tab" aria-selected="false">
        <div class="mask-icon p-workers"></div>
        <span class="label">workers</span>
    </div>
    <div class="button" data-pane="channels" role="tab" aria-selected="false">
        <div class="mask-icon p-channels"></div>
        <span class="label">channels</span>
    </div>
    <div class="button" data-pane="opfs" role="tab" aria-selected="false">
        <div class="mask-icon p-opfs"></div>
        <span class="label">opfs</span>
    </div>
    <div class="button" data-pane="pages" role="tab" aria-selected="false">
        <div class="mask-icon p-dev-pages"></div>
        <span class="label">dev pages</span>
    </div>
    <div class="flex-space"></div>
    <div class="icon-button mask-icon close"></div>
</div>
`
        for (const button of this.querySelectorAll<HTMLElement>(
            '.button[data-pane]',
        )) {
            const pane = button.dataset['pane'] as MenuPane
            this.#buttons[pane] = button
            button.addEventListener('click', () => this.#onSelected(pane))
        }
        this.querySelector('.icon-button.close')!.addEventListener(
            'click',
            this.#onClose,
        )
    }

    notify(pane: MenuPane) {
        if (this.#selected?.dataset['pane'] === pane) {
            return
        }
        const notifying = this.#buttons[pane]!
        if (notifying.classList.contains('notification')) {
            return
        }
        let delay: number = 0
        for (const button of Object.values(this.#buttons)) {
            if (
                button !== notifying &&
                button.classList.contains('notification')
            ) {
                delay = animationDelayOf(button) - animationTimeOf(button)
                break
            }
        }
        notifying.style.animationDelay = `${delay}ms`
        notifying.classList.add('notification')
    }

    select(pane: MenuPane) {
        this.#buttons[pane]!.click()
    }

    #onClose = () => {
        this.dispatchEvent(new CustomEvent('close-ui'))
    }

    #onSelected(pane: MenuPane) {
        if (this.#selected) {
            if (this.#selected.dataset['pane'] === pane) {
                return
            }
            this.#selected.classList.remove('selected')
            this.#selected.ariaSelected = 'false'
        }
        this.#selected = this.#buttons[pane]!
        this.#selected.classList.remove('notification')
        this.#selected.style.animationDelay = `0ms`
        this.#selected.classList.add('selected')
        this.#selected.ariaSelected = 'true'
        this.dispatchEvent(new PaneSelectionEvent(pane))
    }
}

function animationDelayOf(elem: HTMLElement): number {
    const { animationDelay } = elem.style
    if (
        !animationDelay ||
        animationDelay === '0ms' ||
        !animationDelay.endsWith('ms')
    ) {
        return 0
    }
    const parsed = parseInt(animationDelay.slice(0, -2), 10)
    return isNaN(parsed) ? 0 : parsed
}

function animationTimeOf(elem: HTMLElement): number {
    const animation = elem.getAnimations().at(0)
    if (animation?.currentTime && typeof animation.currentTime === 'number') {
        return animation.currentTime
    } else {
        return 0
    }
}

export class DankDevMenuButton extends HTMLElement {
    constructor(
        iconClass: string,
        labelText: string,
        selected: boolean = false,
    ) {
        super()
        this.classList.add('button')
        const icon = document.createElement('span')
        const label = document.createElement('span')
        icon.classList.add('mask-icon', iconClass)
        label.classList.add('label')
        label.textContent = labelText
        this.append(icon, label)
        if (selected) {
            this.classList.add('selected')
        }
    }
}

customElements.define('dank-dev-ui-menu', DankDevMenu)
customElements.define('dank-dev-ui-menu-button', DankDevMenuButton)
