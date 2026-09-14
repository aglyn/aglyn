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

import { NODE_ROOT_ID } from '../canvas-manager/canvas-manager'
import {
  COLLECTION_ENTRIES_COMPONENT_ID,
  collectionEntryTokens,
  expandCollectionEntries,
} from './collection-entries'
import {
  LAYOUT_SLOT_COMPONENT_ID,
  composeLayoutAndScreenNodes,
} from './compose-layout-nodes'
import {
  REUSABLE_INSTANCE_COMPONENT_ID,
  composeReusableComponentNodes,
} from './compose-reusable-components'
import { expandRepeatables } from './expand-repeatables'
import { resolveNamedTokens } from './resolve-named-tokens'
import { pageVideoObjects, videoObjectJsonLd } from './video-object'

const ORIGIN = 'https://acme.example'

/** Everything a video result requires, plus the description Google recommends. */
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
  it('publishes the three fields a video result requires, and the description', () => {
    expect(build(complete)).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'VideoObject',
      name: 'The 60-second tour',
      description: 'What Aglyn does, end to end.',
      uploadDate: '2026-09-01T12:00:00.000Z',
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

  for (const missing of ['title', 'uploadDate', 'poster'] as const) {
    it(`declines the whole block without a ${missing}`, () => {
      // Not a smaller win: a `VideoObject` missing one of the three is an
      // error a search console reports against the page.
      const props = { ...complete }
      delete (props as Record<string, unknown>)[missing]
      expect(build(props)).toBeUndefined()
    })
  }

  it('publishes without a description, which Google recommends but does not require', () => {
    // Withholding the block here would cost the page a video result it is
    // eligible for, over a field that only makes that result better.
    const withoutDescription: Record<string, unknown> = { ...complete }
    delete withoutDescription['description']
    const block = build(withoutDescription)
    expect(block).toMatchObject({
      '@type': 'VideoObject',
      name: 'The 60-second tour',
      uploadDate: '2026-09-01T12:00:00.000Z',
      thumbnailUrl: `${ORIGIN}/api/media/cdn/host1/still?w=1280`,
    })
    expect(block).not.toHaveProperty('description')
    expect(build({ ...complete, description: '   ' })).not.toHaveProperty(
      'description',
    )
  })

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

describe('uploadDate is the DateTime Google reads (AGL-2948)', () => {
  const uploadDateOf = (uploadDate: unknown) =>
    build({ ...complete, uploadDate })?.['uploadDate']

  it('publishes a calendar day as that day at noon UTC', () => {
    // A bare day is what Search Console reports twice against the page: an
    // invalid datetime, and one missing its timezone.
    expect(uploadDateOf('2026-09-12')).toBe('2026-09-12T12:00:00.000Z')
    expect(uploadDateOf(' 2026-09-12 ')).toBe('2026-09-12T12:00:00.000Z')
  })

  it('keeps the typed day in every zone from UTC-12 through UTC+11', () => {
    // Midnight UTC would read as the 11th everywhere in the Americas.
    const instant = Date.parse(uploadDateOf('2026-09-12') as string)
    for (let offsetHours = -12; offsetHours <= 11; offsetHours++) {
      const local = new Date(instant + offsetHours * 3_600_000)
      expect(local.toISOString().slice(0, 10)).toBe('2026-09-12')
    }
  })

  it('keeps the instant of a date-time that names its zone', () => {
    expect(uploadDateOf('2026-09-12T09:30:00-05:00')).toBe(
      '2026-09-12T14:30:00.000Z',
    )
    expect(uploadDateOf('2026-09-12T14:30:00.25Z')).toBe(
      '2026-09-12T14:30:00.250Z',
    )
    expect(uploadDateOf('2028-02-29T23:00:00+14:00')).toBe(
      '2028-02-29T09:00:00.000Z',
    )
  })

  it('publishes as typed what it cannot read without guessing', () => {
    // Which zone a zoneless time meant is a guess; a day that does not exist
    // is not one `Date` should quietly roll into March.
    for (const typed of [
      '2026-09-12T09:30:00',
      '2026-02-30',
      '2026-02-29T10:00:00Z',
      '2026-13-01',
      'September 12, 2026',
    ]) {
      expect(uploadDateOf(typed)).toBe(typed)
    }
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

/**
 * Only the videos the page draws (AGL-2957).
 *
 * The renderer starts at `NODE_ROOT_ID` and follows child id lists, and every
 * composition stage that moves a subtree does it by rewriting those lists. So
 * each map below comes from the real stage rather than from a hand-drawn
 * guess at its output: a fixture shaped by hand would agree with whatever walk
 * it was written beside, including one the page does not take.
 */
describe('pageVideoObjects publishes only the videos the page draws (AGL-2957)', () => {
  const ROOT = NODE_ROOT_ID
  const names = (nodes: Record<string, unknown>) =>
    pageVideoObjects(nodes, { origin: ORIGIN, hostId: 'host1' }).map(
      (block) => block['name'],
    )

  /** A Video bound to the entry it renders, as an entry template or card binds one. */
  const boundFilm = node({
    title: '{{entry.title}}',
    description: '{{entry.excerpt}}',
    poster: '{{entry.coverImage}}',
    src: 'media:host1/film',
    uploadDate: '2026-09-01',
  })
  const films = {
    slug: 'films',
    entries: [
      { title: 'First film', slug: 'first', coverImage: 'media:host1/first' },
      { title: 'Second film', slug: 'second', coverImage: 'media:host1/second' },
    ],
  }
  /** A Collection Entries block whose card template is a single bound Video. */
  const cardList = (id: string) => ({
    [id]: {
      $id: id,
      componentId: COLLECTION_ENTRIES_COMPONENT_ID,
      parentId: ROOT,
      props: { collectionSlug: 'films' },
      nodes: [`${id}-card`],
    },
    [`${id}-card`]: { $id: `${id}-card`, parentId: id, ...boundFilm },
  })

  it('skips the card template a collection expansion leaves in the map', () => {
    const nodes = expandCollectionEntries(
      {
        [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['list'] },
        ...cardList('list'),
      } as any,
      { films },
    )
    // The template is still in the map with its literal tokens, and the
    // block's child list now names only the clones.
    expect(nodes['list-card']?.props).toMatchObject({ title: '{{entry.title}}' })
    expect(nodes['list'].nodes).not.toContain('list-card')
    expect(names(nodes)).toEqual(['First film', 'Second film'])
  })

  it("skips it on an entry page too, where page tokens fill it with the routed entry's values", () => {
    const expanded = expandCollectionEntries(
      {
        [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['hero', 'rail'] },
        hero: { $id: 'hero', parentId: ROOT, ...boundFilm },
        ...cardList('rail'),
      } as any,
      { films },
    )
    // Entry-template substitution rewrites every node in the map, and the
    // leftover template is one of them.
    const routed = resolveNamedTokens(
      expanded,
      collectionEntryTokens(
        { title: 'Routed film', slug: 'routed', coverImage: 'media:host1/routed' },
        'films',
      ),
    )
    expect(routed['rail-card']?.props).toMatchObject({ title: 'Routed film' })
    expect(names(routed)).toEqual(['Routed film', 'First film', 'Second film'])
  })

  it('skips the row template a dataset repeater leaves in the map', () => {
    const nodes = expandRepeatables(
      {
        [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['grid'] },
        grid: {
          $id: 'grid',
          componentId: 'muiStack',
          parentId: ROOT,
          props: { repeatDataset: 'films' },
          nodes: ['cell'],
        },
        cell: { $id: 'cell', parentId: 'grid', ...node({ ...complete, title: '{{item.name}}' }) },
      } as any,
      { films: { records: [{ name: 'Alpha' }, { name: 'Beta' }] } },
    )
    expect(names(nodes)).toEqual(['Alpha', 'Beta'])
  })

  it('publishes a video the screen places in its layout slot', () => {
    // The screen's root is dropped and its children join the slot's list.
    const nodes = composeLayoutAndScreenNodes(
      {
        [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['header', 'slot'] },
        header: { $id: 'header', componentId: 'muiBox', parentId: ROOT, nodes: [] },
        slot: {
          $id: 'slot',
          componentId: LAYOUT_SLOT_COMPONENT_ID,
          parentId: ROOT,
          nodes: [],
        },
      } as any,
      {
        [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['section'] },
        section: { $id: 'section', componentId: 'muiBox', parentId: ROOT, nodes: ['film'] },
        film: { $id: 'film', parentId: 'section', ...node(complete) },
      } as any,
    )
    expect(names(nodes)).toEqual([complete.title])
  })

  it('publishes a video inside a reusable component placement', () => {
    // The definition's root takes the placement's id and child list, and its
    // children arrive under the `cmp__` namespace.
    const nodes = composeReusableComponentNodes(
      {
        [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['placed'] },
        placed: {
          $id: 'placed',
          componentId: REUSABLE_INSTANCE_COMPONENT_ID,
          parentId: ROOT,
          props: { refId: 'promo' },
          nodes: [],
        },
      } as any,
      {
        promo: {
          rootId: 'frame',
          nodes: {
            frame: { $id: 'frame', componentId: 'muiStack', nodes: ['film'] },
            film: { $id: 'film', parentId: 'frame', ...node(complete) },
          },
        },
      } as any,
    )
    expect(Object.keys(nodes)).toContain('cmp__placed__film')
    expect(names(nodes)).toEqual([complete.title])
  })

  it('publishes a video inside a tab panel', () => {
    const nodes = {
      [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['tabs'] },
      tabs: {
        $id: 'tabs',
        componentId: 'muiTabs',
        parentId: ROOT,
        props: { labels: 'Watch' },
        nodes: ['panel'],
      },
      panel: {
        $id: 'panel',
        componentId: 'muiTabPanel',
        parentId: 'tabs',
        props: { label: 'Watch' },
        nodes: ['film'],
      },
      film: { $id: 'film', parentId: 'panel', ...node(complete) },
    }
    expect(names(nodes)).toEqual([complete.title])
  })

  it('follows the child list, not the parent pointer', () => {
    // A node naming a drawn parent is not drawn unless that parent lists it:
    // an expansion re-points the list and leaves the template's `parentId`.
    const nodes = {
      [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['box'] },
      box: { $id: 'box', componentId: 'muiBox', parentId: ROOT, nodes: [] as string[] },
      film: { $id: 'film', parentId: 'box', ...node(complete) },
    }
    expect(names(nodes)).toEqual([])
  })

  it('walks every value of a map that has no root, as it always has', () => {
    // A fragment has no entry point to measure reach from, so nothing in it
    // can be ruled out.
    const nodes = {
      box: { $id: 'box', componentId: 'muiBox', nodes: [] as string[] },
      film: { $id: 'film', parentId: 'box', ...node(complete) },
    }
    expect(names(nodes)).toEqual([complete.title])
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
      uploadDate: '2026-09-01T12:00:00.000Z',
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
