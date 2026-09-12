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
 * A placed film follows its DAM asset, not the pick that placed it (AGL-2807).
 *
 * The composition reads each film's media document and lays its facts over
 * the node. These pin what the overlay does with an answer, what it does
 * without one, and that the two things a published page derives from the
 * node — `VideoObject` and the player's box — follow the asset.
 */

import { hostScopeToken } from './scope-tokens'
import {
  applyVideoAssetFacts,
  type VideoAssetFacts,
  videoAssetDocumentPath,
  videoAssetFactsFromDocument,
  videoAssetFactsKey,
  videoAssetRefs,
} from './video-asset-facts'
import { videoObjectJsonLd } from './video-object'

const FILM = 'media:site1/film'
const CONTEXT = { origin: 'https://acme.example', hostId: 'site1' }

/** What a pick copied onto the node from the film as first uploaded. */
const PICKED_FIRST_FILM: Record<string, unknown> = {
  src: FILM,
  title: 'The tour',
  description: 'What the product does.',
  uploadDate: '2026-09-10',
  durationSeconds: 2,
  intrinsicWidth: 640,
  intrinsicHeight: 360,
  posterFromSource: true,
}

/** The replacement's records, as `/api/media/replace` writes them. */
const REPLACED: VideoAssetFacts = {
  video: { durationMs: 3000, width: 480, height: 480 },
  poster: { width: 480, height: 480, variants: [320] },
}

const page = (props: Record<string, unknown>, componentId = 'video') => ({
  _root: { $id: '_root', componentId: 'div', nodes: ['v1'] },
  v1: { $id: 'v1', componentId, parentId: '_root', props },
})

/** The facts map a reader would return for the film this page places. */
const answered = (facts: VideoAssetFacts) =>
  new Map([[videoAssetFactsKey({ scope: 'site1', mediaId: 'film' }), facts]])

/** The props the page renders its film with, after the overlay. */
const shipped = (
  props: Record<string, unknown>,
  facts: ReadonlyMap<string, VideoAssetFacts>,
): Record<string, unknown> =>
  (applyVideoAssetFacts(page(props), facts).v1 as { props: Record<string, unknown> })
    .props

describe('a placed film follows its asset (AGL-2807)', () => {
  it("publishes the replacement's running time, not the one it was picked with", () => {
    const props = shipped(PICKED_FIRST_FILM, answered(REPLACED))
    expect(videoObjectJsonLd({ componentId: 'video', props }, CONTEXT)).toMatchObject({
      duration: 'PT3S',
    })
  })

  it("sizes the player to the replacement's frame", () => {
    expect(shipped(PICKED_FIRST_FILM, answered(REPLACED))).toMatchObject({
      intrinsicWidth: 480,
      intrinsicHeight: 480,
    })
  })

  it('drops a shape and a running time the asset no longer records', () => {
    // A replace whose new film arrived without a probe clears `video`, so the
    // stored pair and duration describe a film no longer in the bucket.
    const props = shipped(PICKED_FIRST_FILM, answered({ poster: REPLACED.poster }))
    expect(props).not.toHaveProperty('intrinsicWidth')
    expect(props).not.toHaveProperty('intrinsicHeight')
    expect(props).not.toHaveProperty('durationSeconds')
  })

  it('stops vouching for a generated poster the asset no longer has', () => {
    const props = shipped(PICKED_FIRST_FILM, answered({ video: REPLACED.video }))
    expect(props).not.toHaveProperty('posterFromSource')
    // With no poster of its own, the page withholds the block rather than
    // publishing a thumbnail that 404s.
    expect(videoObjectJsonLd({ componentId: 'video', props }, CONTEXT)).toBeUndefined()
  })

  it('starts vouching for a poster the replacement earned', () => {
    const pickedWithoutPoster: Record<string, unknown> = {
      ...PICKED_FIRST_FILM,
      posterFromSource: undefined,
    }
    expect(shipped(pickedWithoutPoster, answered(REPLACED))).toMatchObject({
      posterFromSource: true,
    })
  })

  it('keeps a running time the author typed for a film the DAM cannot measure', () => {
    // No pixel pair beside it: the pick only ever writes the duration with the
    // pair, so this one is the author's.
    const typed = { src: FILM, durationSeconds: 95 }
    expect(shipped(typed, answered({}))).toMatchObject({ durationSeconds: 95 })
  })

  it("lets the asset's running time win once the DAM has one", () => {
    const typed = { src: FILM, durationSeconds: 95 }
    expect(shipped(typed, answered(REPLACED))).toMatchObject({ durationSeconds: 3 })
  })

  it('treats a partial video record as no record, the way the DAM does', () => {
    const props = shipped(
      PICKED_FIRST_FILM,
      answered({ video: { durationMs: 3000 }, poster: REPLACED.poster }),
    )
    expect(props).not.toHaveProperty('intrinsicWidth')
    expect(props).not.toHaveProperty('durationSeconds')
  })

  it('follows a pinned reference to the same asset', () => {
    const pinned = { ...PICKED_FIRST_FILM, src: `${FILM}@abc123def4567890` }
    expect(shipped(pinned, answered(REPLACED))).toMatchObject({
      durationSeconds: 3,
      intrinsicWidth: 480,
    })
  })

  it('keeps every stored value for a film the read could not answer for', () => {
    const nodes = page(PICKED_FIRST_FILM)
    const applied = applyVideoAssetFacts(nodes, new Map())
    expect(applied).toBe(nodes)
    expect(applied.v1.props).toEqual(PICKED_FIRST_FILM)
  })

  it('leaves every other prop, and every other element, alone', () => {
    const props = shipped(
      { ...PICKED_FIRST_FILM, lightbox: true, radius: 8 },
      answered(REPLACED),
    )
    expect(props).toMatchObject({
      src: FILM,
      title: 'The tour',
      lightbox: true,
      radius: 8,
    })
    const image = page({ src: FILM, intrinsicWidth: 640, intrinsicHeight: 360 }, 'image')
    expect(applyVideoAssetFacts(image, answered(REPLACED))).toBe(image)
  })

  it('never mutates the map it was handed', () => {
    const nodes = page(PICKED_FIRST_FILM)
    const before = JSON.parse(JSON.stringify(nodes))
    applyVideoAssetFacts(nodes, answered(REPLACED))
    expect(nodes).toEqual(before)
  })
})

