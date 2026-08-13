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
import MediaAssetCard from '../components/media/media-asset-card.component'

/**
 * AGL-1463. A ZIP in the org DAM rendered as an EMPTY card while the PDF
 * beside it showed an icon: the tile special-cased video and PDF and handed
 * every other type to `<img src={thumbnail}>`, which for a zip is a broken
 * image with nothing in it.
 *
 * The assertions are therefore in two halves, and the second half is the one
 * that matters. Asserting only "zip shows a zip icon" would be satisfied by a
 * bigger `if` chain that still falls through for the next type nobody listed
 * — which is exactly the bug, one type further along. So the generic-fallback
 * cases are asserted as hard as the per-type ones.
 */

const formatBytes = (bytes: number) => `${bytes} B`

const renderCard = (media: Record<string, unknown>) =>
  render(
    <MediaAssetCard
      media={{ $id: 'm1', fileName: 'asset', ...media } as any}
      formatBytes={formatBytes}
    />,
  )

/**
 * MUI's `createSvgIcon` stamps `data-testid="<Name>Icon"` outside prod.
 *
 * Scoped to the thumbnail: the card also renders a `MoreVertIcon` for its
 * overflow menu, and an unscoped `svg` query would find that one on a blank
 * card and call the bug fixed.
 */
const thumb = (container: HTMLElement) =>
  container.querySelector('.MuiCardMedia-root')

const iconName = (container: HTMLElement) =>
  thumb(container)
    ?.querySelector('svg[data-testid]')
    ?.getAttribute('data-testid') ?? null

describe('MediaAssetCard file-type icons (AGL-1463)', () => {
  it.each([
    ['application/pdf', 'PictureAsPdfIcon', 'PDF'],
    ['application/zip', 'FolderZipIcon', 'ZIP'],
    // Windows browsers report this alias; documents written before
    // `normalizeUploadContentType` folded it still carry it.
    ['application/x-zip-compressed', 'FolderZipIcon', 'ZIP'],
    [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'DescriptionIcon',
      'DOCX',
    ],
    ['application/msword', 'DescriptionIcon', 'DOC'],
    [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'TableChartIcon',
      'XLSX',
    ],
    ['application/vnd.ms-excel', 'TableChartIcon', 'XLS'],
    ['text/csv', 'TableChartIcon', 'CSV'],
    [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'SlideshowIcon',
      'PPTX',
    ],
    ['text/plain', 'DescriptionIcon', 'TXT'],
    ['application/json', 'DataObjectIcon', 'JSON'],
    ['audio/mpeg', 'AudiotrackIcon', 'MPEG'],
  ])('renders %s as %s', (contentType, expectedIcon, expectedLabel) => {
    const { container, getByText } = renderCard({ contentType })
    expect(iconName(container)).toBe(expectedIcon)
    // No `<img>` behind it — a broken image IS the blank card.
    expect(container.querySelector('img')).toBeNull()
    expect(getByText(new RegExp(`^${expectedLabel} ·`))).toBeTruthy()
  })

  it.each([
    // The next type nobody thought of. This is the assertion that keeps the
    // fix fixed: an unmapped type must degrade to the generic document icon,
    // never to nothing.
    ['application/x-not-a-real-type'],
    ['application/octet-stream'],
    ['application/vnd.some-vendor.thing'],
    // No content type at all.
    [''],
  ])('falls back to the generic document icon for %p', (contentType) => {
    const { container } = renderCard({ contentType })
    expect(iconName(container)).toBe('InsertDriveFileIcon')
    expect(container.querySelector('img')).toBeNull()
  })

  it('never renders a card with neither a thumbnail nor an icon', () => {
    // The invariant behind every case above, stated once: whatever the type,
    // the tile draws SOMETHING.
    for (const contentType of [
      'image/png',
      'video/mp4',
      'application/pdf',
      'application/zip',
      'text/csv',
      'application/x-unknown',
      '',
      undefined,
    ]) {
      const { container } = renderCard({ contentType, url: 'https://x/a' })
      const tile = thumb(container)
      const drawn =
        tile?.tagName === 'IMG' ||
        tile?.tagName === 'VIDEO' ||
        Boolean(tile?.querySelector('svg[data-testid]'))
      expect({ contentType, drawn }).toEqual({ contentType, drawn: true })
    }
  })

  it('POSITIVE CONTROL: an image still renders its thumbnail, not an icon', () => {
    // A fix that routed every card through the icon map would satisfy the
    // fallback assertions and take the whole grid's imagery away.
    const { container } = renderCard({
      contentType: 'image/png',
      $id: 'abc',
      url: 'https://x/a.png',
    })
    expect(container.querySelector('img')).toBeTruthy()
  })

  it('POSITIVE CONTROL: a video still renders its <video> preview', () => {
    const { container } = renderCard({
      contentType: 'video/mp4',
      url: 'https://x/a.mp4',
    })
    expect(container.querySelector('video')).toBeTruthy()
  })
})
