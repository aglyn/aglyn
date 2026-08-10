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

import {
  consoleOrigin,
  LISTING_DESCRIPTION_MAX,
  LISTING_TITLE_FALLBACK,
  listingCardDescription,
  listingSocialCard,
} from './listing-social-card'

const ORIGIN = 'https://app.aglyn.com'

/** A published component listing with both artwork fields set. */
const LISTING = {
  displayName: 'Northwind Pricing Table',
  description: 'A responsive pricing table with three tiers and a toggle.',
  previewImageUrl: 'https://cdn.example/preview.png',
  logoUrl: 'https://cdn.example/logo.png',
  artifactType: 'component',
}

const card = (listing: unknown) =>
  listingSocialCard(listing as never, { origin: ORIGIN })

/**
 * Next types `twitter` as a union discriminated on `card`, so the property is
 * not readable off the union itself. The narrowing is a test-side concern
 * only — the builder writes a literal.
 */
const twitterCard = (meta: ReturnType<typeof listingSocialCard>) =>
  (meta.twitter as { card?: string } | undefined)?.card

describe('marketplace listing social card (AGL-876)', () => {
  describe('what a published listing emits', () => {
    it('titles the card with the listing, not the route', () => {
      const meta = card(LISTING)

      // Non-vacuous: the input carries no title field at all, and the output
      // must differ from the shell the route shipped before this existed.
      expect(meta.title).toBe('Northwind Pricing Table')
      expect(meta.title).not.toBe(LISTING_TITLE_FALLBACK)
      expect(meta.openGraph?.title).toBe('Northwind Pricing Table')
    })

    it('describes the listing', () => {
      const meta = card(LISTING)

      expect(meta.description).toBe(LISTING.description)
      expect(meta.openGraph?.description).toBe(LISTING.description)
    })

    it('prefers the publisher’s preview art over their logo', () => {
      const meta = card(LISTING)

      expect(meta.openGraph?.images).toEqual([
        { url: 'https://cdn.example/preview.png' },
      ])
    })

    it('falls back to the logo when there is no preview', () => {
      const meta = card({ ...LISTING, previewImageUrl: undefined })

      expect(meta.openGraph?.images).toEqual([
        { url: 'https://cdn.example/logo.png' },
      ])
    })

    it('treats a CLEARED preview as "use the logo", not "no image"', () => {
      // `''` is how a cleared field is persisted; a `??` chain would keep it.
      const meta = card({ ...LISTING, previewImageUrl: '' })

      expect(meta.openGraph?.images).toEqual([
        { url: 'https://cdn.example/logo.png' },
      ])
    })

    it('absolutises a site-relative image against the console origin', () => {
      const meta = card({
        ...LISTING,
        previewImageUrl: '/api/media/cdn/org:org-9/preview.png',
      })

      expect(meta.openGraph?.images).toEqual([
        { url: 'https://app.aglyn.com/api/media/cdn/org:org-9/preview.png' },
      ])
    })

    it('upgrades to the large twitter card only with an image', () => {
      expect(twitterCard(card(LISTING))).toBe('summary_large_image')
      expect(
        twitterCard(card({ ...LISTING, previewImageUrl: '', logoUrl: '' })),
      ).toBe('summary')
    })

    it('restates siteName, which defining openGraph would otherwise drop', () => {
      // Next replaces the parent's `openGraph` wholesale rather than merging.
      expect(card(LISTING).openGraph?.siteName).toBe('Aglyn')
    })
  })

  describe('what must not be emitted', () => {
    // The shell is exactly what the route shipped before AGL-876: the generic
    // title, and NO `openGraph`/`twitter` key at all, so the root layout's
    // console card is inherited untouched.
    const expectShell = (meta: ReturnType<typeof listingSocialCard>) => {
      expect(meta).toEqual({ title: LISTING_TITLE_FALLBACK })
    }

    it('says nothing about a listing that does not exist', () => {
      expectShell(card(undefined))
      expectShell(card(null))
    })

    it('says nothing about a soft-deleted listing', () => {
      expectShell(card({ ...LISTING, deletedAt: new Date() }))
    })

    it('says nothing about a staff-hidden listing, whatever its type', () => {
      for (const artifactType of ['component', 'plugin', 'template', 'theme']) {
        expectShell(card({ ...LISTING, artifactType, hiddenAt: new Date() }))
      }
    })

    it('says nothing about a private listing', () => {
      expectShell(card({ ...LISTING, visibility: 'private' }))
    })

    it('says nothing about a plugin still in or out of review', () => {
      for (const reviewStatus of ['submitted', 'in_review', 'rejected']) {
        expectShell(card({ ...LISTING, artifactType: 'plugin', reviewStatus }))
      }
    })

    it('describes a plugin once review has passed', () => {
      for (const reviewStatus of ['listed', 'verified']) {
        expect(
          card({ ...LISTING, artifactType: 'plugin', reviewStatus }).title,
        ).toBe('Northwind Pricing Table')
      }
    })

    it('gives an anonymous fetcher no owner exemption', () => {
      // Browse lets a publisher watch their OWN submission move through
      // review. There is no viewer here, so there is nobody to exempt — a
      // submitted plugin is a shell no matter who fetches the URL.
      expectShell(
        card({ ...LISTING, artifactType: 'plugin', reviewStatus: 'submitted' }),
      )
    })

    it('falls back rather than titling a card with an empty name', () => {
      expectShell(card({ ...LISTING, displayName: '   ' }))
      expectShell(card({ ...LISTING, displayName: undefined }))
    })

    it('omits the image tag entirely when neither field resolves', () => {
      const meta = card({
        ...LISTING,
        previewImageUrl: undefined,
        logoUrl: undefined,
      })

      expect(meta.openGraph?.images).toBeUndefined()
      expect(meta.twitter?.images).toBeUndefined()
      // `strictNullChecks` is off repo-wide: assert the KEY is absent, not
      // that it holds undefined, since a present key emits `content=""`.
      expect(Object.keys(meta.openGraph ?? {})).not.toContain('images')
    })

    it('omits the description tag entirely when there is none', () => {
      const meta = card({ ...LISTING, description: '   ' })

      expect(Object.keys(meta)).not.toContain('description')
      expect(Object.keys(meta.openGraph ?? {})).not.toContain('description')
    })

    it('omits the image for a reference the resolver cannot parse', () => {
      const meta = card({
        ...LISTING,
        previewImageUrl: 'media:junk',
        logoUrl: undefined,
      })

      expect(meta.openGraph?.images).toBeUndefined()
      expect(twitterCard(meta)).toBe('summary')
    })
  })

  describe('description budget', () => {
    it('passes a short description through untouched', () => {
      expect(listingCardDescription('Three tiers.')).toBe('Three tiers.')
    })

    it('collapses the whitespace a textarea lets through', () => {
      expect(listingCardDescription('  a\n\n b\t c ')).toBe('a b c')
    })

    it('cuts an unbounded description at a word boundary', () => {
      const long = 'word '.repeat(200).trim()
      const cut = listingCardDescription(long)

      expect(cut.length).toBeLessThanOrEqual(LISTING_DESCRIPTION_MAX + 1)
      expect(cut.endsWith('…')).toBe(true)
      expect(cut).not.toContain('wor…')
      expect(cut.length).toBeLessThan(long.length)
    })

    it('cuts mid-word rather than returning almost nothing', () => {
      // One 400-character "word": there is no boundary to fall back to, and
      // an empty description would be worse than a cut one.
      const cut = listingCardDescription('x'.repeat(400))

      expect(cut).toBe(`${'x'.repeat(LISTING_DESCRIPTION_MAX)}…`)
    })

    it('reports nothing for a field that is not a live string', () => {
      expect(listingCardDescription(undefined)).toBe('')
      expect(listingCardDescription(null)).toBe('')
      expect(listingCardDescription(42)).toBe('')
    })
  })

  describe('the origin the image is absolutised against', () => {
    const saved = process.env.NEXT_PUBLIC_CONSOLE_URL

    afterEach(() => {
      if (saved === undefined) delete process.env.NEXT_PUBLIC_CONSOLE_URL
      else process.env.NEXT_PUBLIC_CONSOLE_URL = saved
    })

    it('tracks a self-hosted console', () => {
      process.env.NEXT_PUBLIC_CONSOLE_URL = 'https://console.example.com'

      expect(consoleOrigin()).toBe('https://console.example.com')
    })

    it('trims a trailing slash rather than emitting a doubled path', () => {
      process.env.NEXT_PUBLIC_CONSOLE_URL = 'https://console.example.com/'

      expect(consoleOrigin()).toBe('https://console.example.com')
      expect(
        listingSocialCard({
          ...LISTING,
          previewImageUrl: '/api/media/cdn/org:org-9/preview.png',
        }).openGraph?.images,
      ).toEqual([
        {
          url: 'https://console.example.com/api/media/cdn/org:org-9/preview.png',
        },
      ])
    })

    it('defaults to the hosted console apex', () => {
      delete process.env.NEXT_PUBLIC_CONSOLE_URL

      expect(consoleOrigin()).toBe('https://app.aglyn.com')
    })
  })
})
