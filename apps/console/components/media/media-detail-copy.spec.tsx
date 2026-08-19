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
 * The three things `/product/media`'s asset-detail mockup shows that the DAM
 * did not have (AGL-2143).
 *
 * The library component is not rendered here, for the reason
 * `media-asset-card-selection.spec.tsx` gives about the grid: it mounts a
 * Firestore listener stack and a dnd-kit surface, so a test of it is a test
 * of the mocks. The two string decisions moved into `media-detail-copy.ts`
 * and are asserted directly; the third — the Download action — is asserted on
 * the real card, which is a plain component.
 */

import { fireEvent, render, screen } from '@testing-library/react'

import { MediaAssetCard } from './media-asset-card.component'
import {
  addMediaTag,
  describeMediaDelivery,
  removeMediaTag,
} from './media-detail-copy'

describe('the delivery footer (AGL-2143)', () => {
  it('names the widths THIS asset actually has', () => {
    const delivery = describeMediaDelivery({
      cdnPath: '/api/media/cdn/org:o1/m1',
      variants: [320, 640, 1280],
    })
    expect(delivery.onCdn).toBe(true)
    expect(delivery.label).toBe('CDN · variants 320 / 640 / 1280')
  })

  it('reports what the ASSET has, not what the generator aims for', () => {
    // The distinction the whole helper turns on. `MEDIA_CDN_VARIANT_WIDTHS`
    // is [320, 640, 1280]; an asset whose generation was interrupted has
    // fewer, and claiming three would name widths a `?w=1280` request would
    // not be served from.
    const delivery = describeMediaDelivery({
      cdnPath: '/api/media/cdn/org:o1/m1',
      variants: [320, 640],
    })
    expect(delivery.label).toBe('CDN · variants 320 / 640')
    expect(delivery.label).not.toContain('1280')
  })

  it('says so when an asset has no variants at all', () => {
    // `media-variants.ts` is explicit that an empty array means EITHER
    // "nothing was eligible" (an SVG, a PDF) or "generation failed" — the two
    // are indistinguishable from outside, so the honest word covers both.
    const delivery = describeMediaDelivery({
      cdnPath: '/api/media/cdn/org:o1/m1',
      variants: [],
    })
    expect(delivery.onCdn).toBe(true)
    expect(delivery.label).toBe('CDN · no responsive variants for this file')
  })

  it('distinguishes a storage-served asset from a CDN one with no variants', () => {
    // Both have zero widths; they are not the same fact, and the status dot
    // reads differently for each.
    const storage = describeMediaDelivery({ variants: [] })
    expect(storage.onCdn).toBe(false)
    expect(storage.label).toContain('no CDN')
    expect(storage.label).not.toBe(
      describeMediaDelivery({ cdnPath: '/x', variants: [] }).label,
    )
  })

  it('sorts and sanitises whatever the document happens to hold', () => {
    const delivery = describeMediaDelivery({
      cdnPath: '/x',
      variants: [1280, 320, 0, Number.NaN, 640] as number[],
    })
    expect(delivery.widths).toEqual([320, 640, 1280])
  })

  it('survives an absent variants field', () => {
    expect(describeMediaDelivery({ cdnPath: '/x' }).widths).toEqual([])
    expect(describeMediaDelivery(null).onCdn).toBe(false)
  })
})

describe('tag chips (AGL-2143)', () => {
  it('adds a tag and keeps the stored comma-joined shape', () => {
    expect(addMediaTag('brand, hero', 'homepage')).toBe('brand, hero, homepage')
  })

  it('drops a trailing space rather than storing a tag no filter can match', () => {
    // The actual cost of reading tags back out of free text: `hero ` stored
    // as its own entry, invisible to every filter chip in the toolbar.
    expect(addMediaTag('brand', '  hero  ')).toBe('brand, hero')
  })

  it('reports NOTHING CHANGED for a duplicate rather than growing the list', () => {
    // Null, not the unchanged string: the caller clears the field either way,
    // and a re-added chip should look like nothing happened, because it is.
    expect(addMediaTag('brand, hero', 'hero')).toBeNull()
    // Case is normalised too, so `Hero` is the same tag.
    expect(addMediaTag('brand, hero', 'HERO')).toBeNull()
  })

  it('reports nothing changed for whitespace or an empty draft', () => {
    expect(addMediaTag('brand', '   ')).toBeNull()
    expect(addMediaTag('brand', '')).toBeNull()
  })

  it('removes exactly one tag', () => {
    expect(removeMediaTag('brand, hero, homepage', 'hero')).toBe(
      'brand, homepage',
    )
    // Removing the last one leaves an empty string, not the literal 'null'.
    expect(removeMediaTag('brand', 'brand')).toBe('')
  })

  it('normalises on the way in, so a chip IS what gets stored', () => {
    // The property that makes chips honest: whatever the drawer shows, the
    // save path's own normaliser would produce the identical list.
    const stored = addMediaTag('Brand', 'Hero')
    expect(stored).toBe('brand, hero')
  })
})

const MEDIA = {
  $id: 'm1',
  fileName: 'hero-bg.jpg',
  contentType: 'image/jpeg',
  sizeBytes: 1024,
  url: 'https://example.test/hero-bg.jpg',
} as any

describe('the Download action (AGL-2143)', () => {
  function openMenu() {
    // The overflow trigger is the only other button on the card besides the
    // tile itself.
    fireEvent.click(screen.getByRole('button', { name: /more|actions|⋮/i }))
  }

  it('offers Download for a public asset', () => {
    const onDownload = jest.fn()
    render(
      <MediaAssetCard
        media={MEDIA}
        formatBytes={(bytes: number) => `${bytes} B`}
        onCopyUrl={jest.fn()}
        onDownload={onDownload}
      />,
    )
    openMenu()
    fireEvent.click(screen.getByText('Download file'))
    expect(onDownload).toHaveBeenCalledTimes(1)
  })

  it('offers Download for a PRIVATE asset, where Copy URL cannot help', () => {
    // The case the mockup's DOWNLOAD exists for. A private asset has no
    // permanent URL, so the card correctly hides `Copy URL` — which left the
    // DAM with no way to get the bytes back at all.
    const onDownload = jest.fn()
    render(
      <MediaAssetCard
        media={{ ...MEDIA, private: true }}
        formatBytes={(bytes: number) => `${bytes} B`}
        onCopyUrl={jest.fn()}
        onDownload={onDownload}
      />,
    )
    openMenu()
    expect(screen.queryByText('Copy URL')).toBeNull()
    fireEvent.click(screen.getByText('Download file'))
    expect(onDownload).toHaveBeenCalledTimes(1)
  })

  it('omits the item entirely when the caller passes no handler', () => {
    // Picker mode. Without this the menu would render a dead row — the shape
    // AGL-2131 spent a commit removing elsewhere.
    render(
      <MediaAssetCard
        media={MEDIA}
        formatBytes={(bytes: number) => `${bytes} B`}
        onCopyUrl={jest.fn()}
      />,
    )
    openMenu()
    expect(screen.queryByText('Download file')).toBeNull()
  })
})
