import { type Config } from 'prettier'

const config: Config = {
    arrowParens: 'avoid',
    semi: false,
    singleQuote: true,
    tabWidth: 4,
    trailingComma: 'all',
    overrides: [
        {
            files: '*.{html,yaml,yml}',
            options: {
                tabWidth: 2,
            },
        },
    ],
}

export default config
