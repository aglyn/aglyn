import React from 'react'
import { render } from '@testing-library/react'

import GridButtons from './grid-buttons'

describe('GridButtons', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<GridButtons />)
    expect(baseElement).toBeTruthy()
  })
})
