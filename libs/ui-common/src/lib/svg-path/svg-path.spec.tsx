import React from 'react'
import { render } from '@testing-library/react'

import SvgPath from './svg-path'

describe('SvgPath', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<SvgPath />)
    expect(baseElement).toBeTruthy()
  })
})
