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
 * The head must say the brand ONCE (AGL-1341).
 *
 * Every branch of `buildMetadata` appended the host's SEO title to whatever
 * the page called itself, so the live marketing site was serving
 * `About Aglyn — one platform for the open web-Website Builder - Create Your
 * Own Websites - Aglyn` — 94 characters where a search result shows about 60,
 * with the brand in it twice.
 *
 * These assert the rendered head rather than the resolver (that is
 * `libs/aglyn/.../seo-title.spec.ts`), because the defect was never in the
 * composition — it was that four branches each composed, and the screen branch
 * is only one of them.
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

import { loadPageData } from '../app/[host]/[[...slug]]/load-page-data'
import { generateMetadata } from '../app/[host]/[[...slug]]/page'

const mockLoad = loadPageData as jest.Mock

/** The real shape of the marketing host: a long site title, a bare `-`. */
const SITE_TITLE = 'Website Builder - Create Your Own Websites - Aglyn'

const hostWith = (seo: Record<string, unknown> = {}) => ({
  $id: 'host-1',
  subdomain: 'acme',
  cname: 'custom.example',
  displayName: 'Acme',
  screens: { 'screen-1': 'about' },
  seo: { title: SITE_TITLE, separator: '-', ...seo },
})

const givenScreen = (options: {
  hostSeo?: Record<string, unknown>
  screen?: Record<string, unknown>
  props?: Record<string, unknown>
}) =>
  mockLoad.mockResolvedValue({
    props: {
      data: {
        host: hostWith(options.hostSeo),
        screen: {
          data: {
            $id: 'screen-1',
            displayName: 'About',
            ...(options.screen ?? {}),
          },
        },
      },
      nodes: null,
      ...(options.props ?? {}),
    },
  })

const givenContent = (content: unknown) =>
  mockLoad.mockResolvedValue({
    props: { data: { host: hostWith() }, nodes: null, content },
  })

const metadataFor = (slug: string[]) =>
  generateMetadata({
    params: Promise.resolve({ host: 'acme', slug }),
  } as never) as Promise<any>

beforeEach(() => jest.clearAllMocks())

describe('a screen with its own SEO title', () => {
  const DESIGNED = 'About Aglyn — one platform for the open web'

  it('renders it verbatim, with no site title appended', async () => {
    givenScreen({ screen: { seo: { title: DESIGNED } } })

    const metadata = await metadataFor(['about'])

    expect(metadata.title).toBe(DESIGNED)
    expect(metadata.title).not.toContain(SITE_TITLE)
  })

  it('keeps it inside the ~60 characters a search result shows', async () => {
    givenScreen({ screen: { seo: { title: DESIGNED } } })

    const metadata = await metadataFor(['about'])

    // 94 before this change; the designed titles are written to fit.
    expect(metadata.title.length).toBeLessThanOrEqual(60)
  })

  it('uses the same title for og:title, and still names the site in og:site_name', async () => {
    // The brand does not vanish from the head — it moves to the tag that
    // exists to carry it, instead of being spliced into the title.
    givenScreen({ screen: { seo: { title: DESIGNED } } })

    const metadata = await metadataFor(['about'])

    expect(metadata.openGraph.title).toBe(DESIGNED)
    expect(metadata.openGraph.siteName).toBe(SITE_TITLE)
  })

  it('treats a whitespace-only title as no title at all', async () => {
    givenScreen({ screen: { seo: { title: '   ' } } })

    const metadata = await metadataFor(['about'])

    expect(metadata.title).toBe(`About - ${SITE_TITLE}`)
  })
})

