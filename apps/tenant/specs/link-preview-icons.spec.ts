/**
 * @jest-environment node
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
 * A customer's link previews as THEIR site, never as Aglyn (AGL-3382).
 *
 * Measured on production before the fix: `ready-to-roll.aglyn.app` emitted no
 * `apple-touch-icon` link, `/apple-touch-icon.png` was a 404, and
 * `/favicon.ico` answered with Aglyn's own nine-size icon from
 * `apps/tenant/public`. iMessage and Safari fall back to exactly those two
 * paths, so every customer's link unfurled as an Aglyn-purple Aglyn logo.
 *
 * Four sites carry the assertions, because the failure has four shapes: a
 * site with an app icon, one with only a favicon, one with neither — where
 * the only acceptable answer is nobody's icon, not ours — and the operator's
 * own marketing host, which is the one place our icon is correct.
 */

import { existsSync } from 'fs'
import { resolve } from 'path'

const mockGetHost = jest.fn()
jest.mock('../utils/get-host', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockGetHost(...args),
}))

const mockOrg = jest.fn()
jest.mock('../utils/get-org-billing', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockOrg(...args),
}))

const mockGetSiteLockdown = jest.fn()
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  getSiteLockdown: (...args: unknown[]) => mockGetSiteLockdown(...args),
}))

const mockIconFacts = jest.fn()
jest.mock('@aglyn/tenant-runtime/get-site-icon-facts', () => ({
  __esModule: true,
  getSiteIconFacts: (...args: unknown[]) => mockIconFacts(...args),
}))

import { NextRequest } from 'next/server'
import { GET } from '../app/api/site-icon/route'
import { config, middleware } from '../middleware'
import {
  manifestShortName,
  PLATFORM_ICON_PATHS,
  siteAppleTouchIconSrc,
  siteIconAnswer,
  siteThemeColorMeta,
} from '../utils/site-icons'

const HOST_ID = 'ZG22ootbN-'

/** The four sites. `$id` qualifies each `media:` scope, as in production. */
const WITH_APP_ICON = {
  $id: HOST_ID,
  subdomain: 'ready-to-roll',
  seo: {
    favicon: 'media:org:Ok7uFGMCC-/o0-uaWHCNA',
    appIcon: 'media:org:Ok7uFGMCC-/mKeulwfbL0',
  },
}
const FAVICON_ONLY = {
  $id: HOST_ID,
  subdomain: 'ready-to-roll',
  seo: { favicon: 'media:org:Ok7uFGMCC-/o0-uaWHCNA' },
}
const NEITHER = { $id: HOST_ID, subdomain: 'plain', seo: {} }

const APP_ICON_SRC = `/api/media/cdn/org:Ok7uFGMCC-:${HOST_ID}/mKeulwfbL0`
const FAVICON_SRC = `/api/media/cdn/org:Ok7uFGMCC-:${HOST_ID}/o0-uaWHCNA`
/**
 * Where the two origin paths lead for a CDN-served source (AGL-3484): a
 * multi-size ICO drawn from the favicon, and the 180px touch icon flattened
 * onto the site's background — white for a site with no theme.
 */
const FAVICON_ICO = `${FAVICON_SRC}?icon=ico`
const APP_TOUCH_ICON = `${APP_ICON_SRC}?icon=flat-180&bg=ffffff`
const FAVICON_TOUCH_ICON = `${FAVICON_SRC}?icon=flat-180&bg=ffffff`

/** Anything that would be our mark on a customer's host. */
const PLATFORM_ICON = /_static|brand|aglyn/i

describe('the touch icon a site advertises', () => {
  it('is the app icon when the site has one', () => {
    expect(siteAppleTouchIconSrc(WITH_APP_ICON)).toBe(APP_ICON_SRC)
  })

  it('falls back to the favicon — still the site’s own mark', () => {
    expect(siteAppleTouchIconSrc(FAVICON_ONLY)).toBe(FAVICON_SRC)
  })

  it('is nothing at all when the site has neither', () => {
    expect(siteAppleTouchIconSrc(NEITHER)).toBeUndefined()
    // A cleared picker stores `''`, which must read as unset rather than as
    // an empty href that requests the page itself.
    expect(
      siteAppleTouchIconSrc({
        $id: HOST_ID,
        seo: { appIcon: '', favicon: '' },
      }),
    ).toBeUndefined()
  })
})

