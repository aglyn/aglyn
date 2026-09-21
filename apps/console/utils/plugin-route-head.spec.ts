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
 * A plugin's page becomes tags (AGL-3080).
 *
 * The plugin answers a title, a description and an image; turning those into
 * `openGraph` and `twitter` is the shell's, once, for every plugin route.
 * Both halves of that fail quietly: defining `openGraph` at all REPLACES the
 * root layout's wholesale, so an omitted `siteName` is a card that loses the
 * brand; and a large Twitter card with no image renders a blank slab.
 *
 * The rules were `listing-social-card.ts`'s until this existed, and moved
 * here unchanged — which is the point, since every route that follows gets
 * them without deciding anything.
 */

import { pluginRouteMetadataOver } from './plugin-route-head'

const FALLBACK = { title: 'Marketplace listing' }
const IMAGE = {
  url: 'https://cdn.example/preview.png',
  alt: 'Preview image for Northwind',
}

/** Next types `twitter` as a union discriminated on `card`. */
const twitterCard = (meta: ReturnType<typeof pluginRouteMetadataOver>) =>
  (meta.twitter as { card?: string } | undefined)?.card

describe('the head a plugin route emits', () => {
  it('leaves the shell’s own metadata untouched when nothing describes the page', () => {
    // Not merely "no title": NO `openGraph`/`twitter` key at all, so the root
    // layout's console card is inherited rather than replaced by a partial.
    expect(pluginRouteMetadataOver(FALLBACK, null)).toEqual(FALLBACK)
    expect(pluginRouteMetadataOver(FALLBACK, {})).toEqual(FALLBACK)
    expect(pluginRouteMetadataOver(FALLBACK, { title: '   ' })).toEqual(FALLBACK)
  })

  it('titles all three heads with what the plugin said', () => {
    const meta = pluginRouteMetadataOver(FALLBACK, { title: 'Northwind' })

    expect(meta.title).toBe('Northwind')
    expect(meta.openGraph?.title).toBe('Northwind')
    expect((meta.twitter as { title?: string }).title).toBe('Northwind')
  })

  it('restates siteName, which defining openGraph would otherwise drop', () => {
    // Next replaces the parent's `openGraph` wholesale rather than merging.
    const meta = pluginRouteMetadataOver(FALLBACK, { title: 'Northwind' })

    expect(meta.openGraph?.siteName).toBe('Aglyn')
    // Next's `OpenGraph` is a union discriminated on `type`, so the property
    // is not readable off the union itself; the mapper writes a literal.
    expect((meta.openGraph as { type?: string }).type).toBe('website')
  })

  it('carries the image to both halves as the DESCRIPTOR', () => {
    // A bare URL string emits no `image:alt` on the Twitter half (AGL-2417).
    const meta = pluginRouteMetadataOver(FALLBACK, {
      title: 'Northwind',
      image: IMAGE,
    })

    expect(meta.openGraph?.images).toEqual([IMAGE])
    expect((meta.twitter as { images?: unknown }).images).toEqual([IMAGE])
  })

  it('upgrades to the large twitter card only with an image', () => {
    expect(
      twitterCard(pluginRouteMetadataOver(FALLBACK, { title: 'N', image: IMAGE })),
    ).toBe('summary_large_image')
    expect(twitterCard(pluginRouteMetadataOver(FALLBACK, { title: 'N' }))).toBe(
      'summary',
    )
  })

  it('omits a key rather than emitting an empty tag', () => {
    // `strictNullChecks` is off repo-wide: a present key holding `undefined`
    // emits `content=""`, so the KEY has to be absent.
    const meta = pluginRouteMetadataOver(FALLBACK, { title: 'Northwind' })

    expect(Object.keys(meta)).not.toContain('description')
    expect(Object.keys(meta.openGraph ?? {})).not.toContain('description')
    expect(Object.keys(meta.openGraph ?? {})).not.toContain('images')
    expect(Object.keys(meta.twitter ?? {})).not.toContain('images')
  })

  it('keeps the rest of the shell’s metadata beside the head it replaces', () => {
    const meta = pluginRouteMetadataOver(
      { ...FALLBACK, robots: { index: false } },
      { title: 'Northwind', description: 'Three tiers.' },
    )

    expect(meta.robots).toEqual({ index: false })
    expect(meta.description).toBe('Three tiers.')
  })
})
