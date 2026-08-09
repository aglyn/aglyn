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
 * A collection list screen's own SEO reaches the head (AGL-1345).
 *
 * `/changelog` emitted no screen metadata whatsoever — the collection's name
 * for the title and, for the description, the platform boilerplate that
 * `app/layout.tsx` hands to any page that names none. `/blog` and `/press`,
 * built the same way on the same host, were correct throughout.
 *
 * The divergence was in ROUTING, not in the pages. `/changelog`'s screen is
 * also its collection's `listScreenId`, and a template screen is dropped from
 * the routing map on purpose (AGL-1267), so the request falls past the screen
 * branch into the collection branch — which described the page from the
 * COLLECTION while the body was composed from the SCREEN. `/blog` and
 * `/press` are ordinary screens and never left the screen branch.
 *
 * So these assert the two branches agree, rather than asserting the
 * collection branch in isolation: the bug was a disagreement, and only a
 * comparison can fail if it comes back.
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

const SCREEN_TITLE = 'Changelog — What we’ve shipped | Acme'
const SCREEN_DESCRIPTION =
  'New features and improvements landing in Acme — updated as we ship.'
/** What the root layout falls back to, and what `/changelog` was emitting. */
const HOST_DESCRIPTION = 'Contributions to the no-code web application market.'

const hostWith = (seo: Record<string, unknown> = {}) => ({
  $id: 'host-1',
  subdomain: 'acme',
  cname: 'custom.example',
  displayName: 'Acme',
  screens: { 'screen-1': 'changelog' },
  seo: { title: 'Acme', separator: '|', ...seo },
})

/**
 * The `/changelog` shape: a screen that is ALSO its collection's list
 * template, so the loader composes the body from the screen and hands the
 * routed collection alongside it.
 */
const givenListTemplate = (options: {
  screenSeo?: Record<string, unknown>
  screenDescription?: string
  hostSeo?: Record<string, unknown>
  category?: unknown
  entry?: unknown
} = {}) =>
  mockLoad.mockResolvedValue({
    props: {
      data: {
        host: hostWith(options.hostSeo),
        screen: {
          data: {
            $id: 'screen-1',
            displayName: 'Changelog',
            ...(options.screenDescription
              ? { description: options.screenDescription }
              : {}),
            seo: options.screenSeo ?? {},
          },
        },
      },
      nodes: { root: {} },
      content: {
        collection: { slug: 'changelog', displayName: 'Changelog' },
        entry: options.entry ?? null,
        entries: [],
        ...(options.category ? { category: options.category } : {}),
      },
    },
  })

/** The `/blog` shape: an ordinary screen, no collection routing involved. */
const givenOrdinaryScreen = (screenSeo: Record<string, unknown>) =>
  mockLoad.mockResolvedValue({
    props: {
      data: {
        host: hostWith(),
        screen: {
          data: { $id: 'screen-1', displayName: 'Changelog', seo: screenSeo },
        },
      },
      nodes: { root: {} },
    },
  })

const metadataFor = (slug: string[]) =>
  generateMetadata({
    params: Promise.resolve({ host: 'acme', slug }),
  } as never) as Promise<any>

/** The fields the two branches must agree on; canonical and og:type differ by design. */
const headCopy = (metadata: any) => ({
  title: metadata.title,
  description: metadata.description,
  ogTitle: metadata.openGraph?.title,
  ogDescription: metadata.openGraph?.description,
})

beforeEach(() => jest.clearAllMocks())

