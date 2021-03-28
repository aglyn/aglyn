import React from 'react'
import { render } from '@testing-library/react'

import ShadowDom from './shadow-dom'

describe('ShadowDom', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<ShadowDom />)
    expect(baseElement).toBeTruthy()
  })
})
