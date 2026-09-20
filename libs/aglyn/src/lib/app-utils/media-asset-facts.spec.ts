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
  mediaAssetDocumentPath,
  mediaAssetFactsFromDocument,
  mediaAssetFactsKey,
  mediaAssetRefs,
} from './media-asset-facts'
import { hostScopeToken } from './scope-tokens'

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

/**
 * Every surface that reads a placed asset's document decides through these
 * two: the composition for the page, and the console for the canvas and
 * Preview (AGL-2838, AGL-2849, AGL-2856). A film's view of both is pinned in
 * `video-asset-facts.spec.ts`; these pin an image's.
 */
describe('where an asset is read from, and what the read answers', () => {
  it("reads an org asset from the org library and a site asset from the site's own", () => {
    expect(mediaAssetDocumentPath({ scope: 'org:acme', mediaId: 'photo' })).toBe(
      'orgs/acme/media/photo',
    )
    expect(
      mediaAssetDocumentPath({ scope: 'org:acme:site9', mediaId: 'photo' }),
    ).toBe('orgs/acme/media/photo')
    expect(mediaAssetDocumentPath({ scope: 'site1', mediaId: 'photo' })).toBe(
      'hosts/site1/media/photo',
    )
    expect(
      mediaAssetDocumentPath({ scope: 'not a scope', mediaId: 'photo' }),
    ).toBeNull()
  })

  it("answers with an image's pair, which the overlay then reserves", () => {
    const answer = mediaAssetFactsFromDocument(REPLACED, { scope: 'site1' }, 'site1')
    expect(answer).toEqual(REPLACED)
    expect(shipped(PICKED, answered(answer as MediaAssetFacts))).toMatchObject({
      intrinsicWidth: 480,
      intrinsicHeight: 480,
    })
  })

  it('carries the facts and none of the gates they were decided from', () => {
    const answer = mediaAssetFactsFromDocument(
      { ...REPLACED, visibleTo: ['org'], private: false, deletedAt: null },
      { scope: 'org:acme' },
      'site1',
    )
    expect(answer).toEqual(REPLACED)
    expect(answer).not.toHaveProperty('visibleTo')
    expect(answer).not.toHaveProperty('private')
    expect(answer).not.toHaveProperty('deletedAt')
  })

  it('answers nothing for an image that is gone, deleted or private', () => {
    expect(
      mediaAssetFactsFromDocument(undefined, { scope: 'site1' }, 'site1'),
    ).toBeUndefined()
    expect(
      mediaAssetFactsFromDocument({ ...REPLACED, deletedAt: 1 }, { scope: 'site1' }, 'site1'),
    ).toBeUndefined()
    expect(
      mediaAssetFactsFromDocument({ ...REPLACED, private: true }, { scope: 'site1' }, 'site1'),
    ).toBeUndefined()
  })

  it('refuses an org image with no scope, or shared with no site, as the CDN does', () => {
    expect(
      mediaAssetFactsFromDocument(REPLACED, { scope: 'org:acme' }, 'site1'),
    ).toBeUndefined()
    expect(
      mediaAssetFactsFromDocument({ ...REPLACED, visibleTo: [] }, { scope: 'org:acme' }, 'site1'),
    ).toBeUndefined()
  })

  it('asks visibility of the site rendering the image, not the scope it was stored with', () => {
    const restricted = { ...REPLACED, visibleTo: [hostScopeToken('site9')] }
    expect(
      mediaAssetFactsFromDocument(restricted, { scope: 'org:acme:site9' }, 'site1'),
    ).toBeUndefined()
    expect(
      mediaAssetFactsFromDocument(restricted, { scope: 'org:acme' }, 'site9'),
    ).toEqual(REPLACED)
  })
})

/**
 * An image inside authored PROSE (AGL-3149).
 *
 * A body image is not a node, so it cannot carry `intrinsicWidth` and
 * `intrinsicHeight` the way a placement does. Its pair travels on the element
 * holding the document instead, keyed by the target the body wrote, and the
 * renderer looks it up by the parsed block's `src`.
 *
 * The property the whole feature rests on is that an image the read cannot
 * answer for gets NO entry: `srcSet` without the pair makes `sizes` the
 * rendered width and upscales anything narrower than the column, so a partial
 * answer is a worse render than none.
 */
