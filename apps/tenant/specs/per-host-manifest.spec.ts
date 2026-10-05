/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom.
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
 * AGL-1252: a customer installs THEIR site, not ours.
 *
 * One codebase serves every customer's site, so the failure this guards
 * against is not "the manifest is missing" — it is a manifest that installs
 * with **Aglyn's** name, colour and icon on someone else's home screen. That
 * is worse than not being installable, because it reads as a bug the customer
 * cannot fix.
 *
 * So the load-bearing assertion is that two different hosts produce two
 * different manifests, and the second is that a site with nothing configured
 * produces something neutral rather than something borrowed.
 */

const mockGetHost = jest.fn()
jest.mock('../utils/get-host', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockGetHost(...args),
}))

jest.mock('@aglyn/aglyn/app-utils/site-theme', () => ({
  __esModule: true,
  resolveSiteTheme: (site: { theme?: unknown }) => site?.theme,
}))

/**
 * The icon source's media document (AGL-3484): its type and content hash.
 * None read by default — the shape a failed read has, which derives the set
 * unversioned — and set per case where the version or the type matters.
 */
const mockIconFacts = jest.fn()
jest.mock('@aglyn/tenant-runtime/get-site-icon-facts', () => ({
  __esModule: true,
  getSiteIconFacts: (...args: unknown[]) => mockIconFacts(...args),
}))

import { GET } from '../app/api/manifest/route'

/**
 * The FILE an icon entry is drawn from: a derived icon is its source's URL
 * plus an `?icon=` query (AGL-3484), and a pass-through entry is the source.
 */
const sourceOf = (src: string | undefined) =>
  src?.replace(/[?&]icon=.*$/, '')

beforeEach(() => mockIconFacts.mockResolvedValue(new Map()))

const call = async (host: string | null) =>
  GET(
    new Request('https://northwind-coffee.aglyn.app/api/manifest', {
      headers: host ? { 'x-aglyn-tenant-host': host } : {},
    }),
  )

const manifestFor = async (host: string | null) => {
  const response = await call(host)
  return {
    response,
    body: await response.json(),
  }
}

describe('per-host web app manifest (AGL-1252)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('uses the SITE name, colour and icon', async () => {
    mockGetHost.mockResolvedValue({
      host: {
        displayName: 'Northwind Coffee',
        logoUrl: 'https://cdn.test/northwind.png',
        theme: {
          colorSchemes: {
            light: {
              primary: { main: '#6f4e37' },
              background: { default: '#fff8f0' },
            },
          },
        },
      },
    })
    const { response, body } = await manifestFor('northwind-coffee')
    expect(response.headers.get('content-type')).toBe(
      'application/manifest+json',
    )
    expect(body.name).toBe('Northwind Coffee')
    expect(body.theme_color).toBe('#6f4e37')
    expect(body.background_color).toBe('#fff8f0')
    expect(sourceOf(body.icons?.[0]?.src)).toBe('https://cdn.test/northwind.png')
    // Nothing of ours may appear.
    expect(JSON.stringify(body)).not.toMatch(/aglyn/i)
  })

  it('gives two different hosts two different manifests', async () => {
    // The whole point of the issue, stated as one assertion.
    mockGetHost.mockResolvedValueOnce({
      host: { displayName: 'Northwind Coffee' },
    })
    const first = (await manifestFor('northwind-coffee')).body
    mockGetHost.mockResolvedValueOnce({ host: { displayName: 'Acme Tools' } })
    const second = (await manifestFor('acme-tools')).body
    expect(first.name).toBe('Northwind Coffee')
    expect(second.name).toBe('Acme Tools')
    expect(first.name).not.toBe(second.name)
  })

  it('omits icons entirely when the site has no logo', async () => {
    // A defined empty case, per AGL-1022's rule. An entry pointing at a
    // missing image installs a BROKEN tile — the browser falls back to a page
    // screenshot only if there is no `icons` array at all.
    mockGetHost.mockResolvedValue({ host: { displayName: 'No Logo Co' } })
    const { body } = await manifestFor('no-logo')
    expect(body).not.toHaveProperty('icons')
    expect(body.name).toBe('No Logo Co')
  })

  it('falls back to neutral colours, never to ours', async () => {
    mockGetHost.mockResolvedValue({ host: { displayName: 'Plain Site' } })
    const { body } = await manifestFor('plain')
    // Black/white, not an Aglyn brand colour.
    expect(body.theme_color).toBe('#000000')
    expect(body.background_color).toBe('#ffffff')
  })

  it('reads the LIGHT scheme, which is what paints the splash screen', async () => {
    // The OS shows these before the page renders, so `prefers-color-scheme`
    // has not applied yet. Picking dark here would flash the wrong colour on
    // every install.
    mockGetHost.mockResolvedValue({
      host: {
        displayName: 'Two Schemes',
        theme: {
          colorSchemes: {
            light: { primary: { main: '#ffffff' } },
            dark: { primary: { main: '#111111' } },
          },
        },
      },
    })
    const { body } = await manifestFor('two-schemes')
    expect(body.theme_color).toBe('#ffffff')
  })

  it('still returns a usable manifest for an unknown host', async () => {
    // Never a 500: a broken manifest link is a console error on every page of
    // a customer's site.
    mockGetHost.mockResolvedValue(null)
    const { response, body } = await manifestFor('nope')
    expect(response.status).toBe(200)
    expect(body.name).toBe('Site')
    expect(body).not.toHaveProperty('icons')
  })

  it('truncates short_name rather than letting the OS cut it mid-word', async () => {
    mockGetHost.mockResolvedValue({
      host: { displayName: 'A Very Long Coffee Company Name' },
    })
    const { body } = await manifestFor('long')
    expect(body.name).toBe('A Very Long Coffee Company Name')
    expect(body.short_name.length).toBeLessThanOrEqual(12)
  })
})

