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

import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * The DAM grid uses the thumbnail source (AGL-1440 follow-up).
 *
 * Lived beside the helper in `apps/console/utils/media-src.spec.ts` until
 * AGL-3080 moved the helper into core, where a plugin can reach it. The
 * helper's own behaviour went with it; this half could not, because it reads
 * a CONSOLE component off disk and a lib spec that reaches into an app is the
 * dependency the package boundaries exist to refuse.
 *
 * Asserted at the DECLARATION rather than through a render: the bug is which
 * FIELD the tile reads, and a render test passes just as happily with a
 * full-size original in the `src` as with a variant.
 */
const source = readFileSync(
  join(
    __dirname,
    '..',
    'components',
    'media',
    'media-asset-card.component.tsx',
  ),
  'utf8',
)

describe('the DAM grid uses the thumbnail source (AGL-1440 follow-up)', () => {
  it('never puts the raw `media.url` in an image tile', () => {
    expect(source).not.toContain('image={media.url}')
  })

  it('routes the image tile through mediaThumbnailSrc', () => {
    expect(source).toContain('mediaThumbnailSrc(media')
  })

  it('routes VIDEO through the CDN URL — Range support unlocked it', () => {
    // This pin used to hold the OPPOSITE: video stayed on `media.url`
    // because `serveMediaCdn` ignored `Range` and a <video> seek would have
    // re-downloaded a file that may be 200 MB. AGL-1442 S4 gave the route
    // single byte-range 206s (`serve-media-cdn.range.spec.ts` holds that
    // contract), so the raw storage URL lost its only advantage — and with
    // it went the CSP and the caching the raw URL never had. No `?w=`:
    // variants are WebP stills of images, a video has none.
    expect(source).not.toContain('src={media.url}')
    expect(source).toContain('src={mediaSrc(media)}')
  })
})
