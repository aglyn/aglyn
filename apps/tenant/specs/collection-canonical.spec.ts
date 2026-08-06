/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock, so a license header above it silently leaves the
 * suite on jsdom.
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
 * Collection pages must declare which URL they are (AGL-1272).
 *
 * `generateMetadata` early-returns on `props.content`, above the block that
 * builds the canonical — so every `/blog` and `/blog/{entry}` shipped with no
 * `<link rel="canonical">` at all. That is the complement to the
 * platform-subdomain redirect: the redirect removes the duplicate origin from
 * circulation, the tag names the winner among everything left.
 *
 * The origin is asserted to be the CUSTOM domain while the host record also
 * carries a subdomain, because a canonical that named `{sub}.aglyn.app` would
 * be worse than none — it would point search engines at the very origin the
 * redirect is trying to retire.
 */

jest.mock('../app/[host]/[[...slug]]/load-page-data', () => ({
  __esModule: true,
  loadPageData: jest.fn(),
}))
// The client renderer is a large browser-side graph and nothing here renders
// it; `generateMetadata` never touches it.
jest.mock('../app/[host]/[[...slug]]/catch-all-client', () => ({
  __esModule: true,
  default: () => null,
}))

import { generateMetadata } from '../app/[host]/[[...slug]]/page'
import { loadPageData } from '../app/[host]/[[...slug]]/load-page-data'

const mockLoad = loadPageData as jest.Mock

/** A site on a custom domain that ALSO still has its platform subdomain. */
const HOST = {
  $id: 'host-1',
  subdomain: 'acme',
  cname: 'custom.example',
  displayName: 'Acme',
  screens: {},
}

const givenContent = (content: unknown) =>
  mockLoad.mockResolvedValue({ props: { data: { host: HOST }, nodes: null, content } })

const metadataFor = (slug: string[]) =>
  generateMetadata({
    params: Promise.resolve({ host: 'acme', slug }),
  } as never) as Promise<any>

beforeEach(() => jest.clearAllMocks())

describe('collection pages carry a canonical (AGL-1272)', () => {
  it('names the entry URL on an entry page', async () => {
    givenContent({
      collection: { slug: 'blog', displayName: 'Blog' },
      entry: { $id: 'e1', title: 'Hello', slug: 'hello' },
      entries: [],
    })

    const metadata = await metadataFor(['blog', 'hello'])

    expect(metadata.alternates.canonical).toBe(
      'https://custom.example/blog/hello',
    )
    expect(metadata.openGraph.url).toBe('https://custom.example/blog/hello')
  })

  it('names the list root on page 1', async () => {
    givenContent({
      collection: { slug: 'blog', displayName: 'Blog' },
      entry: null,
      entries: [],
      pagination: { page: 1, perPage: 10, totalPages: 3 },
    })

    const metadata = await metadataFor(['blog'])

    expect(metadata.alternates.canonical).toBe('https://custom.example/blog')
  })

  it('gives a paginated list its OWN canonical, not the list root', async () => {
    // `/blog/page/2` is a different page with different entries; collapsing it
    // onto `/blog` asks search engines to drop it.
    givenContent({
      collection: { slug: 'blog', displayName: 'Blog' },
      entry: null,
      entries: [],
      pagination: { page: 2, perPage: 10, totalPages: 3 },
    })

    const metadata = await metadataFor(['blog', 'page', '2'])

    expect(metadata.alternates.canonical).toBe(
      'https://custom.example/blog/page/2',
    )
  })

  it('omits it rather than guessing when the host has no origin at all', async () => {
    mockLoad.mockResolvedValue({
      props: {
        data: { host: { $id: 'host-2', displayName: 'Nameless' } },
        nodes: null,
        content: { collection: { slug: 'blog' }, entry: null, entries: [] },
      },
    })

    const metadata = await metadataFor(['blog'])

    expect(metadata.alternates).toBeUndefined()
  })
})
