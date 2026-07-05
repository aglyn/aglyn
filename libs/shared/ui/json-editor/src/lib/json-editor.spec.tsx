import { render } from '@testing-library/react'

import JsonEditor from './json-editor'

describe('JsonEditor', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<JsonEditor />)
    expect(baseElement).toBeTruthy()
  })
})
