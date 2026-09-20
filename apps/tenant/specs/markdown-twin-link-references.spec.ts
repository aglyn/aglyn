/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock, so a license header above it silently leaves the
 * suite on jsdom, where `Request` is not a constructor.
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
 * The Markdown twin never hands an agent a reference (AGL-3118).
 *
 * `/api/markdown` is the representation an agent reads and follows links out
 * of, and a link REFERENCE is not an address: `entry:blog/e1` in an `href`
 * would be read as a relative path, or as nothing at all. So the twin resolves
 * every reference through the same routing map the HTML page resolves them
 * with, and writes the absolute URL — or, for a target that is not live, the
 * link's text alone.
 *
 * The ENTRY branch is the load-bearing case. It short-circuits the node walk
 * and emits the stored body, which until now needed no routing map at all —
 * the comment in the route said as much — so it is the branch most likely to
 * keep emitting a body verbatim, references included.
 */

jest.mock('../app/[host]/[scheme]/[[...slug]]/load-page-data', () => ({
  __esModule: true,
  loadPageData: jest.fn(),
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  // Nothing is locked in these scenarios (AGL-2495).
  visitorContentRefusal: jest.fn(async () => null),
}))
jest.mock('../utils/get-host', () => ({
  __esModule: true,
  default: jest.fn(async () => ({ host: HOST, error: null })),
  CNAME_HOST_PREFIX: 'cname--',
}))
jest.mock('@aglyn/tenant-runtime/template-screens', () => ({
  __esModule: true,
  default: jest.fn(async () => new Set<string>()),
  getTemplateScreenIds: jest.fn(async () => new Set<string>()),
  getTemplateScreenRouting: jest.fn(async () => ({
    templateScreenIds: new Set<string>(),
    listRoutes: {} as Record<string, string>,
    collectionListings: { blog: 'blog' } as Record<string, string>,
  })),
}))
// The entry read has its own suite: here it stands for "e1 is live, the draft
// is not", which is the only fact the twin's rendering turns on.
jest.mock('@aglyn/tenant-runtime/entry-link-routes', () => ({
  __esModule: true,
  resolveEntryLinkRoutes: jest.fn(async () => ({
    'entry:blog/e1': 'blog/we-launched',
  })),
}))

import { resolveEntryLinkRoutes } from '@aglyn/tenant-runtime/entry-link-routes'
import { loadPageData } from '../app/[host]/[scheme]/[[...slug]]/load-page-data'
import { GET } from '../app/api/markdown/route'

const HOST = {
  $id: 'host-1',
  subdomain: 'acme',
  cname: 'acme.test',
  displayName: 'Acme',
  screens: { home: '/' },
}

const mockLoad = loadPageData as jest.Mock

const markdownFor = async (path: string): Promise<string> => {
  const response = await GET(
    new Request('https://acme.test/api/markdown', {
      headers: {
        host: 'acme.test',
        'x-aglyn-tenant-host': 'acme',
        'x-aglyn-markdown-path': path,
      },
    }),
  )
  expect(response.status).toBe(200)
  return response.text()
}

beforeEach(() => jest.clearAllMocks())

describe('an entry’s twin (AGL-3118)', () => {
  beforeEach(() => {
    mockLoad.mockResolvedValue({
      props: {
        data: { host: HOST },
        nodes: null,
        content: {
          collection: { $id: 'blog', slug: 'blog', displayName: 'Blog' },
          entries: [],
          entry: {
            $id: 'e9',
            title: 'Hello',
            slug: 'hello',
            body:
              'Read [the launch](entry:blog/e1), skip [the draft](entry:blog/draft),\n' +
              'and browse [every post](collection:blog) or [about](/about).',
          },
        },
      },
    })
  })

  it('writes each live target’s absolute URL and drops the rest to text', async () => {
    const markdown = await markdownFor('blog/hello')

    expect(markdown).toContain('[the launch](https://acme.test/blog/we-launched)')
    expect(markdown).toContain('[every post](https://acme.test/blog)')
    expect(markdown).toContain('skip the draft,')
    // Site-relative links are left as the author wrote them, as before.
    expect(markdown).toContain('[about](/about)')
    expect(markdown).not.toContain('entry:')
    expect(markdown).not.toContain('collection:')
  })

  it('asks about the entries the body names, under the collections it has', async () => {
    await markdownFor('blog/hello')

    expect(resolveEntryLinkRoutes).toHaveBeenCalledWith({
      hostId: 'host-1',
      refs: ['entry:blog/draft', 'entry:blog/e1'],
      collectionSlugs: { blog: 'blog' },
    })
  })
})

describe('a node page’s twin (AGL-3118)', () => {
  it('resolves references in a Markdown block and on a linking element', async () => {
    mockLoad.mockResolvedValue({
      props: {
        data: { host: HOST, screen: { data: { $id: 'home', displayName: 'Home' } } },
        nodes: {
          _slot_: {
            componentId: 'layoutSlot',
            props: { component: 'main' },
            nodes: ['md', 'cta'],
          },
          md: {
            componentId: 'markdown',
            props: { content: 'Latest: [the launch](entry:blog/e1).' },
          },
          cta: {
            componentId: 'muiScreenLink',
            props: { screenId: 'entry:blog/e1', children: 'Read it' },
          },
        },
      },
    })

    const markdown = await markdownFor('')

    expect(markdown).toContain('Latest: [the launch](https://acme.test/blog/we-launched)')
    expect(markdown).toContain('[Read it](https://acme.test/blog/we-launched)')
    expect(markdown).not.toContain('entry:')
  })
})
