/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, the suite runs on jsdom, and `Response.json` is undefined.
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

/**
 * What links to a content collection's LISTING page (AGL-2806).
 *
 * A Screen Link, Button, Image, Link Container, Tabs link, Accordion header,
 * form redirect or Link-typed component property can point at `/{slug}` by
 * storing `collection:<collectionId>` (AGL-2799). Deleting the collection takes
 * that key out of the routing map, and every one of those links renders with
 * no href and the broken-link marker. A screen delete names its links before
 * the author confirms; a collection delete named none.
 *
 * Two halves: the scanner finds the value in every slot it can be stored in,
 * and `/api/hosts/where-used` answers the `collection` kind with it — without
 * the second, the dialog could only ever say it had not been able to check.
 */

import { parseMarkdownLite } from '@aglyn/aglyn/server'
import {
  scanCollectionUsage,
  scanScreenUsage,
  type UsageCandidate,
} from '../utils/server/scan-artifact-usage'

const mockReadUsageCandidates = jest.fn()

jest.mock('../utils/server/read-usage-candidates', () => ({
  readUsageCandidates: (...args: unknown[]) => mockReadUsageCandidates(...args),
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  const hostSnapshot = {
    exists: true,
    get: (field: string) =>
      field === 'memberRoles' ? { 'uid-admin': 'admin' } : undefined,
    data: () => ({}),
  }
  return {
    emailUnverifiedResponse: () =>
      Response.json({ error: 'Email unverified' }, { status: 403 }),
    getOrgForHost: async () => null,
    isImpersonationSession: () => false,
    lockdownRefusal: async () => null,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: async () => ({ uid: 'uid-admin', email_verified: true }),
        }),
        firestore: () => ({
          collection: () => ({
            doc: () => ({ get: async () => hostSnapshot }),
          }),
        }),
      }),
    },
  }
})

import { POST } from '../app/api/hosts/where-used/route'

/** One linking element under a root, as the besigner stores a tree. */
const tree = (componentId: string, props: Record<string, unknown>) => ({
  root: { $id: 'root', componentId: 'div', nodes: ['link'] },
  link: { $id: 'link', componentId, parentId: 'root', props, nodes: [] },
})

const candidate = (
  id: string,
  overrides: Partial<UsageCandidate> = {},
): UsageCandidate => ({ id, displayName: id, ...overrides })

const empty = {
  screens: [] as UsageCandidate[],
  layouts: [] as UsageCandidate[],
  components: [] as UsageCandidate[],
}

const LISTING = 'collection:blog'

