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

import { pageVideoObjects, videoObjectJsonLd } from './video-object'

const ORIGIN = 'https://acme.example'

/** Everything a video result requires, and nothing it does not. */
const complete = {
  title: 'The 60-second tour',
  description: 'What Aglyn does, end to end.',
  uploadDate: '2026-09-01',
  poster: 'media:host1/still',
  src: 'media:host1/film',
}

const node = (props: Record<string, unknown>) => ({
  componentId: 'video',
  props,
})

const build = (props: Record<string, unknown>) =>
  videoObjectJsonLd(node(props), { origin: ORIGIN, hostId: 'host1' })

describe('videoObjectJsonLd', () => {
  it('publishes the four fields a video result requires', () => {
    expect(build(complete)).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'VideoObject',
      name: 'The 60-second tour',
      description: 'What Aglyn does, end to end.',
      uploadDate: '2026-09-01',
      thumbnailUrl: `${ORIGIN}/api/media/cdn/host1/still?w=1280`,
    })
  })

  it('resolves every url absolutely, never as a stored reference', () => {
    // A `media:` reference in structured data is a string no crawler can
    // fetch — the AGL-1343 lesson, which cost `Article.image` a release.
    const raw = JSON.stringify(build(complete))
    expect(raw).not.toContain('media:')
    expect(build(complete)).toMatchObject({
      contentUrl: `${ORIGIN}/api/media/cdn/host1/film`,
    })
  })

  it('asks for the poster at the same width the element renders', () => {
    // Different bytes at the two call sites means the crawler and the visitor
    // are looking at different pictures.
    expect((build(complete) as any).thumbnailUrl).toContain('?w=1280')
  })

  it('adds the duration when one is known, in ISO-8601', () => {
    expect(build({ ...complete, durationSeconds: 63 })).toMatchObject({
      duration: 'PT1M3S',
    })
  })

  it('omits the duration rather than claiming zero', () => {
    expect(build(complete)).not.toHaveProperty('duration')
    expect(build({ ...complete, durationSeconds: 0 })).not.toHaveProperty(
      'duration',
    )
  })

  it('never emits `embedUrl` for a film this site serves', () => {
    // `embedUrl` names a PLAYER page. A library film is a file, and a
    // crawler told it is a player would go looking for one.
    expect(build(complete)).not.toHaveProperty('embedUrl')
  })

  for (const missing of [
    'title',
    'description',
    'uploadDate',
    'poster',
  ] as const) {
    it(`declines the whole block without a ${missing}`, () => {
      // Not a smaller win: a `VideoObject` missing one of the four is an
      // error a search console reports against the page.
      const props = { ...complete }
      delete (props as Record<string, unknown>)[missing]
      expect(build(props)).toBeUndefined()
    })
  }

  it('treats whitespace as absent', () => {
    expect(build({ ...complete, title: '   ' })).toBeUndefined()
  })

  it('reads the resolved props a repeated node carries', () => {
    // A node inside a collection binds its values into `resolvedProps`; the
    // raw `props` there hold the binding token, not the sentence.
    expect(
      videoObjectJsonLd(
        { componentId: 'video', props: { title: '{{var:x}}' }, resolvedProps: complete },
        { origin: ORIGIN, hostId: 'host1' },
      ),
    ).toMatchObject({ name: 'The 60-second tour' })
  })

  it('ignores every element that is not a Video', () => {
    expect(
      videoObjectJsonLd({ componentId: 'image', props: complete }, {
        origin: ORIGIN,
      }),
    ).toBeUndefined()
    expect(videoObjectJsonLd(undefined)).toBeUndefined()
  })

  it('declines a poster it cannot make absolute', () => {
    // With no origin a CDN path stays relative, and a relative thumbnailUrl
    // is not a URL a crawler can resolve from a search index.
    expect(
      videoObjectJsonLd(node(complete), { hostId: 'host1' }),
    ).toBeUndefined()
  })
})

