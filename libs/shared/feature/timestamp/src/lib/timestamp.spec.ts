import { Timestamp } from './timestamp'

describe('Timestamp', () => {
  it('should work', () => {
    expect(Timestamp.now()).toBeInstanceOf(Timestamp)
  })
})
