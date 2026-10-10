export const cn = (...values: Array<string | undefined | false>) => values.filter(Boolean).join(' ')
