import React from 'react'
import { render } from '@testing-library/react'

import RulerGuides from './ruler-guides'

describe('RulerGuides', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<RulerGuides />)
    expect(baseElement).toBeTruthy()
  })
})
