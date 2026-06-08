import { render } from '@testing-library/react'

import AglynPluginMui from './aglyn-plugin-mui'

describe('AglynPluginMui', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<AglynPluginMui />)
    expect(baseElement).toBeTruthy()
  })
})
