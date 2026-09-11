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
 * A placed image follows its DAM asset, not the pick that placed it (AGL-2833).
 *
 * The composition reads each placed asset's media document and lays its facts
 * over the node. These pin the image half of that overlay: the pixel pair the
 * `<img>` reserves its box from, what the author set for the placement, a
 * placement nobody could answer for, and the order a capped read honors. The
 * film half is pinned through its own exports in `video-asset-facts.spec.ts`.
 */

import {
  applyMediaAssetFacts,
  type MediaAssetFacts,
  mediaAssetFactsKey,
  mediaAssetRefs,
} from './media-asset-facts'

const ROOT = '_@_'
const PHOTO = 'media:site1/photo'

/** What a pick of the photo as first uploaded copied: a 1200x630 card. */
const PICKED: Record<string, unknown> = {
  src: PHOTO,
  alt: 'The pipeline board',
  intrinsicWidth: 1200,
  intrinsicHeight: 630,
}

/** The replacement's document, as `/api/media/replace` measured it: a square. */
const REPLACED: MediaAssetFacts = { width: 480, height: 480 }

const page = (props: Record<string, unknown>, componentId = 'image') => ({
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['p1'] },
  p1: { $id: 'p1', componentId, parentId: ROOT, props },
})

/** The facts map a reader would return for the photo this page places. */
const answered = (facts: MediaAssetFacts) =>
  new Map([[mediaAssetFactsKey({ scope: 'site1', mediaId: 'photo' }), facts]])

/** The props the page renders its image with, after the overlay. */
const shipped = (
  props: Record<string, unknown>,
  facts: ReadonlyMap<string, MediaAssetFacts>,
): Record<string, unknown> =>
  (applyMediaAssetFacts(page(props), facts).p1 as { props: Record<string, unknown> })
    .props

describe('a placed image follows its asset (AGL-2833)', () => {
  it("reserves the replacement's shape, not the one it was picked with", () => {
    expect(shipped(PICKED, answered(REPLACED))).toMatchObject({
      intrinsicWidth: 480,
      intrinsicHeight: 480,
    })
  })

  it('sizes a placement the pick never sized', () => {
    // An image placed before picks copied a pair, or through a component prop,
    // reserves nothing until the asset answers for it.
    const unsized = { src: PHOTO, alt: 'The pipeline board' }
    expect(shipped(unsized, answered(REPLACED))).toMatchObject({
      intrinsicWidth: 480,
      intrinsicHeight: 480,
    })
  })

  it('keeps the size, fit and radius the author set for the placement', () => {
    const authored = {
      ...PICKED,
      width: '320px',
      height: '240px',
      objectFit: 'contain',
      radius: 16,
    }
    expect(shipped(authored, answered(REPLACED))).toEqual({
      ...authored,
      intrinsicWidth: 480,
      intrinsicHeight: 480,
    })
  })

  it('keeps a pair standing beside an asset that measures none', () => {
    // An SVG, or a file older than dimension capture: nothing in the document
    // could have been copied, so the stored pair is the only reservation the
    // page has, and it stays.
    for (const unmeasured of [{}, { width: 480 }, { width: 0, height: 0 }]) {
      const nodes = page(PICKED)
      const applied = applyMediaAssetFacts(nodes, answered(unmeasured))
      expect(applied).toBe(nodes)
      expect(applied.p1.props).toEqual(PICKED)
    }
  })

  it('keeps every stored value for an image the read could not answer for', () => {
    const nodes = page(PICKED)
    const applied = applyMediaAssetFacts(nodes, new Map())
    expect(applied).toBe(nodes)
    expect(applied.p1.props).toEqual(PICKED)
  })

  it('returns the same map when the stored pair already matches', () => {
    const nodes = page({ ...PICKED, intrinsicWidth: 480, intrinsicHeight: 480 })
    expect(applyMediaAssetFacts(nodes, answered(REPLACED))).toBe(nodes)
  })

  it('follows a pinned reference to the same asset', () => {
    const pinned = { ...PICKED, src: `${PHOTO}@abc123def4567890` }
    expect(shipped(pinned, answered(REPLACED))).toMatchObject({
      intrinsicWidth: 480,
      intrinsicHeight: 480,
    })
  })

  it('sizes the resolved copy a repeated image renders from', () => {
    const nodes = {
      [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['row'] },
      row: {
        $id: 'row',
        componentId: 'image',
        parentId: ROOT,
        props: { src: '{{entry.cover}}' },
        resolvedProps: { ...PICKED },
      },
    }
    const applied = applyMediaAssetFacts(nodes, answered(REPLACED)).row as {
      resolvedProps: Record<string, unknown>
    }
    expect(applied.resolvedProps).toMatchObject({
      src: PHOTO,
      intrinsicWidth: 480,
      intrinsicHeight: 480,
    })
  })

  it('lays a film and an image from one answer map', () => {
    const nodes = {
      [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['p1', 'v1'] },
      p1: { $id: 'p1', componentId: 'image', parentId: ROOT, props: PICKED },
      v1: {
        $id: 'v1',
        componentId: 'video',
        parentId: ROOT,
        props: {
          src: 'media:site1/film',
          durationSeconds: 2,
          intrinsicWidth: 640,
          intrinsicHeight: 360,
        },
      },
    }
    const facts = new Map<string, MediaAssetFacts>([
      ['site1/photo', REPLACED],
      ['site1/film', { video: { durationMs: 3000, width: 480, height: 480 } }],
    ])
    const applied = applyMediaAssetFacts(nodes, facts)
    expect(applied.p1.props).toMatchObject({ intrinsicWidth: 480, intrinsicHeight: 480 })
    expect(applied.v1.props).toMatchObject({
      durationSeconds: 3,
      intrinsicWidth: 480,
      intrinsicHeight: 480,
    })
  })

  it('leaves every other element alone', () => {
    const avatar = page({ ...PICKED }, 'avatar')
    expect(applyMediaAssetFacts(avatar, answered(REPLACED))).toBe(avatar)
  })

  it('never mutates the map it was handed', () => {
    const nodes = page(PICKED)
    const before = JSON.parse(JSON.stringify(nodes))
    applyMediaAssetFacts(nodes, answered(REPLACED))
    expect(nodes).toEqual(before)
  })
})

