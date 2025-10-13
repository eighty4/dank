import { addCssUpdateIndicator } from '../../client/esbuild.ts'

document.addEventListener(
    'DOMContentLoaded',
    () => {
        initStickyHeaderListener()
        initGettingStartedCommands()
        initCssFeaturesEditor()
    },
    { once: true },
)

function initStickyHeaderListener() {
    new IntersectionObserver(onStickyHeaderToggle, {
        rootMargin: '-1px 0px 0px 0px',
        threshold: [1],
    }).observe(document.querySelector('#getting-started')!)
}

function onStickyHeaderToggle([e]: Array<IntersectionObserverEntry>) {
    console.log('asdf', e.intersectionRatio)
}

function initCssFeaturesEditor() {
    const style: HTMLStyleElement = document.querySelector(
        '#features-css style',
    )!
    const editor: HTMLTextAreaElement = document.querySelector(
        '#features-css #css-editor',
    )!
    let timeout: number | null = null

    editor.addEventListener('input', () => {
        if (timeout) {
            clearTimeout(timeout)
        }
        timeout = window.setTimeout(updatePreviewCss, 400)
    })

    function applyEditorCssToPreview() {
        style.innerText = `#features-css .preview .content { ${editor.value} }`
    }

    function updatePreviewCss() {
        applyEditorCssToPreview()
        addCssUpdateIndicator()
    }

    applyEditorCssToPreview()
}

function initGettingStartedCommands() {
    const commandElems: Record<string, HTMLElement> = {}
    const packageManagerElems: Array<HTMLElement> = []
    let visibleCommandElem: HTMLElement | null = null
    for (const command of document.querySelectorAll<HTMLElement>('.command')) {
        const pm = command.dataset.pm!
        commandElems[pm] = command
        if (command.classList.contains('show')) {
            visibleCommandElem = command
        }
    }
    for (const packageManager of document.querySelectorAll<HTMLElement>(
        '.pm',
    )) {
        packageManagerElems.push(packageManager)
        packageManager.addEventListener('click', () => {
            const pm = packageManager.dataset.pm!
            visibleCommandElem!.classList.remove('show')
            visibleCommandElem = commandElems[pm]
            visibleCommandElem.classList.add('show')
            for (const packageManager of packageManagerElems) {
                packageManager.classList[
                    packageManager.dataset.pm === pm ? 'add' : 'remove'
                ]('show')
            }
        })
    }

    let copiedElem: HTMLElement | null = null

    function onCopiedAnimationEnd(_e: AnimationEvent) {
        copiedElem?.remove()
        copiedElem = null
    }

    const commandsElem = document.querySelector<HTMLElement>('.commands')!
    commandsElem.addEventListener('click', () => {
        navigator.clipboard
            .writeText(visibleCommandElem!.innerText)
            .then(() => {
                if (copiedElem !== null) {
                    copiedElem.removeEventListener(
                        'animationend',
                        onCopiedAnimationEnd,
                    )
                    copiedElem.remove()
                }
                copiedElem = document.createElement('div')
                copiedElem.classList.add('copied')
                copiedElem.textContent = 'copied!'
                copiedElem.addEventListener(
                    'animationend',
                    onCopiedAnimationEnd,
                    { once: true },
                )
                commandsElem.appendChild(copiedElem)
            })
            .catch(console.error)
    })
}
