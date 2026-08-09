export function removeChildElements(element: HTMLElement): void {
    while (element.firstElementChild) {
        element.removeChild(element.firstElementChild)
    }
}

export function isActiveElementChildOf(parent: Element): boolean {
    return !!document.activeElement && isChildOf(parent, document.activeElement)
}

export function isChildOf(parent: Element, child: Element): boolean {
    let traverse: Element | null = child
    while (traverse) {
        if (traverse === parent) {
            return true
        }
        traverse = traverse.parentElement
    }
    return false
}
