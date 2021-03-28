import React from 'react'
import { render } from '@testing-library/react'

import ElevationScroll from './elevation-scroll'

describe('ElevationScroll', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<ElevationScroll><div/></ElevationScroll>)
    expect(baseElement).toBeTruthy()
  })
})
