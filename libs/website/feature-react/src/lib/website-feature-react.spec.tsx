import { render } from '@testing-library/react'

import WebsiteFeatureReact from './website-feature-react'

describe('WebsiteFeatureReact', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<WebsiteFeatureReact />)
    expect(baseElement).toBeTruthy()
  })
})
