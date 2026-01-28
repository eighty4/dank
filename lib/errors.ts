export class DankError extends Error {
    constructor(message: string, cause?: Error) {
        super(message, { cause })
        this.name = 'DankError'
    }
}
