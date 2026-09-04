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
 * The two `<img src>` reads in the tenant client renderer (AGL-1407).
 *
 * Both shipped the stored value verbatim, so a `media:` reference would have
 * reached the DOM as `src="media:org:…/…"` — a URL the browser cannot fetch and
 * whose scheme is deliberately unregistered, so it fails loudly rather than
 * silently. That is what stopped `coverImage` and `logoUrl` being converted
 * with the rest of the org's media in AGL-1406.
 *
 * Site-RELATIVE is the right answer on this surface, unlike the manifest icon
 * next door: these are images on a page a browser already has open.
 */

import { act, render } from '@testing-library/react'
import type { ReactElement } from 'react'
import CatchAllPage from '../app/[host]/[[...slug]]/catch-all-client'

/**
 * The plugin gate loads nothing. Both `<img>` sinks below are plain JSX in
 * `catch-all-client.tsx` and every render here passes `nodes` null or `{}`,
 * so no canvas node — and therefore no plugin-registered component — can
 * contribute a `src`. See the stub for the measurement and for why the
 * suspension these specs flush is still the real one.
 */
jest.mock('../utils/site-plugin-loader', () =>
  require('./site-plugin-loader-empty-manifest'),
)

/**
 * Renders and lets the page settle.
 *
 * `CatchAllPage` opens with `use(sitePluginLoader.ensure(…))`, so the first
 * render of a fresh module registry SUSPENDS and commits an empty container —
 * which would read here as "the image was dropped" and quietly pass every
 * negative assertion while failing every positive one. Flushing inside `act`
 * makes the result the real one.
 */
const renderSettled = async (element: ReactElement) => {
  let container!: HTMLElement
  await act(async () => {
    container = render(element).container
  })
  return container
}

const HOST_ID = 'DXnRbPH4CQ'
const REF = 'media:org:jWmGooWE3L/4GF1hRJBUp'
const RESOLVED = '/api/media/cdn/org:jWmGooWE3L:DXnRbPH4CQ/4GF1hRJBUp'

const RAW_STORAGE_URL =
  'https://firebasestorage.googleapis.com/v0/b/aglyn-main.appspot.com/' +
  'o/orgs%2FjWmGooWE3L%2Fmedia%2Fbrand%2Fcover?alt=media&token=abc'
const LEGACY_CDN_PATH = '/api/media/cdn/org:jWmGooWE3L/4GF1hRJBUp'
const EXTERNAL_URL = 'https://images.example.com/photo.jpg?v=2'

/** Every `src` the render produced, in order. */
const sources = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('img')).map((img) =>
    img.getAttribute('src'),
  )

describe('legacy collection surface: the entry cover (AGL-1407)', () => {
  const renderCover = async (coverImage: string) => {
    const container = await renderSettled(
      <CatchAllPage
        data={{ host: { $id: HOST_ID } as never }}
        nodes={null}
        content={
          {
            collection: { $id: 'c1', slug: 'blog', displayName: 'Blog' },
            entries: [],
            entry: { $id: 'e1', title: 'Hello', body: '', coverImage },
          } as never
        }
      />,
    )
    // The article really rendered — so an empty `img` list below means the
    // image was dropped, not that the whole page failed to commit.
    expect(container.querySelector('h1')?.textContent).toBe('Hello')
    return container
  }

  it('resolves a media reference to the CDN path for THIS site', async () => {
    // Pre-fix: `src="media:org:jWmGooWE3L/4GF1hRJBUp"`.
    expect(sources(await renderCover(REF))).toEqual([RESOLVED])
  })

  describe('the legacy stored forms are passed through untouched', () => {
    it('a raw firebasestorage download URL', async () => {
      expect(sources(await renderCover(RAW_STORAGE_URL))).toEqual([
        RAW_STORAGE_URL,
      ])
    })

    it('the AGL-175 relative CDN path', async () => {
      expect(sources(await renderCover(LEGACY_CDN_PATH))).toEqual([
        LEGACY_CDN_PATH,
      ])
    })

    it('an external URL the author typed themselves', async () => {
      expect(sources(await renderCover(EXTERNAL_URL))).toEqual([EXTERNAL_URL])
    })
  })

  it('drops the image for a malformed reference instead of emitting it', async () => {
    // There is no correct URL to emit, and `src="media:junk"` is a console
    // error nobody reads.
    expect(sources(await renderCover('media:junk'))).toEqual([])
  })
})