describe('mediaAssetRefs', () => {
  /**
   * A page whose map lists its nodes in a different order than the document
   * does: the footer first, the film last. The document reads logo, hero,
   * film, footer.
   */
  const PAGE = {
    footer: { $id: 'footer', componentId: 'image', props: { src: 'media:site1/mark' } },
    [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['header', 'hero', 'tour', 'footer'] },
    hero: { $id: 'hero', componentId: 'image', props: { src: 'media:org:acme/hero' } },
    header: { $id: 'header', componentId: 'div', nodes: ['logo'] },
    logo: { $id: 'logo', componentId: 'image', props: { src: 'media:site1/logo' } },
    tour: { $id: 'tour', componentId: 'video', props: { src: 'media:site1/film' } },
  }

  it('lists films first, then images, each from the top of the page down', () => {
    expect(mediaAssetRefs(PAGE)).toEqual([
      { scope: 'site1', mediaId: 'film' },
      { scope: 'site1', mediaId: 'logo' },
      { scope: 'org:acme', mediaId: 'hero' },
      { scope: 'site1', mediaId: 'mark' },
    ])
  })

  it('lists one element when asked for one', () => {
    expect(mediaAssetRefs(PAGE, { only: 'image' })).toHaveLength(3)
    expect(mediaAssetRefs(PAGE, { only: 'video' })).toEqual([
      { scope: 'site1', mediaId: 'film' },
    ])
  })

  it('lists each library asset once, and nothing that is not one', () => {
    const nodes = {
      a: { componentId: 'image', props: { src: PHOTO } },
      b: { componentId: 'image', props: { src: `${PHOTO}@abc123def4567890` } },
      c: { componentId: 'image', props: { src: 'https://images.example.com/x.png' } },
      d: { componentId: 'image', props: { src: '{{var:hero}}' } },
      e: { componentId: 'image', props: {} },
      f: { componentId: 'avatar', props: { src: 'media:site1/face' } },
      g: { componentId: 'image', props: { src: 'media:org:acme/other' } },
    }
    expect(mediaAssetRefs(nodes)).toEqual([
      { scope: 'site1', mediaId: 'photo' },
      { scope: 'org:acme', mediaId: 'other' },
    ])
  })

  it('keeps the map order for nodes no walk from the root reaches', () => {
    const orphans = {
      z: { componentId: 'image', props: { src: 'media:site1/z' } },
      y: { componentId: 'image', props: { src: 'media:site1/y' } },
    }
    expect(mediaAssetRefs(orphans).map((ref) => ref.mediaId)).toEqual(['z', 'y'])
  })

  it('survives a map whose child ids loop', () => {
    const looped = {
      [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['a'] },
      a: { $id: 'a', componentId: 'div', nodes: ['b', ROOT] },
      b: { $id: 'b', componentId: 'image', nodes: ['a'], props: { src: PHOTO } },
    }
    expect(mediaAssetRefs(looped)).toEqual([{ scope: 'site1', mediaId: 'photo' }])
  })

  it('is empty for a page with no library asset, and for no page at all', () => {
    expect(mediaAssetRefs({ a: { componentId: 'text', props: {} } })).toEqual([])
    expect(mediaAssetRefs(null)).toEqual([])
  })
})
