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
 * How a screen's `seo` map is rebuilt from a partial edit (AGL-1437, and
 * `imageAlt` since AGL-2417).
 *
 * The function is pure and shared by BOTH SEO panels — the besigner's Screen
 * Properties and the screen detail page — which is the point: they drifted
 * once, and the rules are the kind that fail silently. An invented key makes
 * a screen look as though somebody authored a social card; a dropped key
 * deletes `breadcrumb` on a save that never opened it; and a mismatched
 * group describes a card that does not exist.
 *
 * `imageAlt` is the newest member of that group and is asserted the same way,
 * because the failure it can produce is the worst of the set: a confident
 * SENTENCE about a picture the card does not show, delivered to the reader
 * least able to check it.
 */

import { buildScreenSeoUpdate } from '../constants/screen-seo'

describe('buildScreenSeoUpdate', () => {
  it('carries untouched keys forward', () => {
    // `updateDoc` REPLACES a nested map, so a panel that edits one field and
    // writes a fresh map silently deletes everything stored beside it.
    expect(
      buildScreenSeoUpdate(
        { breadcrumb: 'Careers', title: 'Jobs' },
        { description: 'Open roles' },
      ),
    ).toEqual({
      breadcrumb: 'Careers',
      title: 'Jobs',
      description: 'Open roles',
    })
  })

  it('invents no image keys for a screen that has none', () => {
    // `/careers` holds exactly `{ description, title }`; a save through a
    // panel that defaulted the image group to ''/0/0 would make it five keys
    // — six now — and the screen would read as having an authored card.
    expect(
      buildScreenSeoUpdate({ title: 'Jobs' }, { description: 'Open roles' }),
    ).toEqual({ title: 'Jobs', description: 'Open roles' })
  })

  describe('the image group moves together', () => {
    it('writes the reference, its size and its description as one', () => {
      expect(
        buildScreenSeoUpdate(
          {},
          {
            image: {
              image: 'media:host-1/img',
              imageWidth: 1200,
              imageHeight: 630,
              imageAlt: 'The Q3 report cover',
            },
          },
        ),
      ).toEqual({
        image: 'media:host-1/img',
        imageWidth: 1200,
        imageHeight: 630,
        imageAlt: 'The Q3 report cover',
      })
    })

    it('REMOVES the description with the image when the image is cleared', () => {
      // An alt left behind by a clear is a description of a card that no
      // longer exists — and the head would emit it beside the SITE DEFAULT's
      // image, which is precisely the mismatch AGL-2417 is about.
      expect(
        buildScreenSeoUpdate(
          {
            title: 'Jobs',
            image: 'media:host-1/img',
            imageWidth: 1200,
            imageHeight: 630,
            imageAlt: 'The Q3 report cover',
          },
          {
            image: {
              image: '',
              imageWidth: 0,
              imageHeight: 0,
              imageAlt: '',
            },
          },
        ),
      ).toEqual({ title: 'Jobs' })
    })

    it('removes a blanked description but keeps the image', () => {
      // Emptied means REMOVED, not stored blank: `og:image:alt=""` asserts
      // the image conveys nothing, which is not what "undescribed" means.
      expect(
        buildScreenSeoUpdate(
          {
            image: 'media:host-1/img',
            imageWidth: 1200,
            imageHeight: 630,
            imageAlt: 'Old description',
          },
          {
            image: {
              image: 'media:host-1/img',
              imageWidth: 1200,
              imageHeight: 630,
              imageAlt: '   ',
            },
          },
        ),
      ).toEqual({
        image: 'media:host-1/img',
        imageWidth: 1200,
        imageHeight: 630,
      })
    })

    it('replaces a previous description rather than keeping the stale one', () => {
      expect(
        buildScreenSeoUpdate(
          {
            image: 'media:host-1/old',
            imageWidth: 800,
            imageHeight: 400,
            imageAlt: 'The Acme logo',
          },
          {
            image: {
              image: 'media:host-1/new',
              imageWidth: 1200,
              imageHeight: 630,
              imageAlt: 'The Q3 report cover',
            },
          },
        ),
      ).toEqual({
        image: 'media:host-1/new',
        imageWidth: 1200,
        imageHeight: 630,
        imageAlt: 'The Q3 report cover',
      })
    })

    it('leaves a stored description alone when the author touched nothing', () => {
      // `null` means untouched, which is NOT the same as cleared — the
      // distinction that keeps a title save from wiping a description.
      expect(
        buildScreenSeoUpdate(
          { image: 'media:host-1/img', imageAlt: 'The Acme logo' },
          { title: 'Jobs' },
        ),
      ).toEqual({
        image: 'media:host-1/img',
        imageAlt: 'The Acme logo',
        title: 'Jobs',
      })
    })
  })

  it('returns null when nothing is left, so the caller can delete the map', () => {
    expect(
      buildScreenSeoUpdate(
        { image: 'media:host-1/img', imageWidth: 1200, imageHeight: 630, imageAlt: 'x' },
        { image: { image: '', imageWidth: 0, imageHeight: 0, imageAlt: '' } },
      ),
    ).toBeNull()
  })
})
