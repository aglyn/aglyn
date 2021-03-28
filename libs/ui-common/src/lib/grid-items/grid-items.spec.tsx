import React from 'react'
import { render } from '@testing-library/react'

import GridItems from './grid-items'

describe('GridItems', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<GridItems />)
    expect(baseElement).toBeTruthy()
  })
})
