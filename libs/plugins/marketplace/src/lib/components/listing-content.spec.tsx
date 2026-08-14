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

import { render } from '@testing-library/react'
import { ListingReadme } from './listing-content.component'

/**
 * Renderer parity for the markdown-lite block set (AGL-1315): every block
 * the parser can emit must render as an element here, or a publisher's
 * README leaks raw markdown text into the listing page.
 */
describe('ListingReadme (markdown-lite parity)', () => {
  it('renders a `> ` group as a blockquote, not literal text (AGL-1315)', () => {
    const { container } = render(
      <ListingReadme readme={'Intro.\n\n> A **quoted** note\n> continues.'} />,
    )
    const quote = container.querySelector('blockquote')
    expect(quote?.textContent).toBe('A quoted note continues.')
    expect(quote?.querySelector('strong')?.textContent).toBe('quoted')
    expect(container.textContent).not.toContain('>')
  })

  it('renders install steps as an <ol> with its start number (AGL-1320)', () => {
    const { container } = render(
      <ListingReadme readme={'Install:\n\n1. Run **npm i**\n2. Register it'} />,
    )
    const list = container.querySelector('ol')
    expect(list?.getAttribute('start')).toBe('1')
    expect(list?.querySelectorAll('li')).toHaveLength(2)
    expect(list?.querySelector('strong')?.textContent).toBe('npm i')
    // The markers belong to the <ol>, not to the README's prose.
    expect(container.textContent).toBe('Install:Run npm iRegister it')
  })
})

/**
 * AGL-1686. A README image is picked from the publisher's own media library,
 * and the listing image beside it (`ListingImage`) has resolved a reference
 * all along — the README was the half that dropped the block entirely.
 *
 * No `hostId`: a listing belongs to a publishing ORG rather than to a site, so
 * there is no rendering host to re-point the scope at.
 */
describe('ListingReadme images (AGL-1686)', () => {
  it('resolves a media reference to the CDN url', () => {
    const { container } = render(
      <ListingReadme readme={'![Screenshot](media:org:acme/med1)'} />,
    )
    const image = container.querySelector('img')
    expect(image?.getAttribute('src')).toBe('/api/media/cdn/org:acme/med1')
    expect(image?.getAttribute('alt')).toBe('Screenshot')
  })

  it('passes a plain URL through and renders nothing for a bad reference', () => {
    const { container } = render(
      <ListingReadme readme={'![a](https://x.example/a.png)'} />,
    )
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://x.example/a.png',
    )
    const bad = render(<ListingReadme readme={'![a](media:junk)'} />)
    expect(bad.container.querySelector('img')).toBeNull()
  })
})
