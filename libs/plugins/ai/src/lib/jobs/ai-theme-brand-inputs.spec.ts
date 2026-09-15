/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom, which has no web streams.
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
 * Brand colors for a theme job (AGL-2938): what the workspace, the site logo
 * and a linked page contribute, and the SSRF guard every page read climbs.
 * The storage and network reads are replaced at their seams; the guard's own
 * address checks are the plugin fetch proxy's, stubbed here to say which
 * hosts are public.
 */

const mockResolvePublicIp = jest.fn()
const mockDispatcherClose = jest.fn(async () => undefined)

jest.mock('@aglyn/tenant-data-admin/server/serve-plugin-fetch', () => ({
  __esModule: true,
  resolvePublicIp: (...args: unknown[]) => mockResolvePublicIp(...args),
  createPinnedDispatcher: () => ({ close: mockDispatcherClose }),
}))

import {
  AI_THEME_THEME_COLOR_WEIGHT,
  colorsFromMarkup,
  dominantColorsFromPixels,
  fetchPublicText,
  gatherAiThemeBrandInputs,
  logoMediaLocation,
  organizationBrandColors,
  rankBrandColors,
  referenceUrlOf,
  stylesheetUrlsOf,
} from './ai-theme-brand-inputs'

const firestore = {} as FirebaseFirestore.Firestore

afterEach(() => {
  mockResolvePublicIp.mockReset()
  mockDispatcherClose.mockClear()
})

describe('the workspace’s brand color', () => {
  it('is a white-label workspace’s own color, and nobody else’s', () => {
    const branding = { brandingProfile: { primaryColor: '#0F766E' } }
    expect(organizationBrandColors({ plan: 'agency', ...branding } as never)).toEqual([
      { hex: '#0f766e', source: 'organization' },
    ])
    expect(organizationBrandColors({ plan: 'pro', ...branding } as never)).toEqual([])
    expect(
      organizationBrandColors({ plan: 'agency', brandingProfile: { primaryColor: 'teal' } } as never),
    ).toEqual([])
    expect(organizationBrandColors(null)).toEqual([])
  })
})

describe('the site logo', () => {
  it('is located only in the site’s own media library or its org’s', () => {
    expect(logoMediaLocation('media:host-1/logo-1', 'host-1', 'org-1')).toMatchObject({
      scope: { isOrg: false, scopeId: 'host-1' },
      mediaId: 'logo-1',
    })
    expect(logoMediaLocation('media:org:org-1/logo-2@abc', 'host-1', 'org-1')).toMatchObject({
      scope: { isOrg: true, scopeId: 'org-1' },
      scopeSegment: 'org:org-1',
      mediaId: 'logo-2',
    })
    expect(logoMediaLocation('/api/media/cdn/host-1/logo-3', 'host-1', 'org-1')).toMatchObject({
      mediaId: 'logo-3',
    })
    // Another site's asset, another org's, and a URL are not read.
    expect(logoMediaLocation('media:host-2/logo-1', 'host-1', 'org-1')).toBeNull()
    expect(logoMediaLocation('media:org:org-2/logo-1', 'host-1', 'org-1')).toBeNull()
    expect(logoMediaLocation('https://cdn.example/logo.png', 'host-1', 'org-1')).toBeNull()
    expect(logoMediaLocation(undefined, 'host-1', 'org-1')).toBeNull()
  })

  it('reduces the pixels to their dominant distinct colors, past the transparent and the white', () => {
    const pixels: number[] = []
    const paint = (count: number, rgba: number[]) => {
      for (let index = 0; index < count; index += 1) pixels.push(...rgba)
    }
    paint(60, [15, 118, 110, 255])
    paint(30, [255, 255, 255, 255])
    paint(20, [194, 65, 12, 255])
    paint(5, [16, 120, 112, 255])
    paint(40, [0, 0, 0, 0])
    expect(dominantColorsFromPixels(pixels, 4)).toEqual(['#0f766e', '#c2410c'])
    // A logo that is only white still has a color to report.
    expect(dominantColorsFromPixels([255, 255, 255, 255], 4)).toEqual(['#ffffff'])
  })
})

