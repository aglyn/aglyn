/**
 * @jest-environment node
 *
 * The server component under test reaches `next/cache`, which throws
 * `Class extends value undefined` under jsdom — jest's default here. Every
 * sibling spec that renders this route carries the same pragma.
 */

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
 * An author page's structured data (AGL-2535).
 *
 * AGL-2518 shipped `/author/{slug}` and its `ProfilePage` block with **no
 * spec at all** — the block was verified by reading the live page once, which
 * says nothing about the branch's behaviour on any other input. This closes
 * that, and the first thing it caught is the reason it exists: the branch
 * emitted a `publisher` with no `logo`, while the `Article` branch on the same
 * `host.seo.entity` emitted one with. Two answers to "who published this",
 * from one setting.
 *
 * Asserts the RENDERED JSON-LD, like `article-json-ld.spec.ts` beside it — the
 * author serializer has its own unit spec in
 * `libs/aglyn/.../content-authors.spec.ts`, and what is untested here is the
 * wiring.
 */

jest.mock('../app/[host]/[[...slug]]/load-page-data', () => ({
  __esModule: true,
  loadPageData: jest.fn(),
}))
jest.mock('../app/[host]/[[...slug]]/catch-all-client', () => ({
  __esModule: true,
  default: () => null,
}))

import { loadPageData } from '../app/[host]/[[...slug]]/load-page-data'
import CatchAllPage from '../app/[host]/[[...slug]]/page'
/*
  `HostEntityType` inlined rather than imported.

  Importing it — from the barrel OR from its own module — pulls a graph that
  reaches `@aglyn/tenant-data-admin` → `render-cache` → `next/cache`, which
  throws `Class extends value undefined` under jest and fails the suite before
  a case runs. `article-json-ld.spec.ts` beside this one imports nothing from
  the workspace for the same reason.

  Two values, frozen by the enum's own definition in
  `foundation/definitions/platform.types.ts`. They are PERSISTED — the Setup →
  SEO → Entity form stores them — so they cannot drift without a migration.
*/
const HostEntityType = { ORGANIZATION: 0x1, PERSON: 0x2 } as const

const mockLoad = loadPageData as jest.Mock

const ORIGIN = 'https://custom.example'

const hostWith = (overrides: Record<string, unknown> = {}) => ({
  $id: 'host-1',
  subdomain: 'acme',
  cname: 'custom.example',
  displayName: 'Acme',
  screens: {},
  seo: {},
  ...overrides,
})

const RECORD = {
  $id: 'a1',
  type: HostEntityType.PERSON,
  slug: 'zg',
  name: 'Zach Gover',
  bio: 'Building the open web platform.',
  image: 'media:host-1/portrait',
  jobTitle: 'Founder & CEO',
  worksFor: 'Aglyn',
  sameAs: ['https://github.com/zgover'],
  links: [{ platform: 'x', url: 'https://x.com/ZachWGover' }],
}

/** Renders `/author/{slug}` and returns every JSON-LD block, parsed. */
const jsonLdFor = async (options: {
  host?: Record<string, unknown>
  author?: Record<string, unknown>
} = {}) => {
  mockLoad.mockResolvedValue({
    props: {
      data: { host: options.host ?? hostWith() },
      nodes: null,
      author: {
        slug: 'zg',
        name: 'Zach Gover',
        record: RECORD,
        page: 1,
        totalPages: 1,
        totalEntries: 3,
        ...options.author,
      },
    },
  })
  const tree = await CatchAllPage({
    params: Promise.resolve({ host: 'acme', slug: ['author', 'zg'] }),
  } as never)
  const blocks: string[] = []
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(walk)
    const html = node.props?.dangerouslySetInnerHTML?.__html
    if (typeof html === 'string') blocks.push(html)
    walk(node.props?.children)
  }
  walk(tree)
  return blocks.map((block) => ({ raw: block, value: JSON.parse(block) }))
}

