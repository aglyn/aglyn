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
import HostIcon from '../components/host-icon.component'

/**
 * AGL-1071. `HostIcon` is handed TWO different shapes and has to read both:
 *
 * - the sites list passes a real host doc  → nested `seo.favicon`
 * - the site switcher passes a projection row → flat `favicon`
 *
 * Supporting only the nested one is the original bug (switcher showed the
 * generic glyph for every site). Supporting only the flat one would break the
 * sites list instead — so both directions are asserted, because fixing this
 * by *moving* the read rather than widening it looks identical in review.
 */
const imgSrc = (container: HTMLElement) =>
  container.querySelector('img')?.getAttribute('src') ?? null

describe('HostIcon favicon shapes (AGL-1071)', () => {
  it('renders the favicon from a host doc (nested seo.favicon)', () => {
    const { container } = render(
      <HostIcon host={{ seo: { favicon: 'https://x/host.png' } }} />,
    )
    expect(imgSrc(container)).toBe('https://x/host.png')
  })

  it('renders the favicon from a projection row (flat favicon)', () => {
    const { container } = render(
      <HostIcon host={{ favicon: 'https://x/row.png' }} />,
    )
    expect(imgSrc(container)).toBe('https://x/row.png')
  })

  it('falls back to the glyph when neither shape has one', () => {
    const { container } = render(<HostIcon host={{ displayName: 'Site' }} />)
    expect(imgSrc(container)).toBeNull()
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('treats an empty string as no favicon, not as a broken image', () => {
    // The Remove button writes `seo.favicon: ''` rather than deleting it, so
    // a truthiness check is required — `??` would render <img src="">.
    const { container } = render(<HostIcon host={{ seo: { favicon: '' } }} />)
    expect(imgSrc(container)).toBeNull()
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('handles a missing host without throwing', () => {
    const { container } = render(<HostIcon />)
    expect(container.querySelector('svg')).toBeTruthy()
  })
})