describe('a collection list screen with its own SEO', () => {
  it('renders that SEO rather than the collection name and the host default', async () => {
    givenListTemplate({
      screenSeo: { title: SCREEN_TITLE, description: SCREEN_DESCRIPTION },
      hostSeo: { description: HOST_DESCRIPTION },
    })

    const metadata = await metadataFor(['changelog'])

    expect(metadata.title).toBe(SCREEN_TITLE)
    expect(metadata.description).toBe(SCREEN_DESCRIPTION)
    // The regression this whole issue is: the collection's display name as the
    // title, and a site-wide sentence that describes no page as the description.
    expect(metadata.title).not.toBe('Changelog')
    expect(metadata.description).not.toBe(HOST_DESCRIPTION)
  })

  it('carries it into og: and twitter: too, not just the title tag', async () => {
    givenListTemplate({
      screenSeo: { title: SCREEN_TITLE, description: SCREEN_DESCRIPTION },
    })

    const metadata = await metadataFor(['changelog'])

    expect(metadata.openGraph.title).toBe(SCREEN_TITLE)
    expect(metadata.openGraph.description).toBe(SCREEN_DESCRIPTION)
    expect(metadata.openGraph.siteName).toBe('Acme')
  })

  it('reads the same screen the body was composed from', async () => {
    // `composeCollectionTemplatePage` hands the template screen through as
    // `data.screen`; before the fix the head ignored it and described the
    // collection instead, so one document answered two ways.
    givenListTemplate({
      screenSeo: {},
      screenDescription: 'What we have shipped.',
    })

    const metadata = await metadataFor(['changelog'])

    expect(metadata.description).toBe('What we have shipped.')
  })

  it('matches what the identical page would emit as an ordinary screen', async () => {
    // `/blog` and `/press` are ordinary screens; `/changelog` is a list
    // template. Routing decided which branch built the head, and the two
    // branches must not disagree about the answer.
    givenListTemplate({
      screenSeo: { title: SCREEN_TITLE, description: SCREEN_DESCRIPTION },
    })
    const asListTemplate = await metadataFor(['changelog'])

    givenOrdinaryScreen({ title: SCREEN_TITLE, description: SCREEN_DESCRIPTION })
    const asScreen = await metadataFor(['changelog'])

    expect(headCopy(asListTemplate)).toEqual(headCopy(asScreen))
  })
})

describe('a collection list screen that sets nothing', () => {
  it('joins the collection name to the site title, never a bare name', async () => {
    // The screen's stored SEO no longer carries a defaulted title (AGL-1345),
    // so an untitled list must not render verbatim as "Changelog".
    givenListTemplate({ screenSeo: {} })

    const metadata = await metadataFor(['changelog'])

    expect(metadata.title).toBe('Changelog | Acme')
  })

  it('falls back to the host description', async () => {
    givenListTemplate({
      screenSeo: {},
      hostSeo: { description: HOST_DESCRIPTION },
    })

    const metadata = await metadataFor(['changelog'])

    expect(metadata.description).toBe(HOST_DESCRIPTION)
  })
})

describe('the cases that must NOT inherit the template screen', () => {
  it('titles an entry from the entry, not from the list screen', async () => {
    // One authored title on the template would name every post in the
    // collection identically.
    givenListTemplate({
      screenSeo: { title: SCREEN_TITLE, description: SCREEN_DESCRIPTION },
      entry: {
        $id: 'e1',
        title: 'Search visibility',
        slug: 'search-visibility',
        excerpt: 'Per-screen SEO fields.',
      },
    })

    const metadata = await metadataFor(['changelog', 'search-visibility'])

    expect(metadata.title).toBe('Search visibility | Acme')
    expect(metadata.description).toBe('Per-screen SEO fields.')
  })

  it('keeps a category listing distinct from the whole collection (AGL-1321)', async () => {
    // An authored title applied to five filtered URLs is the same duplicate
    // SERP result the category titles exist to prevent.
    givenListTemplate({
      screenSeo: { title: SCREEN_TITLE, description: SCREEN_DESCRIPTION },
      category: { slug: 'shipped', name: 'Shipped', known: true },
    })

    const metadata = await metadataFor(['changelog', 'category', 'shipped'])

    expect(metadata.title).toBe('Shipped · Changelog | Acme')
    // The description still describes the list being filtered, which beats the
    // site-wide default it used to fall through to.
    expect(metadata.description).toBe(SCREEN_DESCRIPTION)
  })
})

describe('the indexing policy is untouched (AGL-1263/AGL-1300)', () => {
  it('still emits noindex on a discouraged site whose list SEO now renders', async () => {
    givenListTemplate({
      screenSeo: { title: SCREEN_TITLE, description: SCREEN_DESCRIPTION },
      hostSeo: { discourageSearchEngines: true },
    })

    const metadata = await metadataFor(['changelog'])

    expect(metadata.robots).toEqual({ index: false, follow: true })
    expect(metadata.title).toBe(SCREEN_TITLE)
  })

  it('still emits noindex for an unknown, empty category', async () => {
    givenListTemplate({
      screenSeo: { title: SCREEN_TITLE },
      category: { slug: 'nope', name: 'nope', known: false },
    })

    const metadata = await metadataFor(['changelog', 'category', 'nope'])

    expect(metadata.robots).toEqual({ index: false, follow: true })
  })
})
