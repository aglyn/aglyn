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

jest.mock('@aglyn/aglyn/app-utils/marketplace-theme', () => ({
  __esModule: true,
  resolveSiteTheme: (site: { theme?: unknown }) => site?.theme,
}))

import { GET } from '../app/api/manifest/route'

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
    expect(body.icons?.[0]?.src).toBe('https://cdn.test/northwind.png')
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
    return body.icons?.[0]?.src
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
})