describe('/favicon.ico and /apple-touch-icon.png, decided', () => {
  const answer = (
    kind: 'favicon' | 'apple-touch-icon',
    host: Record<string, unknown> | null,
    platformBrand = false,
    brandFavicon?: string,
    attribution = false,
  ) => siteIconAnswer({ kind, platformBrand, host, brandFavicon, attribution })

  it('a site with an app icon: both paths lead to the site', () => {
    expect(answer('apple-touch-icon', WITH_APP_ICON)).toEqual({
      kind: 'redirect',
      location: APP_TOUCH_ICON,
    })
    expect(answer('favicon', WITH_APP_ICON)).toEqual({
      kind: 'redirect',
      location: FAVICON_ICO,
    })
  })

  it('a site with only a favicon: both paths lead to the favicon', () => {
    expect(answer('apple-touch-icon', FAVICON_ONLY)).toEqual({
      kind: 'redirect',
      location: FAVICON_TOUCH_ICON,
    })
    expect(answer('favicon', FAVICON_ONLY)).toEqual({
      kind: 'redirect',
      location: FAVICON_ICO,
    })
  })

  it('versions both by the source’s content hash, on the site’s background (AGL-3484)', () => {
    const facts = new Map([
      [FAVICON_SRC, { contentType: 'image/png', contentHash: 'fav1' }],
      [APP_ICON_SRC, { contentType: 'image/png', contentHash: 'app1' }],
    ])
    const versioned = (kind: 'favicon' | 'apple-touch-icon') =>
      siteIconAnswer({
        kind,
        platformBrand: false,
        host: WITH_APP_ICON,
        facts,
        background: '0a0b0c',
      })
    expect(versioned('favicon')).toEqual({
      kind: 'redirect',
      location: `${FAVICON_SRC}?icon=ico&v=fav1`,
    })
    expect(versioned('apple-touch-icon')).toEqual({
      kind: 'redirect',
      location: `${APP_ICON_SRC}?icon=flat-180&bg=0a0b0c&v=app1`,
    })
  })

  it('leads to an uploaded .ico as it is — nothing can draw from it', () => {
    expect(
      siteIconAnswer({
        kind: 'favicon',
        platformBrand: false,
        host: FAVICON_ONLY,
        facts: new Map([[FAVICON_SRC, { contentType: 'image/x-icon' }]]),
      }),
    ).toEqual({ kind: 'redirect', location: FAVICON_SRC })
  })

  it('a site with neither and no attribution gets a blank favicon and no touch icon', () => {
    expect(answer('favicon', NEITHER)).toEqual({ kind: 'blank' })
    expect(answer('apple-touch-icon', NEITHER)).toEqual({ kind: 'not-found' })
    // An unknown host is the same case, not a reason to fall back to ours.
    expect(answer('favicon', null)).toEqual({ kind: 'blank' })
  })

  it('a site with neither on an attributed plan keeps our favicon, as the layout does (AGL-2183)', () => {
    expect(answer('favicon', NEITHER, false, undefined, true)).toEqual({
      kind: 'redirect',
      location: PLATFORM_ICON_PATHS.favicon,
    })
    // The touch icon is what an unfurler shows, and it is never ours on a
    // customer host — attribution is the tab's, not the preview card's.
    expect(answer('apple-touch-icon', NEITHER, false, undefined, true)).toEqual(
      { kind: 'not-found' },
    )
  })

  it('a site’s own icon wins over attribution', () => {
    expect(answer('favicon', FAVICON_ONLY, false, undefined, true)).toEqual({
      kind: 'redirect',
      location: FAVICON_ICO,
    })
  })

  it('an org’s white-label mark stands in for a missing favicon', () => {
    expect(
      answer('favicon', NEITHER, false, 'https://cdn.example/agency.ico'),
    ).toEqual({ kind: 'redirect', location: 'https://cdn.example/agency.ico' })
  })

  it('the platform’s own marketing host keeps the platform icon', () => {
    expect(answer('favicon', null, true)).toEqual({
      kind: 'redirect',
      location: PLATFORM_ICON_PATHS.favicon,
    })
    expect(answer('apple-touch-icon', null, true)).toEqual({
      kind: 'redirect',
      location: PLATFORM_ICON_PATHS['apple-touch-icon'],
    })
  })

  it('the platform icons it points at exist, and the root favicon does not', () => {
    // The redirect is only as good as its target. And the root file is GONE on
    // purpose: with it back in `public/`, any path the middleware does not
    // rewrite would serve our mark on a customer's host again.
    const publicDir = resolve(__dirname, '../public')
    for (const path of Object.values(PLATFORM_ICON_PATHS)) {
      expect(existsSync(`${publicDir}${path}`)).toBe(true)
    }
    expect(existsSync(`${publicDir}/favicon.ico`)).toBe(false)
  })
})