describe('pageVideoObjects', () => {
  it('walks the flat composed map, not a tree of children', () => {
    // ⚠️ The composed map is DENORMALIZED: children are id STRINGS under
    // `nodes`. The commerce enricher's first version recursed `children`,
    // matched nothing on any page, and shipped green on a nested fixture.
    const nodes = {
      root: { componentId: 'div', nodes: ['a', 'b'] },
      a: { componentId: 'muiTypography', props: {} },
      b: node(complete),
    }
    const found = pageVideoObjects(nodes, { origin: ORIGIN, hostId: 'host1' })
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ '@type': 'VideoObject' })
  })

  it('publishes one block per publishable video', () => {
    const nodes = {
      one: node(complete),
      two: node({ ...complete, title: 'Another film' }),
      three: node({ src: 'media:host1/x' }),
    }
    expect(
      pageVideoObjects(nodes, { origin: ORIGIN, hostId: 'host1' }).map(
        (block: any) => block.name,
      ),
    ).toEqual(['The 60-second tour', 'Another film'])
  })

  it('is empty for the page that has no video, which is most of them', () => {
    expect(pageVideoObjects(null)).toEqual([])
    expect(pageVideoObjects({})).toEqual([])
    expect(
      pageVideoObjects({ a: { componentId: 'image', props: {} } }),
    ).toEqual([])
  })
})

describe('a Wistia video (AGL-2826)', () => {
  const wistia = {
    ...complete,
    src: 'https://aglyn.wistia.com/medias/e4a27b971d',
    durationSeconds: 60,
  }

  it('publishes the player page as embedUrl, beside a DAM thumbnail', () => {
    expect(build(wistia)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'VideoObject',
      name: 'The 60-second tour',
      description: 'What Aglyn does, end to end.',
      thumbnailUrl: `${ORIGIN}/api/media/cdn/host1/still?w=1280`,
      uploadDate: '2026-09-01',
      embedUrl: 'https://fast.wistia.net/embed/iframe/e4a27b971d',
      duration: 'PT1M',
    })
  })

  it('never calls the pasted media page a content file', () => {
    // The link is Wistia's HTML page. As `contentUrl` it would tell a crawler
    // to fetch a film from an address that serves a web page.
    expect(build(wistia)).not.toHaveProperty('contentUrl')
  })

  it('rebuilds the embed address rather than publishing the pasted one', () => {
    expect(
      build({
        ...wistia,
        src: 'https://fast.wistia.com/embed/iframe/e4a27b971d?autoPlay=true',
      }),
    ).toMatchObject({
      embedUrl: 'https://fast.wistia.net/embed/iframe/e4a27b971d',
    })
  })

  it('still needs an authored poster, since Wistia generates none here', () => {
    // `posterFromSource` means the DAM captured a frame, and a Wistia link is
    // not a DAM reference, so it can never vouch for a thumbnail.
    expect(
      build({ ...wistia, poster: undefined, posterFromSource: true }),
    ).toBeUndefined()
  })
})

describe('the generated poster is used only when one is known to exist', () => {
  const withoutAuthoredPoster = {
    title: complete.title,
    description: complete.description,
    uploadDate: complete.uploadDate,
    src: complete.src,
  }

  it('derives the thumbnail from the source when the node says there is one', () => {
    expect(build({ ...withoutAuthoredPoster, posterFromSource: true })).toMatchObject(
      { thumbnailUrl: `${ORIGIN}/api/media/cdn/host1/film?poster=1&w=1280` },
    )
  })

  it('publishes NOTHING when no poster is known (AGL-2749)', () => {
    // `mediaPosterSrc` answers for any CDN reference and its url is not a
    // promise: a video uploaded before AGL-2742 answers 404, and a rich
    // result whose thumbnail 404s is worse than no rich result.
    expect(build(withoutAuthoredPoster)).toBeUndefined()
  })

  it("lets an author's own poster beat the generated one", () => {
    expect(build({ ...complete, posterFromSource: true })).toMatchObject({
      thumbnailUrl: `${ORIGIN}/api/media/cdn/host1/still?w=1280`,
    })
  })
})
