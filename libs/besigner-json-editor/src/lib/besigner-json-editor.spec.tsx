import { render } from '@testing-library/react'

import BesignerJsonEditor from './besigner-json-editor'

describe('BesignerJsonEditor', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<BesignerJsonEditor />)
    expect(baseElement).toBeTruthy()
  })
})