describe('the /api/site-icon route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetSiteLockdown.mockResolvedValue(null)
    mockOrg.mockResolvedValue({ org: { $id: 'org-1', plan: 'free' } })
    mockIconFacts.mockResolvedValue(new Map())
  })

  const call = (host: string, icon: 'favicon' | 'apple-touch-icon') =>
    GET(
      new Request('https://ready-to-roll.aglyn.app/favicon.ico', {
        headers: { 'x-aglyn-tenant-host': host, 'x-aglyn-site-icon': icon },
      }),
    )

  it('redirects to the site’s app icon, relative to the domain asked on', async () => {
    mockGetHost.mockResolvedValue({ host: WITH_APP_ICON })
    const response = await call('ready-to-roll', 'apple-touch-icon')
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe(APP_TOUCH_ICON)
  })

  it('redirects /favicon.ico to a favicon-only site’s favicon', async () => {
    mockGetHost.mockResolvedValue({ host: FAVICON_ONLY })
    const favicon = await call('ready-to-roll', 'favicon')
    expect(favicon.status).toBe(302)
    expect(favicon.headers.get('Location')).toBe(FAVICON_ICO)
    const touch = await call('ready-to-roll', 'apple-touch-icon')
    expect(touch.headers.get('Location')).toBe(FAVICON_TOUCH_ICON)
  })

  it('reads the facts of the one source it is about to name (AGL-3484)', async () => {
    mockGetHost.mockResolvedValue({ host: WITH_APP_ICON })
    mockIconFacts.mockResolvedValue(
      new Map([[FAVICON_SRC, { contentType: 'image/png', contentHash: 'fav1' }]]),
    )
    const favicon = await call('ready-to-roll', 'favicon')
    expect(mockIconFacts).toHaveBeenCalledWith({
      hostId: HOST_ID,
      srcs: [FAVICON_SRC],
    })
    expect(favicon.headers.get('Location')).toBe(`${FAVICON_SRC}?icon=ico&v=fav1`)
  })

  it('keeps our favicon, and 404s the touch icon, for a free site with neither (AGL-2183)', async () => {
    mockGetHost.mockResolvedValue({ host: NEITHER })
    const favicon = await call('plain', 'favicon')
    expect(favicon.status).toBe(302)
    expect(favicon.headers.get('Location')).toBe(PLATFORM_ICON_PATHS.favicon)
    const touch = await call('plain', 'apple-touch-icon')
    expect(touch.status).toBe(404)
    expect(touch.headers.get('Location')).toBeNull()
  })

  it('serves a transparent ICO when the org cannot be read — never ours by accident', async () => {
    mockGetHost.mockResolvedValue({ host: NEITHER })
    mockOrg.mockResolvedValue({ org: null })
    const favicon = await call('plain', 'favicon')
    expect(favicon.status).toBe(200)
    expect(favicon.headers.get('Location')).toBeNull()
  })

  it('serves a transparent ICO, and a 404 touch icon, for a white-label site with neither', async () => {
    mockGetHost.mockResolvedValue({ host: NEITHER })
    mockOrg.mockResolvedValue({ org: { $id: 'org-agency', plan: 'agency' } })
    const favicon = await call('plain', 'favicon')
    expect(favicon.status).toBe(200)
    expect(favicon.headers.get('Content-Type')).toBe('image/x-icon')
    expect(favicon.headers.get('Location')).toBeNull()
    const bytes = new Uint8Array(await favicon.arrayBuffer())
    // An ICO header with ONE image — Aglyn's file carries nine.
    expect(Array.from(bytes.slice(0, 6))).toEqual([0, 0, 1, 0, 1, 0])
    const touch = await call('plain', 'apple-touch-icon')
    expect(touch.status).toBe(404)
    expect(touch.headers.get('Location')).toBeNull()
  })

  it('keeps the platform icon on the operator’s own marketing host, without a read', async () => {
    const favicon = await call('cname--aglyn.com', 'favicon')
    expect(favicon.status).toBe(302)
    expect(favicon.headers.get('Location')).toBe(PLATFORM_ICON_PATHS.favicon)
    const touch = await call('cname--aglyn.com', 'apple-touch-icon')
    expect(touch.headers.get('Location')).toBe(
      PLATFORM_ICON_PATHS['apple-touch-icon'],
    )
    expect(mockGetHost).not.toHaveBeenCalled()
  })

  it('never redirects a customer host to the platform icon', async () => {
    // The whole issue as one sweep: a customer site with its own icon never
    // previews as ours, and no customer site's TOUCH icon — the one an
    // unfurler shows — is ever ours. (An icon-less free site's tab favicon is
    // ours by design, AGL-2183, and is covered above.)
    for (const host of [WITH_APP_ICON, FAVICON_ONLY, NEITHER]) {
      mockGetHost.mockResolvedValue({ host })
      const icons =
        host === NEITHER
          ? (['apple-touch-icon'] as const)
          : (['favicon', 'apple-touch-icon'] as const)
      for (const icon of icons) {
        const location = (await call('customer', icon)).headers.get('Location')
        expect(location ?? '').not.toMatch(PLATFORM_ICON)
      }
    }
  })

  it('answers a locked site with nothing, uncached', async () => {
    mockGetHost.mockResolvedValue({ host: WITH_APP_ICON })
    mockGetSiteLockdown.mockResolvedValue({ mode: 'full' })
    const response = await call('ready-to-roll', 'favicon')
    expect(response.status).toBe(404)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})