/**
 * The icon `src` across the three stored generations of `logoUrl` (AGL-1407).
 *
 * This call site is the one that needs an ABSOLUTE URL. Nobody fetches a
 * manifest icon from the page that linked the manifest — the install prompt,
 * the OS icon cache and every installability checker fetch it out of band — so
 * `/api/media/cdn/…` yields a manifest that parses, installs, and shows a blank
 * tile. Same defect as AGL-1337's `og:image`, one surface over.
 */
describe('manifest icon media references (AGL-1407)', () => {
  beforeEach(() => jest.clearAllMocks())

  const iconFor = async (host: Record<string, unknown>) => {
    mockGetHost.mockResolvedValue({ host: { displayName: 'Site', ...host } })
    const { body } = await manifestFor('a-site')
    return sourceOf(body.icons?.[0]?.src)
  }

  it('resolves a media reference to an ABSOLUTE CDN URL', async () => {
    // Pre-fix this emitted the literal string `media:org:…/…`, which is not a
    // fetchable URL in any installer.
    expect(
      await iconFor({
        $id: 'DXnRbPH4CQ',
        subdomain: 'northwind-coffee',
        logoUrl: 'media:org:jWmGooWE3L/4GF1hRJBUp',
      }),
    ).toBe(
      'https://northwind-coffee.aglyn.app' +
        '/api/media/cdn/org:jWmGooWE3L:DXnRbPH4CQ/4GF1hRJBUp',
    )
  })

  it('prefers the custom domain the site actually serves on', async () => {
    expect(
      await iconFor({
        $id: 'DXnRbPH4CQ',
        cname: 'northwind.coffee',
        subdomain: 'northwind-coffee',
        logoUrl: 'media:org:jWmGooWE3L/4GF1hRJBUp',
      }),
    ).toBe(
      'https://northwind.coffee' +
        '/api/media/cdn/org:jWmGooWE3L:DXnRbPH4CQ/4GF1hRJBUp',
    )
  })

  it('absolutizes the AGL-175 relative CDN path too', async () => {
    // The generation between the raw URL and the reference. Also unfetchable
    // as stored, for exactly the same reason.
    expect(
      await iconFor({
        subdomain: 'northwind-coffee',
        logoUrl: '/api/media/cdn/org:jWmGooWE3L/4GF1hRJBUp',
      }),
    ).toBe(
      'https://northwind-coffee.aglyn.app' +
        '/api/media/cdn/org:jWmGooWE3L/4GF1hRJBUp',
    )
  })

  describe('the legacy absolute forms are untouched', () => {
    it('a raw firebasestorage download URL, encoding intact', async () => {
      const raw =
        'https://firebasestorage.googleapis.com/v0/b/aglyn-main.appspot.com/' +
        'o/orgs%2FjWmGooWE3L%2Fmedia%2Fbrand%2Flogo?alt=media&token=abc'
      expect(await iconFor({ subdomain: 'northwind-coffee', logoUrl: raw })).toBe(
        raw,
      )
    })

    it("an external URL the author typed, on a site with NO origin", async () => {
      // Absolute already, so it never needed the origin — proof the new
      // origin dependency applies only to the forms that resolve relative.
      expect(await iconFor({ logoUrl: 'https://cdn.example.com/logo.png' })).toBe(
        'https://cdn.example.com/logo.png',
      )
    })
  })

  it('omits icons when a reference cannot be made absolute', async () => {
    // AGL-1022's existing empty-case rule, reached by a new route: with no
    // cname and no subdomain there is no origin to resolve against, and a
    // blank installed tile is worse than falling back to a page screenshot.
    mockGetHost.mockResolvedValue({
      host: { displayName: 'Origin-less', logoUrl: 'media:org:jWmGooWE3L/4GF' },
    })
    const { body } = await manifestFor('no-origin')
    expect(body).not.toHaveProperty('icons')
  })

  it('omits icons for a malformed reference rather than emitting it raw', async () => {
    expect(
      await iconFor({ subdomain: 'northwind-coffee', logoUrl: 'media:junk' }),
    ).toBeUndefined()
  })

  /**
   * The site's own square icon (AGL-2689).
   *
   * `sizes: 'any'` fixed the LIE — a wordmark announced as a 512px square —
   * and could not fix the artwork, because there was no field to put artwork
   * in. `seo.appIcon` is that field, and the assertions here are the two
   * halves of a seam: a site that fills it in installs with it, and a site
   * that has not installs with exactly what it installed with before.
   */
  describe('the square app icon (AGL-2689)', () => {
    it('is preferred over the logo when the site has one', async () => {
      expect(
        await iconFor({
          $id: 'DXnRbPH4CQ',
          subdomain: 'northwind-coffee',
          logoUrl: 'media:org:jWmGooWE3L/wordmark',
          seo: { appIcon: 'media:org:jWmGooWE3L/appicon' },
        }),
      ).toBe(
        'https://northwind-coffee.aglyn.app' +
          '/api/media/cdn/org:jWmGooWE3L:DXnRbPH4CQ/appicon',
      )
    })

    it('falls back to the logo when the field is unset', async () => {
      expect(
        await iconFor({
          subdomain: 'northwind-coffee',
          logoUrl: 'https://cdn.test/northwind.png',
          seo: { title: 'Northwind Coffee' },
        }),
      ).toBe('https://cdn.test/northwind.png')
    })

    it('falls back to the logo when the field was CLEARED', async () => {
      // The picker writes `''` rather than deleting the key, because a merge
      // write ignores an absent field (AGL-1191) — so "removed" has to read
      // as "use the logo again", not as "no icon".
      expect(
        await iconFor({
          subdomain: 'northwind-coffee',
          logoUrl: 'https://cdn.test/northwind.png',
          seo: { appIcon: '' },
        }),
      ).toBe('https://cdn.test/northwind.png')
    })

    it('still declares `any` for a file nothing measured or drew', async () => {
      // A hotlinked icon has no renderer behind it (AGL-2204): no dimensions
      // are stored for it, and nothing draws it at a size, so `any` is the
      // honest answer. A CDN-served one is DRAWN at each size (AGL-3484).
      mockGetHost.mockResolvedValue({
        host: {
          displayName: 'Northwind Coffee',
          seo: { appIcon: 'https://cdn.test/icon-512.png' },
        },
      })
      const { body } = await manifestFor('northwind-coffee')
      expect(body.icons).toEqual([
        { src: 'https://cdn.test/icon-512.png', sizes: 'any', purpose: 'any' },
      ])
    })

    it('installs an app icon on a site with no logo at all', async () => {
      // The empty case is about having NO artwork, not about `logoUrl`
      // specifically — a site whose only mark is a square one must install.
      expect(
        await iconFor({
          subdomain: 'northwind-coffee',
          seo: { appIcon: 'https://cdn.test/icon-512.png' },
        }),
      ).toBe('https://cdn.test/icon-512.png')
    })

    it('omits icons when a site has neither', async () => {
      mockGetHost.mockResolvedValue({
        host: { displayName: 'No Marks Co', seo: { title: 'No Marks Co' } },
      })
      const { body } = await manifestFor('no-marks')
      expect(body).not.toHaveProperty('icons')
    })
  })
})