describe('white-label badge: the brand logo (AGL-1407)', () => {
  const renderBadge = async (logoUrl: string) => {
    const container = await renderSettled(
      <CatchAllPage
        data={{ host: { $id: HOST_ID } as never }}
        nodes={{}}
        showBranding
        branding={
          {
            productName: 'Acme',
            logoUrl,
            supportUrl: 'https://acme.test/support',
          } as never
        }
      />,
    )
    // The badge itself rendered; only its logo is under test.
    expect(container.textContent).toContain('Made with Acme')
    return container
  }

  it('resolves a media reference', async () => {
    expect(sources(await renderBadge(REF))).toEqual([RESOLVED])
  })

  it('still renders a plain URL the agency typed into the branding card', async () => {
    expect(sources(await renderBadge(EXTERNAL_URL))).toEqual([EXTERNAL_URL])
  })

  it('still renders the AGL-175 relative CDN path', async () => {
    expect(sources(await renderBadge(LEGACY_CDN_PATH))).toEqual([
      LEGACY_CDN_PATH,
    ])
  })

  /**
   * With no home URL the badge is a LABEL, not a link (AGL-2428).
   *
   * `homeUrl` resolves to null for a white-label org that left its URL blank,
   * and an `<a>` with no href is still announced as a link and still takes
   * focus — a promise of a destination that does not exist. Substituting
   * Aglyn's own page instead is the leak the issue is about.
   */
  const renderBadgeWith = async (homeUrl: string | null) =>
    renderSettled(
      <CatchAllPage
        data={{ host: { $id: HOST_ID } as never }}
        nodes={{}}
        showBranding
        branding={{ productName: 'Acme', logoUrl: null, homeUrl } as never}
      />,
    )

  /** The badge anchor specifically — the page also carries a Report abuse link. */
  const badgeAnchors = (container: HTMLElement) =>
    [...container.querySelectorAll('a')].filter((anchor) =>
      (anchor.textContent ?? '').includes('Made with'),
    )

  it('renders NO anchor when the org has no home URL', async () => {
    const container = await renderBadgeWith(null)
    expect(container.textContent).toContain('Made with Acme')
    expect(badgeAnchors(container)).toHaveLength(0)
    expect(container.innerHTML).not.toContain('aglyn.com')
  })

  it('THE CONTROL: it IS an anchor when there is somewhere to send them', async () => {
    // Without this the case above is satisfied by a badge that stopped
    // linking for everybody, which would take the link off Aglyn's own
    // customers too.
    const container = await renderBadgeWith('https://acme.test')
    const anchors = badgeAnchors(container)
    expect(anchors).toHaveLength(1)
    expect(anchors[0].getAttribute('href')).toBe('https://acme.test')
  })

  /**
   * THE REPORTED BUG. The badge linked to the brand's SUPPORT url, and on the
   * Aglyn deployment `PLATFORM_SUPPORT_URL` falls through to
   * `mailto:` + the operator support address — so "Made with Aglyn" on every
   * free customer's site opened the visitor's mail client instead of a web
   * page. `homeUrl` is a separate field precisely so a support address can
   * never reach this anchor again.
   */
  it('NEVER links a mailto:, even when the brand support URL is one', async () => {
    const container = await renderSettled(
      <CatchAllPage
        data={{ host: { $id: HOST_ID } as never }}
        nodes={{}}
        showBranding
        branding={
          {
            productName: 'Acme',
            logoUrl: null,
            supportUrl: 'mailto:support@acme.test',
            homeUrl: 'https://acme.test',
          } as never
        }
      />,
    )
    const anchors = badgeAnchors(container)
    expect(anchors).toHaveLength(1)
    expect(anchors[0].getAttribute('href')).toBe('https://acme.test')
    expect(container.innerHTML).not.toContain('mailto:')
  })
})
