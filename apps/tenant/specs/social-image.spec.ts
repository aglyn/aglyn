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
 * Every page must be shareable as a large card (AGL-1337).
 *
 * The mechanism existed only for collection entries: a screen emitted no
 * `og:image` at all, so every non-content page — the whole marketing site —
 * shared as `twitter:card: summary`, the small image-less card, while 44
 * designed 1200×630 assets sat in the DAM with no field to bind them to.
 *
 * These assert the head, not the resolver (that is
 * `libs/aglyn/.../social-image.spec.ts`), because the bug was never in the
 * resolution — it was that nothing called one, that the URL reached crawlers
 * relative, and that `og:image:width`/`height` were emitted by no code path
 * in the repo.
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

const HOST_IMAGE = 'media:host-1/host-og'
const SCREEN_IMAGE = 'media:host-1/screen-og'
const CDN = 'https://custom.example/api/media/cdn/host-1'

const hostWith = (seo: Record<string, unknown>) => ({
  $id: 'host-1',
  subdomain: 'acme',
  cname: 'custom.example',
  displayName: 'Acme',
  screens: { 'screen-1': 'about' },
  seo,
})

const givenScreen = (options: {
  hostSeo?: Record<string, unknown>
  screenSeo?: Record<string, unknown>
}) =>
  mockLoad.mockResolvedValue({
    props: {
      data: {
        host: hostWith(options.hostSeo ?? {}),
        screen: {
          data: {
            $id: 'screen-1',
            displayName: 'About',
            seo: options.screenSeo ?? {},
          },
        },
      },
      nodes: null,
    },
  })

const metadataFor = (slug: string[]) =>
  generateMetadata({
    params: Promise.resolve({ host: 'acme', slug }),
  } as never) as Promise<any>

beforeEach(() => jest.clearAllMocks())

describe('a screen’s social card (AGL-1337)', () => {
  it('emits the screen’s own image over the site default', () => {
    givenScreen({
      hostSeo: { image: HOST_IMAGE, imageWidth: 1200, imageHeight: 630 },
      screenSeo: { image: SCREEN_IMAGE, imageWidth: 1200, imageHeight: 630 },
    })

    return metadataFor(['about']).then((metadata) => {
      expect(metadata.openGraph.images).toEqual([
        { url: `${CDN}/screen-og`, width: 1200, height: 630 },
      ])
    })
  })

  it('falls back to the site default when the screen sets none', async () => {
    givenScreen({
      hostSeo: { image: HOST_IMAGE, imageWidth: 1200, imageHeight: 630 },
      screenSeo: {},
    })

    const metadata = await metadataFor(['about'])

    expect(metadata.openGraph.images[0].url).toBe(`${CDN}/host-og`)
  })

  it('emits the dimensions from the media record, so the card reserves the right box', async () => {
    // Not hardcoded 1200×630: a site may use another ratio and the head has
    // to describe the asset it actually names.
    givenScreen({
      screenSeo: { image: SCREEN_IMAGE, imageWidth: 1600, imageHeight: 900 },
    })

    const metadata = await metadataFor(['about'])

    expect(metadata.openGraph.images[0]).toMatchObject({
      width: 1600,
      height: 900,
    })
  })

  it('makes the URL absolute — a crawler has no page to resolve one against', async () => {
    givenScreen({ screenSeo: { image: SCREEN_IMAGE } })

    const metadata = await metadataFor(['about'])

    expect(metadata.openGraph.images[0].url).toBe(`${CDN}/screen-og`)
    // The shape of the bug this replaces: the stored value passed straight
    // through, so a reference reached `og:image` as the literal `media:…`.
    expect(metadata.openGraph.images[0].url).not.toContain('media:')
  })

  it('upgrades the twitter card to summary_large_image once there is an image', async () => {
    givenScreen({ screenSeo: { image: SCREEN_IMAGE } })

    const metadata = await metadataFor(['about'])

    expect(metadata.twitter.card).toBe('summary_large_image')
    expect(metadata.twitter.images[0].url).toBe(`${CDN}/screen-og`)
  })

  it('keeps the small card, and no og:image, when neither is set', async () => {
    givenScreen({ hostSeo: {}, screenSeo: {} })

    const metadata = await metadataFor(['about'])

    expect(metadata.openGraph.images).toBeUndefined()
    expect(metadata.twitter.card).toBe('summary')
    expect(metadata.twitter.images).toBeUndefined()
  })

  it('round-trips a CLEARED screen image back to the site default', async () => {
    // "Clear" writes `''` rather than dropping the key — an absent field on a
    // merge write leaves the old image in place, and `''` is exactly the
    // value the attributes form stack cannot carry (AGL-1191), which is why
    // this field is written straight to the doc instead.
    givenScreen({
      hostSeo: { image: HOST_IMAGE, imageWidth: 1200, imageHeight: 630 },
      screenSeo: { image: '', imageWidth: 0, imageHeight: 0 },
    })

    const metadata = await metadataFor(['about'])

    expect(metadata.openGraph.images[0].url).toBe(`${CDN}/host-og`)
    expect(metadata.twitter.card).toBe('summary_large_image')
  })

  it('emits no image rather than a relative one when the host names no origin', async () => {
    mockLoad.mockResolvedValue({
      props: {
        data: {
          host: { $id: 'host-2', displayName: 'Nameless', seo: { image: HOST_IMAGE } },
          screen: { data: { $id: 'screen-1', seo: {} } },
        },
        nodes: null,
      },
    })

    const metadata = await metadataFor(['about'])

    expect(metadata.openGraph.images).toBeUndefined()
    expect(metadata.twitter.card).toBe('summary')
  })
})

