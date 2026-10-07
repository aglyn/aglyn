/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * The console's consent banner and advertising tags stay off a plugin's
 * public device page (AGL-3608): the person in front of a customer display is
 * the business's customer, on the business's tablet, not a visitor of ours.
 */

import { render, screen } from '@testing-library/react'

let mockPathname = '/signin'
jest.mock('next/navigation', () => ({ usePathname: () => mockPathname }))
jest.mock('../components/visitor-consent.component', () => ({
  __esModule: true,
  default: () => <p>consent banner</p>,
}))
jest.mock('../components/advertising-tags.component', () => ({
  __esModule: true,
  default: ({ nonce }: { nonce?: string }) => <p>{`ad tags ${nonce ?? ''}`}</p>,
}))

import VisitorMarketingSurface from '../components/visitor-marketing-surface.component'

describe('VisitorMarketingSurface', () => {
  it.each(['/signin', '/acme/hosts/site-1/commerce', '/'])('mounts both on %s', (path) => {
    mockPathname = path
    render(<VisitorMarketingSurface nonce="n1" />)
    expect(screen.getByText('consent banner')).toBeTruthy()
    expect(screen.getByText('ad tags n1')).toBeTruthy()
  })

  it('mounts neither on a public device page', () => {
    mockPathname = '/kiosk/commerce/pos-display'
    const { container } = render(<VisitorMarketingSurface nonce="n1" />)
    expect(container.textContent).toBe('')
  })
})