/**
 * The icon `sizes` declaration must never be a measurement we did not take
 * (AGL-2204) — and since AGL-3484 most of them ARE taken.
 *
 * The route used to emit `sizes: '512x512'` for whatever `logoUrl` was. On
 * `aglyn.com` that is the wordmark lockup — `viewBox "0 0 79 24"`, verified on
 * production as `image/svg+xml`, 6296 bytes, intrinsic 300x91 — i.e. a 3.29:1
 * rectangle declared as a 1:1 square. Installers trust `sizes`; that is what
 * the field is for.
 *
 * A CDN-served source is now DRAWN at every size it declares: the `?icon=`
 * representation center-fits it on a square of exactly that side, so a
 * `192x192` entry is a 192px square by construction, wordmark or not. The
 * rule is therefore that a concrete `WxH` appears only on an entry the
 * renderer draws at that size, and everything else says `any`.
 *
 * {@link expectEverySizeMeasured} is run twice, as before: over the real
 * handler, and over the PRE-FIX manifest, which it must REJECT.
 */
describe('manifest icon sizes are never fabricated (AGL-2204)', () => {
  beforeEach(() => jest.clearAllMocks())

  const CONCRETE = /^(\d+)x(\d+)$/

  const expectEverySizeMeasured = (body: {
    icons?: Array<{ src: string; sizes?: string }>
  }) => {
    for (const icon of body.icons ?? []) {
      const sizes = icon.sizes ?? 'any'
      if (sizes === 'any') continue
      // One concrete square, drawn at exactly that size by the renderer.
      const match = CONCRETE.exec(sizes)
      expect(match).not.toBeNull()
      expect(match?.[1]).toBe(match?.[2])
      expect(icon.src).toMatch(
        new RegExp(`[?&]icon=(png|maskable)-${match?.[1]}(&|$)`),
      )
    }
  }

  /** The real shape of the live `aglyn.com` logo, measured on production. */
  const AGLYN_LOGO = { viewBoxWidth: 79, viewBoxHeight: 24 }

  it('declares only the squares it draws, for the wide wordmark it serves', async () => {
    mockGetHost.mockResolvedValue({
      host: {
        displayName: 'Aglyn Marketing Website',
        $id: 'DXnRbPH4CQ',
        cname: 'aglyn.com',
        logoUrl: 'media:org:jWmGooWE3L:DXnRbPH4CQ/hWwBgGtkiM',
      },
    })
    const { body } = await manifestFor('aglyn-marketing')

    // The asset is emphatically not square, which is what made `512x512` a
    // lie for the ORIGINAL — and why the derived 512 is center-fit instead.
    expect(AGLYN_LOGO.viewBoxWidth).not.toBe(AGLYN_LOGO.viewBoxHeight)

    expect(body.icons.length).toBeGreaterThan(1)
    expectEverySizeMeasured(body)
  })

  it('never fabricates a size for ANY logo shape', async () => {
    // Every stored generation of `logoUrl`.
    const logos = [
      'media:org:jWmGooWE3L:DXnRbPH4CQ/hWwBgGtkiM',
      '/api/media/cdn/org:jWmGooWE3L/4GF1hRJBUp',
      'https://cdn.example.com/logo.png',
      'https://cdn.example.com/logo.svg',
    ]
    for (const logoUrl of logos) {
      mockGetHost.mockResolvedValue({
        host: { displayName: 'A Site', $id: 'DXnRbPH4CQ', cname: 'a.test', logoUrl },
      })
      const { body } = await manifestFor('a-site')
      expectEverySizeMeasured(body)
    }
  })

  it('the empty case still has nothing to over-declare', async () => {
    mockGetHost.mockResolvedValue({ host: { displayName: 'No Logo Co' } })
    const { body } = await manifestFor('no-logo')
    expect(body).not.toHaveProperty('icons')
    expectEverySizeMeasured(body)
  })

  /**
   * THE NEGATIVE CONTROL — proves the assertions above can fail.
   *
   * This is the manifest this route emitted before AGL-2204, verbatim off
   * production: the ORIGINAL file, declared as a square it never was.
   */
  it('REJECTS the pre-fix manifest — proof the guard is not a tautology', () => {
    const preFix = {
      name: 'Aglyn Marketing Website',
      icons: [
        {
          src: 'https://aglyn.com/api/media/cdn/org:jWmGooWE3L:DXnRbPH4CQ/hWwBgGtkiM',
          purpose: 'any',
          sizes: '512x512',
        },
      ],
    }
    expect(() => expectEverySizeMeasured(preFix)).toThrow()
  })

  it('REJECTS a size list, and a size the src does not draw', () => {
    expect(() =>
      expectEverySizeMeasured({
        icons: [{ src: 'https://a.test/x?icon=png-192', sizes: 'any 192x192' }],
      }),
    ).toThrow()
    expect(() =>
      expectEverySizeMeasured({
        icons: [{ src: 'https://a.test/x?icon=png-192', sizes: '512x512' }],
      }),
    ).toThrow()
  })
})