describe('the image must not disturb the indexing policy (AGL-1263/AGL-1300)', () => {
  it('still emits noindex on a discouraged site that now has a card', async () => {
    // `discourageSearchEngines` is deliberately ON for the marketing host.
    // A social card is for humans pasting a link; it must not read as an
    // invitation to index, and adding it must not perturb the directive.
    givenScreen({
      hostSeo: {
        discourageSearchEngines: true,
        image: HOST_IMAGE,
        imageWidth: 1200,
        imageHeight: 630,
      },
      screenSeo: { image: SCREEN_IMAGE, imageWidth: 1200, imageHeight: 630 },
    })

    const metadata = await metadataFor(['about'])

    expect(metadata.robots).toEqual({ index: false, follow: true })
    expect(metadata.openGraph.images[0].url).toBe(`${CDN}/screen-og`)
  })

  it('leaves an undiscouraged screen free to be indexed', async () => {
    givenScreen({ screenSeo: { image: SCREEN_IMAGE } })

    const metadata = await metadataFor(['about'])

    expect(metadata.robots).toBeUndefined()
  })
})

describe('collection pages share the same chain', () => {
  const givenContent = (
    content: unknown,
    hostSeo: Record<string, unknown> = {},
  ) =>
    mockLoad.mockResolvedValue({
      props: { data: { host: hostWith(hostSeo) }, nodes: null, content },
    })

  it('still prefers the entry’s own cover', async () => {
    givenContent(
      {
        collection: { slug: 'blog', displayName: 'Blog' },
        entry: { $id: 'e1', title: 'Hello', slug: 'hello', coverImage: 'media:host-1/cover' },
        entries: [],
      },
      { image: HOST_IMAGE, imageWidth: 1200, imageHeight: 630 },
    )

    const metadata = await metadataFor(['blog', 'hello'])

    expect(metadata.openGraph.images[0].url).toBe(`${CDN}/cover`)
    // The cover carries no stored dimensions, and half a pair is worse than
    // none — it must not borrow the site default's.
    expect(metadata.openGraph.images[0].width).toBeUndefined()
  })

  it('gives an entry with no cover the site default instead of a bare summary card', async () => {
    givenContent(
      {
        collection: { slug: 'blog', displayName: 'Blog' },
        entry: { $id: 'e1', title: 'Hello', slug: 'hello' },
        entries: [],
      },
      { image: HOST_IMAGE, imageWidth: 1200, imageHeight: 630 },
    )

    const metadata = await metadataFor(['blog', 'hello'])

    expect(metadata.openGraph.images[0].url).toBe(`${CDN}/host-og`)
    expect(metadata.twitter.card).toBe('summary_large_image')
  })

  it('covers the list page too, which could never have had a cover of its own', async () => {
    givenContent(
      {
        collection: { slug: 'blog', displayName: 'Blog' },
        entry: null,
        entries: [],
        pagination: { page: 1, perPage: 10, totalPages: 3 },
      },
      { image: HOST_IMAGE, imageWidth: 1200, imageHeight: 630 },
    )

    const metadata = await metadataFor(['blog'])

    expect(metadata.openGraph.images[0].url).toBe(`${CDN}/host-og`)
  })
})
