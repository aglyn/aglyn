import { render } from '@testing-library/react'

import ElementComponent from './element-component'

describe('ElementComponent', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<ElementComponent />)
    expect(baseElement).toBeTruthy()
  })
})
