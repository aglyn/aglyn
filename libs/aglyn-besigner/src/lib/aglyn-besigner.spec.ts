import { dnd } from './aglyn-besigner'

describe('aglynBesigner', () => {
  it('exposes a dnd manager singleton', () => {
    expect(dnd).toBeTruthy()
  })
})