describe('a page the brief links to', () => {
  it('is the first https link in the brief, trailing punctuation left off', () => {
    expect(referenceUrlOf('Match https://brand.example/about. Warmer.')?.toString()).toBe(
      'https://brand.example/about',
    )
    expect(referenceUrlOf('Match http://brand.example')).toBeNull()
    expect(referenceUrlOf('Make it warmer')).toBeNull()
  })

  it('weighs the declared theme color over one use, and skips character references', () => {
    const weights = colorsFromMarkup(
      '<meta name="theme-color" content="#0F766E"><style>a{color:#c2410c} b{color:#C2410C}' +
        ' i{border-color:rgb(194, 65, 12)}</style><p>&#039;quoted&#039;</p>',
    )
    // The declared weight, and one more for the hex the scan also finds there.
    expect(weights.get('#0f766e')).toBe(AI_THEME_THEME_COLOR_WEIGHT + 1)
    expect(weights.get('#c2410c')).toBe(3)
    expect(weights.has('#003399')).toBe(false)
    expect(rankBrandColors(weights)).toEqual(['#0f766e', '#c2410c'])
  })

  it('reads the first https stylesheets the page links, resolved against it', () => {
    expect(
      stylesheetUrlsOf(
        '<link rel="stylesheet" href="/a.css"><link href="http://x.example/b.css" rel="stylesheet">' +
          '<link rel="stylesheet" href="https://cdn.example/c.css"><link rel="stylesheet" href="/d.css">',
        'https://brand.example/about',
      ),
    ).toEqual(['https://brand.example/a.css', 'https://cdn.example/c.css'])
  })
})

describe('fetchPublicText climbs the SSRF guard on every hop', () => {
  const html = (body: string, init: ResponseInit = {}) =>
    new Response(body, { status: 200, headers: { 'content-type': 'text/html' }, ...init })

  it('refuses http, credentials, another port and a host that resolves privately, before any request', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(html('x'))
    mockResolvePublicIp.mockResolvedValue(null)
    const options = { maxBytes: 1_000, accept: /text\/html/ }
    expect(await fetchPublicText('http://brand.example/', options)).toBeNull()
    expect(await fetchPublicText('https://user:pass@brand.example/', options)).toBeNull()
    expect(await fetchPublicText('https://brand.example:8443/', options)).toBeNull()
    expect(await fetchPublicText('https://metadata.internal/', options)).toBeNull()
    expect(mockResolvePublicIp).toHaveBeenCalledTimes(1)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('re-validates a redirect before following it', async () => {
    mockResolvePublicIp.mockImplementation(async (host: string) =>
      host === 'brand.example' ? '93.184.216.34' : null,
    )
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://internal.example/' } }),
      )
    expect(
      await fetchPublicText('https://brand.example/', { maxBytes: 1_000, accept: /text\/html/ }),
    ).toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(mockResolvePublicIp.mock.calls.map((call) => call[0])).toEqual([
      'brand.example',
      'internal.example',
    ])
    expect((fetchSpy.mock.calls[0][1] as { redirect?: string }).redirect).toBe('manual')
    fetchSpy.mockRestore()
  })

  it('reads only an accepted type, and no further than the cap', async () => {
    mockResolvePublicIp.mockResolvedValue('93.184.216.34')
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(html('0123456789abcdef'))
      .mockResolvedValueOnce(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      )
    expect(
      await fetchPublicText('https://brand.example/', { maxBytes: 10, accept: /text\/html/ }),
    ).toEqual({ text: '0123456789', url: 'https://brand.example/' })
    expect(
      await fetchPublicText('https://brand.example/data', { maxBytes: 10, accept: /text\/html/ }),
    ).toBeNull()
    expect(mockDispatcherClose).toHaveBeenCalledTimes(2)
    fetchSpy.mockRestore()
  })
})

describe('gatherAiThemeBrandInputs', () => {
  const host = { orgId: 'org-1', logoUrl: 'media:host-1/logo-1' }

  it('collects every source, one entry per color, and names a source it could not read', async () => {
    const inputs = await gatherAiThemeBrandInputs(
      {
        firestore,
        org: { plan: 'agency', brandingProfile: { primaryColor: '#0f766e' } } as never,
        hostId: 'host-1',
        host,
        brief: 'Match https://brand.example/ and make it warmer.',
      },
      {
        logoColors: async () => ['#0f766e', '#c2410c'],
        referenceColors: async () => null,
      },
    )
    expect(inputs.colors).toEqual([
      { hex: '#0f766e', source: 'organization' },
      { hex: '#c2410c', source: 'logo' },
    ])
    expect(inputs.notes).toEqual([
      'The page at brand.example could not be read for its colors, so the proposal does not use them.',
    ])
  })

  it('reads nothing it was not pointed at', async () => {
    const logoColors = jest.fn(async () => ['#000000'])
    const referenceColors = jest.fn(async () => ['#000000'])
    const inputs = await gatherAiThemeBrandInputs(
      {
        firestore,
        org: { plan: 'pro' } as never,
        hostId: 'host-1',
        host: { orgId: 'org-1', logoUrl: 'https://cdn.example/logo.png' },
        brief: 'Make it warmer.',
      },
      { logoColors, referenceColors },
    )
    expect(inputs).toEqual({ colors: [], notes: [] })
    expect(logoColors).not.toHaveBeenCalled()
    expect(referenceColors).not.toHaveBeenCalled()
  })
})