/**
 * The manifest a link unfurler reads (AGL-3382). Measured on production for
 * `ready-to-roll.aglyn.app`: `short_name` was `Ready To Rol`, cut mid-word by
 * this route itself, and a site whose only mark was a favicon installed with
 * no icon at all.
 */
describe('link-preview manifest fields (AGL-3382)', () => {
  beforeEach(() => jest.clearAllMocks())

  const SITE = {
    $id: 'ZG22ootbN-',
    displayName: 'Ready To Roll',
    subdomain: 'ready-to-roll',
  }
  const ORIGIN = 'https://ready-to-roll.aglyn.app/api/media/cdn/'

  it('cuts short_name at a word, never inside one', async () => {
    mockGetHost.mockResolvedValue({ host: SITE })
    const { body } = await manifestFor('ready-to-roll')
    expect(body.short_name).toBe('Ready To')
  })

  it('draws the whole set from the app icon when the site has one', async () => {
    mockGetHost.mockResolvedValue({
      host: {
        ...SITE,
        seo: {
          appIcon: 'media:org:Ok7uFGMCC-/mKeulwfbL0',
          favicon: 'media:org:Ok7uFGMCC-/o0-uaWHCNA',
        },
      },
    })
    const { body } = await manifestFor('ready-to-roll')
    const sources = new Set(
      body.icons.map((icon: { src: string }) => sourceOf(icon.src)),
    )
    expect([...sources]).toEqual([`${ORIGIN}org:Ok7uFGMCC-:ZG22ootbN-/mKeulwfbL0`])
  })

  it('installs a favicon-only site with its favicon', async () => {
    mockGetHost.mockResolvedValue({
      host: { ...SITE, seo: { favicon: 'media:org:Ok7uFGMCC-/o0-uaWHCNA' } },
    })
    const { body } = await manifestFor('ready-to-roll')
    const sources = new Set(
      body.icons.map((icon: { src: string }) => sourceOf(icon.src)),
    )
    expect([...sources]).toEqual([`${ORIGIN}org:Ok7uFGMCC-:ZG22ootbN-/o0-uaWHCNA`])
  })

  it('still lists no icons, and nothing of ours, for a site with neither', async () => {
    mockGetHost.mockResolvedValue({ host: SITE })
    const { body } = await manifestFor('ready-to-roll')
    expect(body).not.toHaveProperty('icons')
    expect(JSON.stringify(body)).not.toMatch(/_static|brand/)
  })
})

