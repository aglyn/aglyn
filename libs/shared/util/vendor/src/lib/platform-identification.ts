// eslint-disable-next-line @typescript-eslint/no-require-imports
const platform = require('platform') as Record<string, unknown>

export type Platform = typeof platform

export function platformIdentification() {
  return platform
}
