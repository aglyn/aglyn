import React from 'react'
import { render } from '@testing-library/react'

import SvgPathIcon from './svg-path-icon'

describe('SvgPathIcon', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<SvgPathIcon />)
    expect(baseElement).toBeTruthy()
  })
})