describe('a library image named by a markdown body (AGL-3149)', () => {
  const DIAGRAM = 'media:site1/diagram'
  const BODY = `Intro.\n\n![A pipeline](${DIAGRAM})\n\nMore.`
  const diagramFacts = (facts: MediaAssetFacts) =>
    new Map([[mediaAssetFactsKey({ scope: 'site1', mediaId: 'diagram' }), facts]])

  /** One markdown-bearing node, under whichever prop that element uses. */
  const body = (componentId: 'markdown' | 'collectionEntryBody', text: string) => ({
    [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['b1'] },
    b1: {
      $id: 'b1',
      componentId,
      parentId: ROOT,
      props: { [componentId === 'markdown' ? 'content' : 'markdown']: text },
    },
  })

  const stamped = (nodes: Record<string, unknown>, facts: MediaAssetFacts) =>
    (applyMediaAssetFacts(nodes, diagramFacts(facts)).b1 as {
      props: Record<string, unknown>
    }).props

  describe('collecting the references', () => {
    it('finds them in both elements, under each one’s own prop name', () => {
      expect(mediaAssetRefs(body('markdown', BODY))).toEqual([
        { scope: 'site1', mediaId: 'diagram' },
      ])
      expect(mediaAssetRefs(body('collectionEntryBody', BODY))).toEqual([
        { scope: 'site1', mediaId: 'diagram' },
      ])
    })

    it('puts every placement ahead of every body image', () => {
      // The cap spends on placements first: a placement that misses out
      // renders at its pick-time pair and a film at the wrong shape, while a
      // body image that misses out renders exactly as it does today.
      const mixed = {
        [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['prose', 'shot', 'reel'] },
        prose: { $id: 'prose', componentId: 'markdown', props: { content: BODY } },
        shot: { $id: 'shot', componentId: 'image', props: { src: 'media:site1/shot' } },
        reel: { $id: 'reel', componentId: 'video', props: { src: 'media:site1/reel' } },
      }
      expect(mediaAssetRefs(mixed).map((ref) => ref.mediaId)).toEqual([
        'reel',
        'shot',
        'diagram',
      ])
    })

    it('counts an asset once when a body and a placement both name it', () => {
      const both = {
        [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['prose', 'shot'] },
        prose: { $id: 'prose', componentId: 'markdown', props: { content: BODY } },
        shot: { $id: 'shot', componentId: 'image', props: { src: DIAGRAM } },
      }
      expect(mediaAssetRefs(both)).toEqual([{ scope: 'site1', mediaId: 'diagram' }])
    })

    it('reads nothing for a body that is still an unresolved token', () => {
      // An entry template renders `{{entry.body}}` on every editing surface.
      // It is not a document, and walking it would buy reads for nothing.
      expect(mediaAssetRefs(body('collectionEntryBody', '{{entry.body}}'))).toEqual([])
    })

    it('ignores targets that are not library references', () => {
      const text = [
        '![hotlink](https://images.example.com/x.png)',
        '![path](/legacy/media/y.png)',
        '![token]({{var:hero}})',
        '[a link, not an image](media:site1/notanimage)',
        `![real](${DIAGRAM})`,
      ].join('\n\n')
      expect(mediaAssetRefs(body('markdown', text))).toEqual([
        { scope: 'site1', mediaId: 'diagram' },
      ])
    })

    it('is not asked about bodies when a caller wants one element', () => {
      // `only` asks for one ELEMENT's placements, and a body image is not a
      // placement of the Image element — the video reader would otherwise
      // read image documents it has no use for.
      expect(mediaAssetRefs(body('markdown', BODY), { only: 'image' })).toEqual([])
      expect(mediaAssetRefs(body('markdown', BODY), { only: 'video' })).toEqual([])
    })
  })

  describe('stamping the pairs', () => {
    it('keys the pair by the target exactly as the body wrote it', () => {
      expect(stamped(body('markdown', BODY), { width: 1200, height: 630 })).toEqual({
        content: BODY,
        intrinsicSizes: { [DIAGRAM]: { width: 1200, height: 630 } },
      })
    })

    it('leaves the body untouched when the document records no usable pair', () => {
      // An SVG the upload could not measure, or a partial capture. No pair
      // means no srcSet either, which is today's markup exactly.
      const nodes = body('markdown', BODY)
      expect(stamped(nodes, { width: 1200 })).toEqual({ content: BODY })
      expect(stamped(nodes, { width: 0, height: 0 })).toEqual({ content: BODY })
    })

    it('stamps nothing on a body whose images are all unanswerable', () => {
      const hotlinked = body('markdown', '![x](https://images.example.com/x.png)')
      expect(applyMediaAssetFacts(hotlinked, diagramFacts({ width: 1200, height: 630 })))
        .toBe(hotlinked)
    })

    it('stamps the resolved copy, and not the token the template still holds', () => {
      // A bound entry body is `{{entry.body}}` in `props` and the entry's real
      // text in `resolvedProps`. Pairs on the token copy are bytes in the tree
      // that nothing can ever look up.
      const bound = {
        [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['b1'] },
        b1: {
          $id: 'b1',
          componentId: 'collectionEntryBody',
          parentId: ROOT,
          props: { markdown: '{{entry.body}}' },
          resolvedProps: { markdown: BODY },
        },
      }
      const applied = applyMediaAssetFacts(
        bound,
        diagramFacts({ width: 1200, height: 630 }),
      ).b1 as { props: Record<string, unknown>; resolvedProps: Record<string, unknown> }
      expect(applied.props).toEqual({ markdown: '{{entry.body}}' })
      expect(applied.resolvedProps['intrinsicSizes']).toEqual({
        [DIAGRAM]: { width: 1200, height: 630 },
      })
    })
  })
})
