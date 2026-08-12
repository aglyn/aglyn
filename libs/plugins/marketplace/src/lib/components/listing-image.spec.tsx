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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from '@testing-library/react'
import { ListingImage } from './listing-image.component'

/**
 * AGL-1424: `marketplaceListings.previewImageUrl` is buyer-facing art that
 * was handed to a `src` raw, so it could never hold a `media:` reference.
 *
 * The renderer half has to be provably correct BEFORE the data half runs —
 * AGL-1407's lesson — which means the three stored shapes are asserted
 * TOGETHER here. A reference-only test passes just as happily against a
 * renderer that has broken every existing raw URL, and every value in
 * production today is a raw URL.
 */
const RAW_STORAGE_URL =
  'https://firebasestorage.googleapis.com/v0/b/aglyn-main.appspot.com/o/' +
  'orgs%2Fhz_KgetqSq%2Fmedia%2FkoESooh9vV?alt=media&token=28d2760b-b414'

const srcOf = (element: HTMLElement | Element) =>
  element.querySelector('img')?.getAttribute('src')

describe('ListingImage (AGL-1424)', () => {
  it('resolves a `media:` reference to the CDN path', () => {
    const { container } = render(
      <ListingImage src="media:org:hz_KgetqSq/koESooh9vV" alt="preview" />,
    )
    expect(srcOf(container)).toBe(
      '/api/media/cdn/org:hz_KgetqSq/koESooh9vV',
    )
  })

  it('passes a raw firebasestorage URL through UNCHANGED', () => {
    // The positive control. This is what every live listing holds right now,
    // and the whole point of shipping the renderer first is that it keeps
    // working with no data change at all.
    const { container } = render(
      <ListingImage src={RAW_STORAGE_URL} alt="preview" />,
    )
    expect(srcOf(container)).toBe(RAW_STORAGE_URL)
  })

  it('passes a genuinely external https URL through UNCHANGED', () => {
    const hotlink = 'https://images.example.com/plugin-hero.png'
    const { container } = render(<ListingImage src={hotlink} alt="preview" />)
    expect(srcOf(container)).toBe(hotlink)
  })

  it('passes a legacy /api/media/cdn path through UNCHANGED', () => {
    // The pre-reference generation (AGL-175). It is already a CDN URL, so it
    // must not be re-resolved or prefixed.
    const legacy = '/api/media/cdn/org:hz_KgetqSq/koESooh9vV'
    const { container } = render(<ListingImage src={legacy} alt="preview" />)
    expect(srcOf(container)).toBe(legacy)
  })

  it('renders NOTHING for an absent, empty or malformed source', () => {
    for (const value of [undefined, null, '', 'media:junk', 'media:a/b c']) {
      const { container } = render(
        <ListingImage src={value as string} alt="preview" />,
      )
      // A malformed reference has no correct URL. Emitting `src="media:junk"`
      // would put a broken-image icon on a store page.
      expect(container.querySelector('img')).toBeNull()
      expect(container.innerHTML).toBe('')
    }
  })

  it('keeps the alt text the card and the detail page supply', () => {
    const { container } = render(
      <ListingImage src={RAW_STORAGE_URL} alt="Promo Countdown preview" />,
    )
    expect(container.querySelector('img')?.getAttribute('alt')).toBe(
      'Promo Countdown preview',
    )
  })
})

/**
 * A resolver nothing calls is the AGL-1407 failure shape: the back-fill
 * reported success and changed nothing, because the gate it ran behind was
 * never exercised. These two components are the ONLY render sites for
 * `previewImageUrl` inside this library, and both must go through the
 * resolver — a raw `src={listing.previewImageUrl}` would take every converted
 * listing image dark the moment the data step runs.
 */
describe('previewImageUrl has no raw render site left (AGL-1424)', () => {
  const sourceOf = (file: string) =>
    readFileSync(join(__dirname, file), 'utf8')

  it.each([
    'marketplace-browse.component.tsx',
    'listing-content.component.tsx',
  ])('%s renders previewImageUrl through ListingImage', (file) => {
    const source = sourceOf(file)
    expect(source).toContain('ListingImage')
    expect(source).toMatch(/src=\{listing\??\.?\??previewImageUrl\}/)
    // …and never straight into an element's own `src`.
    expect(source).not.toMatch(
      /component="img"[\s\S]{0,120}previewImageUrl/,
    )
  })
})
