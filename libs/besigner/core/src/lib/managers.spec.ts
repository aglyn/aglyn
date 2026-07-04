import { dnd } from './managers'

describe('aglynBesigner', () => {
  it('exposes a dnd manager singleton', () => {
    expect(dnd).toBeTruthy()
  })
})