/**
 * The whole manifest, derived (AGL-3484). Nothing in it is entered by hand: a
 * customer who never thinks about installability gets a complete manifest and
 * every icon size from what they already filled in.
 */
describe('the derived manifest (AGL-3484)', () => {
  beforeEach(() => jest.clearAllMocks())

  const SITE = {
    $id: 'ZG22ootbN-',
    displayName: 'EDR Construction',
    subdomain: 'edr-construction',
    seo: {
      title: 'EDR Construction Services',
      description: 'Commercial and residential builds in Austin.',
      favicon: 'media:org:Ok7uFGMCC-/o0-uaWHCNA',
    },
    defaultLocale: 'es',
    theme: {
      colorSchemes: {
        light: {
          primary: { main: '#c2410c' },
          background: { default: '#FAFAF9' },
        },
      },
    },
  }
  const SRC =
    'https://edr-construction.aglyn.app/api/media/cdn/org:Ok7uFGMCC-:ZG22ootbN-/o0-uaWHCNA'

  it('derives every field from the site’s settings', async () => {
    mockGetHost.mockResolvedValue({ host: SITE })
    const { body } = await manifestFor('edr')
    expect(body).toMatchObject({
      name: 'EDR Construction Services',
      short_name: 'EDR', // ≤12 at a word boundary
      description: 'Commercial and residential builds in Austin.',
      lang: 'es',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      theme_color: '#c2410c',
      background_color: '#fafaf9',
    })
  })

  it('names the site, then its display name, and says English by default', async () => {
    mockGetHost.mockResolvedValue({
      host: { displayName: 'Acme Tools', name: 'acme' },
    })
    const { body } = await manifestFor('acme')
    expect(body.name).toBe('Acme Tools')
    expect(body.lang).toBe('en')
    expect(body).not.toHaveProperty('description')
  })

  it('lists ten `any` sizes and two maskable ones, versioned by the content hash', async () => {
    mockGetHost.mockResolvedValue({ host: SITE })
    mockIconFacts.mockResolvedValue(
      new Map([
        [
          '/api/media/cdn/org:Ok7uFGMCC-:ZG22ootbN-/o0-uaWHCNA',
          { contentType: 'image/png', contentHash: 'h4sh' },
        ],
      ]),
    )
    const { body } = await manifestFor('edr')
    expect(body.icons).toEqual([
      ...[48, 72, 96, 128, 144, 152, 192, 256, 384, 512].map((size) => ({
        src: `${SRC}?icon=png-${size}&v=h4sh`,
        sizes: `${size}x${size}`,
        type: 'image/png',
        purpose: 'any',
      })),
      ...[192, 512].map((size) => ({
        // The maskable plate is the site's own light background.
        src: `${SRC}?icon=maskable-${size}&bg=fafaf9&v=h4sh`,
        sizes: `${size}x${size}`,
        type: 'image/png',
        purpose: 'maskable',
      })),
    ])
  })

  it('passes an SVG source through as `sizes: "any"` after the drawn set', async () => {
    mockGetHost.mockResolvedValue({ host: SITE })
    mockIconFacts.mockResolvedValue(
      new Map([
        [
          '/api/media/cdn/org:Ok7uFGMCC-:ZG22ootbN-/o0-uaWHCNA',
          { contentType: 'image/svg+xml', contentHash: 'h4sh' },
        ],
      ]),
    )
    const { body } = await manifestFor('edr')
    expect(body.icons.at(-1)).toEqual({
      src: SRC,
      sizes: 'any',
      type: 'image/svg+xml',
      purpose: 'any',
    })
    expect(body.icons).toHaveLength(13)
  })

  it('reads the facts of the one source the set is drawn from', async () => {
    mockGetHost.mockResolvedValue({ host: SITE })
    await manifestFor('edr')
    expect(mockIconFacts).toHaveBeenCalledWith({
      hostId: 'ZG22ootbN-',
      srcs: ['/api/media/cdn/org:Ok7uFGMCC-:ZG22ootbN-/o0-uaWHCNA'],
    })
  })

  it('falls back from app icon to favicon to logo', async () => {
    mockGetHost.mockResolvedValue({
      host: {
        ...SITE,
        logoUrl: 'media:org:Ok7uFGMCC-/logo',
        seo: { appIcon: '', favicon: '' },
      },
    })
    const { body } = await manifestFor('edr')
    expect(sourceOf(body.icons[0].src)).toBe(
      'https://edr-construction.aglyn.app/api/media/cdn/org:Ok7uFGMCC-:ZG22ootbN-/logo',
    )
  })
})