const profileFrom = async (options: Parameters<typeof jsonLdFor>[0] = {}) => {
  const blocks = await jsonLdFor(options)
  return blocks.find((block) => block.value['@type'] === 'ProfilePage')
}

beforeEach(() => jest.clearAllMocks())

describe('ProfilePage on an author page (AGL-2518/2535)', () => {
  it('is a ProfilePage whose mainEntity is the person', async () => {
    // `ProfilePage` is what schema.org defines for "a page about one person",
    // and `mainEntity` is the entity itself — the edge a crawler follows from
    // an article's byline to the page collecting that author.
    const profile = await profileFrom()
    expect(profile?.value['@type']).toBe('ProfilePage')
    expect(profile?.value.url).toBe(`${ORIGIN}/author/zg`)
    expect(profile?.value.name).toBe('Zach Gover')
    expect(profile?.value.mainEntity).toMatchObject({
      '@type': 'Person',
      name: 'Zach Gover',
      jobTitle: 'Founder & CEO',
      worksFor: { '@type': 'Organization', name: 'Aglyn' },
    })
  })

  it('resolves the portrait to an absolute url, never a media reference', async () => {
    // The same rule `Article.image` follows (AGL-1343): a crawler has no page
    // to resolve `media:{scope}/{id}` against.
    const profile = await profileFrom()
    expect(String(profile?.value.mainEntity.image)).toMatch(/^https:\/\//)
    expect(profile?.raw).not.toContain('media:')
  })

  it('folds a rendered link row into sameAs without duplicating it', async () => {
    // A link the profile PRINTS is also a profile the author claims, so the
    // rows join `sameAs` rather than being a second list to keep in step
    // (AGL-2516).
    const profile = await profileFrom()
    const sameAs = profile?.value.mainEntity.sameAs as string[]
    expect(sameAs).toContain('https://github.com/zgover')
    expect(sameAs).toContain('https://x.com/ZachWGover')
    expect(new Set(sameAs).size).toBe(sameAs.length)
  })

  it('PICTURES the publisher, not just names it', async () => {
    /*
      The bug this spec's absence hid. The `Article` branch merges
      `hostSeoEntityImageJsonLd` into `publisher`; this branch spread the bare
      `publisher`, so one `host.seo.entity` produced a pictured publisher on a
      post and an unpictured one on its author's page.

      `logo` for an Organization — schema.org gives it only to that branch.
    */
    const profile = await profileFrom({
      host: hostWith({
        seo: {
          entity: {
            type: HostEntityType.ORGANIZATION,
            name: 'Acme',
            logo: 'https://cdn.example/acme.png',
          },
        },
      }),
    })
    expect(profile?.value.publisher).toEqual({
      '@type': 'Organization',
      name: 'Acme',
      logo: 'https://cdn.example/acme.png',
    })
  })

  it('emits no publisher at all when the site declares no entity', async () => {
    // Spreadable-or-absent, never `"publisher": null`.
    const profile = await profileFrom()
    expect(profile?.value).not.toHaveProperty('publisher')
  })

  it('emits nothing for an author with no resolvable record', async () => {
    // A legacy free-typed byline has a page and a heading, but no entity to
    // serialise — and `"mainEntity": null` is worse than an absent block.
    const blocks = await jsonLdFor({ author: { record: null } })
    expect(blocks.map((block) => block.value['@type'])).not.toContain(
      'ProfilePage',
    )
  })

  it('canonicalises a paged archive to the page being read', async () => {
    const profile = await profileFrom({ author: { page: 2, totalPages: 3 } })
    expect(profile?.value.url).toBe(`${ORIGIN}/author/zg/page/2`)
  })

  it('escapes a byline that would otherwise close the script element', async () => {
    // `safeJsonLd` is the one place a value becomes markup (AGL-496).
    const profile = await profileFrom({
      author: {
        name: '</script><img onerror=1>',
        record: { ...RECORD, name: '</script><img onerror=1>' },
      },
    })
    expect(profile?.raw).not.toContain('</script>')
  })
})
