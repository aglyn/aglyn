import React from 'react'
import { render } from '@testing-library/react'

import NavbarDrawer from './navbar-drawer'

describe('NavbarDrawer', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<NavbarDrawer />)
    expect(baseElement).toBeTruthy()
  })
})
