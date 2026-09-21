/**
 * @jest-environment jsdom
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock, so a license header above it silently leaves the
 * suite on this project's `node` default. It matters here: `mediaSrc`
 * branches on `typeof window`, and the browser half is the half that ships
 * an absolute URL into a document.
 *
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

import { mediaSrc, mediaThumbnailSrc } from './media-src'

describe('mediaThumbnailSrc — grid tiles must not fetch full-size originals', () => {
  // `mediaSrc` absolutizes against `window.location.origin` when there is a
  // window, so these assert the shape rather than an exact string — under
  // jsdom the origin is `http://localhost`, in production it is the console.
  it('asks the CDN for a variant, not the original', () => {
    const src = mediaThumbnailSrc(
      { cdnPath: '/api/media/cdn/h1/m1', url: 'https://raw/x' },
      320,
    )
    expect(src).toContain('/api/media/cdn/h1/m1?w=320')
    expect(src).not.toContain('raw')
  })

  it('falls back to the raw URL when there is no cdnPath', () => {
    // Free-tier and private assets carry no `cdnPath` (AGL-1051), and a
    // width parameter on a raw storage URL means nothing — appending one
    // would only fork the browser cache for identical bytes.
    expect(mediaThumbnailSrc({ url: 'https://raw/x' }, 320)).toBe('https://raw/x')
  })

  it('leaves a cdnPath that already carries a query alone', () => {
    // A signed private URL (`?exp=&sig=`) must not have `?w=` welded on: the
    // signature covers the path, and a second `?` produces a URL the route
    // parses as a bad media path.
    const signed = '/api/media/cdn/h1/m1?exp=1&sig=abc'
    const src = mediaThumbnailSrc({ cdnPath: signed }, 320)
    expect(src).toContain(signed)
    expect(src).not.toContain('w=320')
  })

  it('is empty for an asset with neither', () => {
    expect(mediaThumbnailSrc({}, 320)).toBe('')
  })

  it('does not disturb mediaSrc, which writes URLs into documents', () => {
    // `mediaSrc` output gets PERSISTED (markdown bodies, listing images), so
    // it must stay width-free — a thumbnail width baked into a stored URL
    // would serve a 320px image on a full-bleed hero forever.
    expect(mediaSrc({ cdnPath: '/api/media/cdn/h1/m1' })).not.toContain('w=')
  })
})
