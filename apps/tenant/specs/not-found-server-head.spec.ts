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
 * The served head of a tenant 404 (AGL-2648).
 *
 * Measured on production 2026-09-07: `GET /definitely-missing-xyz` answered
 * `404` with `<meta name="robots" content="noindex">` and NO `<title>`. The
 * body of that document is Next's own recovery seed (`<html id="__next_error__">`,
 * an empty `<body>`) and no userland code can put markup in it — that is a
 * framework fact recorded on `[host]/not-found.tsx` and `SiteNotFound`. The
 * head is the exception: Next resolves the metadata of the recovery shell
 * through the `not-found` convention, calling the deepest `not-found` module's
 * `generateMetadata` with the segment's `params`. So the `<title>` of a 404 is
 * whatever these exports answer, and these assert the answer rather than the
 * framework mechanics that carry it.
 *
 * ## What is guarded
 *
 *  - the host boundary's title, through the same rule as every routed page
 *    (AGL-1341): the designed screen's authored SEO title verbatim, otherwise
 *    the page's name joined to the site's title by the host's separator;
 *  - that a title costs one screen DOCUMENT read and never a compose — the
 *    body is fetched by the client for the AGL-2342 reasons, and a title must
 *    not reintroduce that cost on a 404 storm;
 *  - that the resolver never throws: a metadata resolver that throws inside
 *    the recovery shell has nothing left to recover into;
 *  - that the two writers of the title — the server's head and the client's
 *    `document.title` on a client-side navigation — compose one string;
 *  - the root boundary, which is also the app's prerendered `/_not-found`
 *    document: a title, an `<h1>`, a `main` landmark, and no platform name.
 */

jest.mock('../utils/get-host', () => ({
  __esModule: true,
  default: jest.fn(),
  CNAME_HOST_PREFIX: 'cname--',
}))
jest.mock('@aglyn/tenant-runtime/get-screen', () => ({
  __esModule: true,
  default: jest.fn(),
}))
// The boundary's BODY is a client component over the whole canvas renderer;
// the head never renders it, so it is stubbed to a marker.
jest.mock('../components/site-not-found.component', () => ({
  __esModule: true,
  default: () => null,
}))

import getScreen from '@aglyn/tenant-runtime/get-screen'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import HostNotFound, {
  generateMetadata as hostNotFoundMetadata,
} from '../app/[host]/not-found'
import RootNotFound, { metadata as rootNotFoundMetadata } from '../app/not-found'
import getHost from '../utils/get-host'
import {
  hostSeoTitleParts,
  NOT_FOUND_PAGE_NAME,
  resolveNotFoundTitle,
} from '../utils/not-found-title'

const mockGetHost = getHost as jest.Mock
const mockGetScreen = getScreen as jest.Mock

/** The marketing host's real shape: a long SEO title and a bare `-`. */
const SITE_TITLE = 'Website Builder - Create Your Own Websites - Aglyn'

const HOST = {
  $id: 'host-1',
  subdomain: 'acme',
  displayName: 'Acme',
  screens: { home: '/', about: 'about' },
  seo: { title: SITE_TITLE, separator: '-' },
}

/** The bound designed 404 (`laAO0cOqhm` on the marketing host). */
const BOUND_SCREEN_ID = 'laAO0cOqhm'
const HOST_WITH_BOUND_404 = {
  ...HOST,
  errorScreens: { notFound: BOUND_SCREEN_ID },
}

const metadataFor = (host: string) =>
  hostNotFoundMetadata({ params: Promise.resolve({ host }) })

beforeEach(() => {
  jest.clearAllMocks()
  mockGetHost.mockResolvedValue({ host: HOST, error: null })
  mockGetScreen.mockResolvedValue({
    screen: {
      $id: BOUND_SCREEN_ID,
      displayName: 'Not found (404)',
      seo: { title: 'That page has moved on — Acme' },
    },
    error: null,
  })
})

