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

/**
 * AGL-1407, reopened leg. `seo.favicon` held a raw `firebasestorage` URL on
 * two production hosts — one of them a CUSTOMER site publishing its own bucket
 * path — and the back-fill declined both, so the field has to become a
 * `media:` reference. This component and `favicon-card` are its only readers,
 * and they handed the stored string straight to an `<Avatar src>`: converting
 * the data first would have put `src="media:org:…/…"` in the site switcher and
 * the sites list, on every site at once.
 *
 * So the reference case is asserted alongside BOTH positive controls. The two
 * legacy generations are not incidental — a fix that resolved references by
 * *replacing* the pass-through rather than widening it would satisfy the first
 * assertion alone and take every unconverted site's favicon dark, and it would
 * look identical in review.
 */
describe('HostIcon resolves a media reference (AGL-1407)', () => {
  it('resolves a host-scoped reference to the CDN path', () => {
    const { container } = render(
      <HostIcon
        host={{ $id: 'hostA', seo: { favicon: 'media:hostA/cx4KadMszZ' } }}
      />,
    )
    expect(imgSrc(container)).toBe('/api/media/cdn/hostA/cx4KadMszZ')
  })

  it('qualifies an org-scoped reference with the row it was given', () => {
    // The projection row spells the favicon flat and carries `$id` — the host
    // doc id — which is what names the site asking. Without it an asset
    // restricted to particular sites resolves to a scope the CDN 404s.
    const { container } = render(
      <HostIcon host={{ $id: 'hostA', favicon: 'media:org:orgB/19G8Ipyfb1' }} />,
    )
    expect(imgSrc(container)).toBe(
      '/api/media/cdn/org:orgB:hostA/19G8Ipyfb1',
    )
  })

  it('POSITIVE CONTROL: a raw storage URL still renders unchanged', () => {
    const raw =
      'https://firebasestorage.googleapis.com/v0/b/aglyn-main.appspot.com/o/' +
      'orgs%2FjWmGooWE3L%2Fmedia%2F19G8Ipyfb1?alt=media&token=eae58a84'
    const { container } = render(
      <HostIcon host={{ $id: 'hostA', seo: { favicon: raw } }} />,
    )
    expect(imgSrc(container)).toBe(raw)
  })

  it('POSITIVE CONTROL: an external URL still renders unchanged', () => {
    // An author-typed icon, pasted into the SEO form's Favicon field. Supported
    // and none of the resolver's business.
    const { container } = render(
      <HostIcon host={{ $id: 'hostA', favicon: 'https://example.com/fav.ico' }} />,
    )
    expect(imgSrc(container)).toBe('https://example.com/fav.ico')
  })

  it('shows the glyph for a MALFORMED reference rather than src="media:…"', () => {
    // `resolveMediaSrc` returns undefined for a value that opens with the
    // prefix and does not parse. There is no correct URL to emit, and a
    // placeholder is a report where a broken image is a console error nobody
    // reads.
    const { container } = render(
      <HostIcon host={{ $id: 'hostA', seo: { favicon: 'media:junk' } }} />,
    )
    expect(imgSrc(container)).toBeNull()
    expect(container.querySelector('svg')).toBeTruthy()
  })
})
