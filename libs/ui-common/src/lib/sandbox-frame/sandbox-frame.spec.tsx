import React from 'react'
import { render } from '@testing-library/react'

import SandboxFrame from './sandbox-frame'

describe('SandboxFrame', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<SandboxFrame />)
    expect(baseElement).toBeTruthy()
  })
})