describe('scanCollectionUsage (AGL-2806)', () => {
  /*
   * Every slot AGL-2799 lets a listing be picked into, each with the prop name
   * its element really stores the target under.
   */
  const SLOTS: [string, string, Record<string, unknown>][] = [
    ['a Screen Link', 'muiScreenLink', { screenId: LISTING }],
    // The address slot is where a Link property bound to it delivers the value.
    ['a Button, in its address slot', 'muiButton', { href: LISTING }],
    ['an Image', 'image', { screenId: LISTING }],
    ['a Link Container', 'muiLinkBox', { screenId: LISTING }],
    ['a Tabs link', 'muiTabs', { labels: 'Home\nBlog', tabLink2: LISTING }],
    ['an Accordion header', 'muiAccordionSummary', { screenId: LISTING }],
    [
      'a form redirect',
      'form',
      { afterSubmit: 'redirect', redirectScreenId: LISTING },
    ],
    [
      'a Link property set on an instance',
      'reusableInstance',
      { refId: 'cta', propValues: { link: LISTING } },
    ],
  ]

  it.each(SLOTS)('finds %s that links to the listing', (_label, componentId, props) => {
    const found = scanCollectionUsage('blog', {
      ...empty,
      screens: [
        candidate('home', { versionId: 'v1', nodes: tree(componentId, props) }),
      ],
    })
    expect(found).toEqual([
      {
        type: 'screen',
        id: 'home',
        name: 'home',
        via: ['id'],
        relation: 'link',
        versionId: 'v1',
      },
    ])
  })

  it('finds a component whose Link property defaults to the listing', () => {
    // Stored on the definition beside its tree, which holds only the token
    // (AGL-2846); every instance that leaves the property unset renders it.
    const found = scanCollectionUsage('blog', {
      ...empty,
      components: [
        candidate('cta', {
          nodes: tree('muiButton', { href: '{{prop.link}}' }),
          props: [{ name: 'link', type: 'href', defaultValue: LISTING }],
        }),
      ],
    })
    expect(found).toEqual([
      expect.objectContaining({ type: 'component', id: 'cta', relation: 'link' }),
    ])
  })

  it('reads published screens, layouts and components alike', () => {
    const linked = tree('muiScreenLink', { screenId: LISTING })
    expect(
      scanCollectionUsage('blog', {
        screens: [candidate('home', { nodes: linked })],
        layouts: [candidate('chrome', { nodes: linked })],
        components: [candidate('site-nav', { nodes: linked })],
      }).map((dependent) => [dependent.type, dependent.id]),
    ).toEqual([
      ['screen', 'home'],
      ['layout', 'chrome'],
      ['component', 'site-nav'],
    ])
  })

  it('matches the collection by id, never by a slug or a screen of the same name', () => {
    // A listing link names the collection's id, and a screen reference never
    // names a collection — whatever the two ids happen to spell.
    const sources = {
      ...empty,
      screens: [
        candidate('by-slug', { nodes: tree('muiButton', { href: '/blog' }) }),
        candidate('marked-screen', {
          nodes: tree('muiScreenLink', { screenId: 'screen:blog' }),
        }),
        candidate('bare-screen', {
          nodes: tree('muiScreenLink', { screenId: 'blog' }),
        }),
        candidate('other-listing', {
          nodes: tree('muiScreenLink', { screenId: 'collection:news' }),
        }),
      ],
    }
    expect(scanCollectionUsage('blog', sources)).toEqual([])
  })

  it('leaves a listing link out of the screen scan for a screen with the same id', () => {
    expect(
      scanScreenUsage('blog', {
        ...empty,
        collections: [],
        screens: [
          candidate('home', { nodes: tree('muiScreenLink', { screenId: LISTING }) }),
        ],
      }),
    ).toEqual([])
  })

  it('does not count a listing target typed into a Markdown body, which renders as text', () => {
    // markdown-lite keeps only site-relative and http(s) link targets, so the
    // page shows the words and no link — there is nothing for a delete to
    // break. If the parser ever starts keeping such a link, this reds first.
    const content = 'Read [the blog](collection:blog) for more.'
    const inlines = parseMarkdownLite(content).flatMap((block) =>
      block.type === 'paragraph' ? block.inlines : [],
    )
    expect(inlines.some((inline) => inline.type === 'link')).toBe(false)
    expect(
      scanCollectionUsage('blog', {
        ...empty,
        screens: [candidate('home', { nodes: tree('markdown', { content }) })],
      }),
    ).toEqual([])
  })

  it('skips a deleted document', () => {
    expect(
      scanCollectionUsage('blog', {
        ...empty,
        screens: [
          candidate('gone', {
            deletedAt: 'yesterday',
            nodes: tree('muiScreenLink', { screenId: LISTING }),
          }),
        ],
      }),
    ).toEqual([])
  })

  it('matches nothing for a blank collection id', () => {
    expect(
      scanCollectionUsage('', {
        ...empty,
        screens: [
          candidate('home', {
            nodes: tree('muiScreenLink', { screenId: 'collection:' }),
          }),
        ],
      }),
    ).toEqual([])
  })
})

describe('/api/hosts/where-used answers the collection kind (AGL-2806)', () => {
  const request = (body: Record<string, unknown>) =>
    new Request('https://app.aglyn.com/api/hosts/where-used', {
      method: 'POST',
      headers: {
        authorization: 'Bearer id-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })

  const reads = (truncatedIn: string | null = null) =>
    mockReadUsageCandidates.mockImplementation(
      async (_hostRef: unknown, collectionName: string) => ({
        candidates:
          collectionName === 'screens'
            ? [
                candidate('home', {
                  versionId: 'v1',
                  displayName: 'Home',
                  nodes: tree('muiScreenLink', { screenId: LISTING }),
                }),
              ]
            : collectionName === 'layouts'
              ? [
                  candidate('chrome', {
                    displayName: 'Site chrome',
                    nodes: tree('muiTabs', { tabLink1: LISTING }),
                  }),
                ]
              : [
                  candidate('card', {
                    nodes: tree('muiButton', { href: 'screen:pricing' }),
                  }),
                ],
        truncated: collectionName === truncatedIn,
      }),
    )

  beforeEach(() => {
    mockReadUsageCandidates.mockReset()
  })

  it('names every published document that links to the listing', async () => {
    reads()
    const response = await POST(
      request({ hostId: 'host-1', kind: 'collection', id: 'blog' }),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.dependents).toEqual([
      expect.objectContaining({ type: 'screen', id: 'home', name: 'Home', relation: 'link' }),
      expect.objectContaining({
        type: 'layout',
        id: 'chrome',
        name: 'Site chrome',
        relation: 'link',
      }),
    ])
    expect(body.total).toBe(2)
    expect(body.complete).toBe(true)
    // The published trees of all three corpora, which is where a link lives.
    expect(
      mockReadUsageCandidates.mock.calls
        .map(([, collectionName, options]) => [collectionName, options.withNodes])
        .sort(),
    ).toEqual([
      ['components', true],
      ['layouts', true],
      ['screens', true],
    ])
  })

  it('says the answer is incomplete when a corpus was too big to read', async () => {
    reads('layouts')
    const response = await POST(
      request({ hostId: 'host-1', kind: 'collection', id: 'blog' }),
    )
    expect(response.status).toBe(200)
    expect((await response.json()).complete).toBe(false)
  })
})