describe('videoAssetRefs', () => {
  it('lists each library film once, from Video nodes only', () => {
    const nodes = {
      a: { componentId: 'video', props: { src: FILM } },
      b: { componentId: 'video', props: { src: `${FILM}@abc123def4567890` } },
      c: { componentId: 'video', props: { src: 'media:org:acme/other' } },
      d: { componentId: 'image', props: { src: 'media:site1/still' } },
      e: { componentId: 'video', props: { src: 'https://videos.example.com/x.mp4' } },
      f: { componentId: 'video', props: { src: '{{var:hero}}' } },
      g: { componentId: 'video', props: {} },
    }
    expect(videoAssetRefs(nodes)).toEqual([
      { scope: 'site1', mediaId: 'film' },
      { scope: 'org:acme', mediaId: 'other' },
    ])
  })

  it('reads the resolved copy a repeated node carries', () => {
    expect(
      videoAssetRefs({
        a: {
          componentId: 'video',
          props: { src: '{{entry.film}}' },
          resolvedProps: { src: FILM },
        },
      }),
    ).toEqual([{ scope: 'site1', mediaId: 'film' }])
  })

  it('is empty for a page with no library film, and for no page at all', () => {
    expect(videoAssetRefs({ a: { componentId: 'text', props: {} } })).toEqual([])
    expect(videoAssetRefs(null)).toEqual([])
  })
})

/**
 * The composition and the besigner canvas read a film's document through
 * these two, so they are what keeps the editor and the page agreeing about
 * which films answer (AGL-2838).
 */
describe('where a film is read from, and what the read answers', () => {
  const RECORDS = { video: REPLACED.video, poster: REPLACED.poster }

  it("reads an org film from the org library and a site film from the site's own", () => {
    expect(videoAssetDocumentPath({ scope: 'org:acme', mediaId: 'film' })).toBe(
      'orgs/acme/media/film',
    )
    expect(
      videoAssetDocumentPath({ scope: 'org:acme:site9', mediaId: 'film' }),
    ).toBe('orgs/acme/media/film')
    expect(videoAssetDocumentPath({ scope: 'site1', mediaId: 'film' })).toBe(
      'hosts/site1/media/film',
    )
  })

  it('reads nothing for a scope the CDN would not parse', () => {
    expect(
      videoAssetDocumentPath({ scope: 'not a scope', mediaId: 'film' }),
    ).toBeNull()
    expect(
      videoAssetDocumentPath({ scope: 'org:acme:site1:extra', mediaId: 'film' }),
    ).toBeNull()
  })

  it("answers with the document's records for a film this site may be shown", () => {
    expect(
      videoAssetFactsFromDocument(
        { ...RECORDS, visibleTo: ['org'] },
        { scope: 'org:acme' },
        'site1',
      ),
    ).toEqual(RECORDS)
    expect(
      videoAssetFactsFromDocument(RECORDS, { scope: 'site1' }, 'site1'),
    ).toEqual(RECORDS)
  })

  it('answers nothing for a film that is gone, deleted or private', () => {
    expect(
      videoAssetFactsFromDocument(undefined, { scope: 'site1' }, 'site1'),
    ).toBeUndefined()
    expect(
      videoAssetFactsFromDocument(
        { ...RECORDS, deletedAt: 1 },
        { scope: 'site1' },
        'site1',
      ),
    ).toBeUndefined()
    expect(
      videoAssetFactsFromDocument(
        { ...RECORDS, private: true },
        { scope: 'site1' },
        'site1',
      ),
    ).toBeUndefined()
  })

  it('asks visibility of the site rendering the film, not the scope it was stored with', () => {
    const restricted = { ...RECORDS, visibleTo: [hostScopeToken('site9')] }
    expect(
      videoAssetFactsFromDocument(restricted, { scope: 'org:acme:site9' }, 'site1'),
    ).toBeUndefined()
    expect(
      videoAssetFactsFromDocument(restricted, { scope: 'org:acme' }, 'site9'),
    ).toEqual(RECORDS)
  })

  it('refuses an org film with no scope, or shared with no site, as the CDN does', () => {
    expect(
      videoAssetFactsFromDocument(RECORDS, { scope: 'org:acme' }, 'site1'),
    ).toBeUndefined()
    expect(
      videoAssetFactsFromDocument(
        { ...RECORDS, visibleTo: [] },
        { scope: 'org:acme' },
        'site1',
      ),
    ).toBeUndefined()
  })
})