describe('<meta name="theme-color">, from the manifest’s own read', () => {
  it('one untargeted tag for a light-only site', () => {
    expect(
      siteThemeColorMeta({
        colorSchemes: { light: { primary: { main: '#12437f' } } },
      }),
    ).toEqual([{ content: '#12437f' }])
  })

  it('a tag per scheme when the site authored a dark primary', () => {
    expect(
      siteThemeColorMeta({
        colorSchemes: {
          light: { primary: { main: '#12437f' } },
          dark: { primary: { main: '#8fb4e6' } },
        },
      }),
    ).toEqual([
      { content: '#12437f', media: '(prefers-color-scheme: light)' },
      { content: '#8fb4e6', media: '(prefers-color-scheme: dark)' },
    ])
  })

  it('ignores the dark primary when the site turned dark off', () => {
    expect(
      siteThemeColorMeta({
        darkScheme: 'off',
        colorSchemes: {
          light: { primary: { main: '#12437f' } },
          dark: { primary: { main: '#8fb4e6' } },
        },
      }),
    ).toEqual([{ content: '#12437f' }])
  })

  it('emits nothing — rather than a borrowed color — for an unthemed site', () => {
    expect(siteThemeColorMeta(undefined)).toEqual([])
    expect(siteThemeColorMeta({ colorSchemes: {} })).toEqual([])
  })
})

describe('the manifest short_name', () => {
  it.each([
    ['Ready To Roll', 'Ready To'],
    ['A Very Long Coffee Company Name', 'A Very Long'],
    ['Northwind', 'Northwind'],
    ['Twelve Chars', 'Twelve Chars'],
    // A first word too long to fit is kept whole, never cut.
    ['Supercalifragilistic Shop', 'Supercalifragilistic'],
  ])('%s → %s', (name, short) => {
    expect(manifestShortName(name)).toBe(short)
  })

  it('never ends mid-word', () => {
    const name = 'Ready To Roll'
    const short = manifestShortName(name)
    expect(name.split(' ')).toEqual(expect.arrayContaining(short.split(' ')))
  })
})

/**
 * The middleware is what puts the route above in front of the two paths.
 * Before this, both were outside its matcher — a `name.ext` first segment —
 * so `/favicon.ico` never reached any per-host code at all.
 */
describe('the middleware rewrites the icon paths per host', () => {
  const originalFetch = global.fetch
  beforeAll(() => {
    // `hostVerdict` asks for the lockdown verdict before any rewrite.
    global.fetch = (async () =>
      new Response(JSON.stringify({ blocked: false, overQuota: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof global.fetch
  })
  afterAll(() => {
    global.fetch = originalFetch
    delete process.env.AGLYN_TENANT_DEMO
  })

  const rewrite = async (pathname: string) => {
    process.env.AGLYN_TENANT_DEMO = 'ready-to-roll'
    const response = (await middleware(
      new NextRequest(
        new Request(`http://localhost:4500${pathname}`, {
          headers: { host: 'localhost:4500' },
        }),
      ),
      {} as never,
    )) as Response
    return {
      to: response.headers.get('x-middleware-rewrite'),
      host: response.headers.get('x-middleware-request-x-aglyn-tenant-host'),
      icon: response.headers.get('x-middleware-request-x-aglyn-site-icon'),
    }
  }

  it.each([
    ['/favicon.ico', 'favicon'],
    ['/apple-touch-icon.png', 'apple-touch-icon'],
    ['/apple-touch-icon-precomposed.png', 'apple-touch-icon'],
  ])('%s → /api/site-icon (%s)', async (pathname, icon) => {
    expect(config.matcher).toContain(pathname)
    const result = await rewrite(pathname)
    expect(result.to).toMatch(/\/api\/site-icon\?/)
    expect(result.host).toBe('ready-to-roll')
    expect(result.icon).toBe(icon)
  })
})