describe('the host boundary’s served <title>', () => {
  it('joins “Page not found” to the site title through the host’s separator', async () => {
    const metadata = await metadataFor('acme')

    expect(metadata.title).toBe(`${NOT_FOUND_PAGE_NAME} - ${SITE_TITLE}`)
  })

  it('reads no screen at all when the host designed no 404', async () => {
    await metadataFor('acme')

    expect(mockGetScreen).not.toHaveBeenCalled()
  })

  it('renders a bound screen’s authored SEO title verbatim, nothing appended', async () => {
    mockGetHost.mockResolvedValue({ host: HOST_WITH_BOUND_404, error: null })

    const metadata = await metadataFor('acme')

    expect(metadata.title).toBe('That page has moved on — Acme')
    expect(metadata.title).not.toContain(SITE_TITLE)
    // The DOCUMENT, keyed by the resolved binding — not a compose.
    expect(mockGetScreen).toHaveBeenCalledTimes(1)
    expect(mockGetScreen).toHaveBeenCalledWith(
      expect.objectContaining({ hostId: 'host-1', screenId: BOUND_SCREEN_ID }),
    )
  })

  it('falls back to the page name when the bound screen has no SEO title', async () => {
    mockGetHost.mockResolvedValue({ host: HOST_WITH_BOUND_404, error: null })
    mockGetScreen.mockResolvedValue({
      screen: { $id: BOUND_SCREEN_ID, displayName: 'Not found (404)' },
      error: null,
    })

    const metadata = await metadataFor('acme')

    expect(metadata.title).toBe(`${NOT_FOUND_PAGE_NAME} - ${SITE_TITLE}`)
  })

  it('still answers the page name when the bound screen no longer resolves', async () => {
    mockGetHost.mockResolvedValue({ host: HOST_WITH_BOUND_404, error: null })
    mockGetScreen.mockResolvedValue({ screen: undefined, error: null })

    const metadata = await metadataFor('acme')

    expect(metadata.title).toBe(`${NOT_FOUND_PAGE_NAME} - ${SITE_TITLE}`)
  })

  it('uses the display name for a site with no SEO title', async () => {
    mockGetHost.mockResolvedValue({
      host: { ...HOST, seo: undefined },
      error: null,
    })

    const metadata = await metadataFor('acme')

    // The resolver's default separator, padded — the same one every routed
    // page on such a site gets.
    expect(metadata.title).toBe(`${NOT_FOUND_PAGE_NAME} – Acme`)
  })

  it('names nobody for a site that named itself nothing', async () => {
    mockGetHost.mockResolvedValue({
      host: { $id: 'host-9', subdomain: 'nameless', screens: {} },
      error: null,
    })

    const metadata = await metadataFor('nameless')

    expect(metadata.title).toBe(NOT_FOUND_PAGE_NAME)
    // White-label: a site with no name of its own must not be titled as ours.
    expect(metadata.title).not.toContain('Aglyn')
  })

  it('answers the page name, not a throw, when the host does not resolve', async () => {
    mockGetHost.mockResolvedValue({ host: null, error: new Error('missing') })

    await expect(metadataFor('ghost')).resolves.toEqual({
      title: NOT_FOUND_PAGE_NAME,
    })
  })

  it('answers the page name, not a throw, when a read rejects', async () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    mockGetHost.mockResolvedValue({ host: HOST_WITH_BOUND_404, error: null })
    mockGetScreen.mockRejectedValue(new Error('firestore unavailable'))

    await expect(metadataFor('acme')).resolves.toEqual({
      title: NOT_FOUND_PAGE_NAME,
    })
    // Loudly, though: a swallowed read failure is not the same as a quiet one.
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('carries no robots entry of its own — Next’s NonIndex already writes noindex on a 404', async () => {
    const metadata = await metadataFor('acme')

    expect(metadata.robots).toBeUndefined()
  })
})

describe('one title, two writers', () => {
  it('the client’s document.title rule composes exactly what the server served', async () => {
    const served = (await metadataFor('acme')).title

    // What `SiteNotFound` writes on a client-side navigation, from the fields
    // `HostBrandProvider` publishes for it.
    const { siteTitle, separator } = hostSeoTitleParts(HOST)
    expect(resolveNotFoundTitle({ siteTitle, separator })).toBe(served)
  })

  it('and agrees on the designed title too', async () => {
    mockGetHost.mockResolvedValue({ host: HOST_WITH_BOUND_404, error: null })
    const served = (await metadataFor('acme')).title

    expect(
      resolveNotFoundTitle({
        designedTitle: 'That page has moved on — Acme',
        ...hostSeoTitleParts(HOST_WITH_BOUND_404),
      }),
    ).toBe(served)
  })

  it('the host boundary still renders its body component — the head is additive', () => {
    // The stub above renders nothing; what matters is that the default export
    // is the boundary component, so `not-found.tsx` remains a boundary and
    // did not turn into a metadata-only module.
    expect(typeof HostNotFound).toBe('function')
    expect(renderToStaticMarkup(createElement(HostNotFound))).toBe('')
  })
})

describe('the root boundary — also the prerendered /_not-found document', () => {
  it('titles the document with the page name and nothing else', () => {
    expect(rootNotFoundMetadata.title).toBe(NOT_FOUND_PAGE_NAME)
    expect(String(rootNotFoundMetadata.title)).not.toContain('Aglyn')
  })

  it('renders a real document: an h1 inside the one main landmark, naming no platform', () => {
    const html = renderToStaticMarkup(createElement(RootNotFound))

    expect(html).toMatch(/<main[\s>]/)
    expect(html).toMatch(/<h1[\s>][^<]*We can’t find that page/)
    expect(html).not.toContain('Aglyn')
  })
})
