import React from 'react'
import { render } from '@testing-library/react'

import MuiShadowDom from './mui-shadow-dom'

describe('MuiShadowDom', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<MuiShadowDom />)
    expect(baseElement).toBeTruthy()
  })
})
