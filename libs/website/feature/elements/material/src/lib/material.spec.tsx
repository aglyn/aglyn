import { render } from '@testing-library/react'

import Material from './material'


describe('Material', () => {
  it('should render successfully', () => {
    const {baseElement} = render(<Material />)
    expect(baseElement).toBeTruthy()
  })
})