describe('a screen with no SEO title of its own', () => {
  it('falls back to its name joined to the site title', async () => {
    givenScreen({ screen: { seo: {} } })

    const metadata = await metadataFor(['about'])

    expect(metadata.title).toBe(`About - ${SITE_TITLE}`)
  })

  it('renders the site title alone rather than a bare separator', async () => {
    givenScreen({ screen: { displayName: undefined, seo: {} } })

    const metadata = await metadataFor(['about'])

    expect(metadata.title).toBe(SITE_TITLE)
  })

  it('never renders an empty title, even for a site that named itself nothing', async () => {
    mockLoad.mockResolvedValue({
      props: {
        data: {
          host: { $id: 'host-9', subdomain: 'nameless' },
          screen: { data: { $id: 'screen-1' } },
        },
        nodes: null,
      },
    })

    const metadata = await metadataFor(['about'])

    // White-label safe: the brand name comes from the resolved branding, not
    // a hard-coded "Aglyn".
    expect(metadata.title).toBe('Aglyn site')
  })
})

describe('collection pages follow the same rule', () => {
  const collection = { slug: 'blog', displayName: 'Blog' }

  it('renders an entry’s authored SEO title verbatim', async () => {
    givenContent({
      collection,
      entry: {
        $id: 'e1',
        slug: 'hello',
        title: 'Hello world',
        seoTitle: 'How we rebuilt the editor in six weeks',
      },
      entries: [],
    })

    const metadata = await metadataFor(['blog', 'hello'])

    expect(metadata.title).toBe('How we rebuilt the editor in six weeks')
    expect(metadata.openGraph.title).toBe('How we rebuilt the editor in six weeks')
  })

  it('joins an entry with no SEO title to the site title', async () => {
    givenContent({
      collection,
      entry: { $id: 'e1', slug: 'hello', title: 'Hello world' },
      entries: [],
    })

    const metadata = await metadataFor(['blog', 'hello'])

    expect(metadata.title).toBe(`Hello world - ${SITE_TITLE}`)
  })

  it('joins a list page, which has no authored title to give', async () => {
    givenContent({ collection, entry: null, entries: [] })

    const metadata = await metadataFor(['blog'])

    expect(metadata.title).toBe(`Blog - ${SITE_TITLE}`)
  })

  it('keeps a category listing distinct from the whole collection (AGL-1321)', async () => {
    givenContent({
      collection,
      category: { slug: 'news', name: 'News', known: true },
      entry: null,
      entries: [{ slug: 'a', title: 'A' }],
    })

    const metadata = await metadataFor(['blog', 'category', 'news'])

    expect(metadata.title).toBe(`News · Blog - ${SITE_TITLE}`)
  })
})

describe('the built-in gated pages', () => {
  it('name the site rather than leaving a bare "Sign in" in the tab', async () => {
    givenScreen({ props: { membershipPage: 'signin' } })

    const metadata = await metadataFor(['signin'])

    expect(metadata.title).toBe(`Sign in - ${SITE_TITLE}`)
    expect(metadata.robots).toEqual({ index: false, follow: true })
  })
})

describe('the indexing policy is untouched (AGL-1263/AGL-1300)', () => {
  it('still emits noindex on a discouraged site whose title is now verbatim', async () => {
    // `discourageSearchEngines` is deliberately ON for the marketing host.
    givenScreen({
      hostSeo: { discourageSearchEngines: true },
      screen: { seo: { title: 'About Aglyn' } },
    })

    const metadata = await metadataFor(['about'])

    expect(metadata.title).toBe('About Aglyn')
    expect(metadata.robots).toEqual({ index: false, follow: true })
  })

  it('still emits noindex for a discouraged collection entry', async () => {
    mockLoad.mockResolvedValue({
      props: {
        data: { host: hostWith({ discourageSearchEngines: true }) },
        nodes: null,
        content: {
          collection: { slug: 'blog', displayName: 'Blog' },
          entry: { $id: 'e1', slug: 'hello', title: 'Hello world' },
          entries: [],
        },
      },
    })

    const metadata = await metadataFor(['blog', 'hello'])

    expect(metadata.title).toBe(`Hello world - ${SITE_TITLE}`)
    expect(metadata.robots).toEqual({ index: false, follow: true })
  })
})
