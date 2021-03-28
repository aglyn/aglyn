import React from 'react'
import { render } from '@testing-library/react'

import GridList from './grid-list'

describe('GridList', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<GridList />)
    expect(baseElement).toBeTruthy()
  })
})
