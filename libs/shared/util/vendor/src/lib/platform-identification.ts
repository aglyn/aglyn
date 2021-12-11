export type Platform = ReturnType<typeof platformIdentification>

export function platformIdentification() {
  return require('platform')
}
