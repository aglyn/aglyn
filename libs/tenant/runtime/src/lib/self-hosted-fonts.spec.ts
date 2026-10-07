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

import {
  registerPluginThemeFontCatalog,
  type ThemeFontFacts,
} from '@aglyn/aglyn/plugin-manager/plugin-theme-font-catalog'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import {
  resetSelfHostedFontsForTests,
  SELF_HOSTED_FONT_CACHE_CONTROL,
  selfHostedThemeFonts,
  serveSelfHostedFont,
  themeFontDeliveryCost,
} from './self-hosted-fonts'

const CSS = `/* latin */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/v18/lat400.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}`

const fetchMock = jest.fn()
const realFetch = global.fetch

beforeEach(() => {
  resetSelfHostedFontsForTests()
  resetPluginServicesForTests()
  fetchMock.mockReset()
  global.fetch = fetchMock as never
})
afterAll(() => {
  global.fetch = realFetch
})

describe('selfHostedThemeFonts (AGL-3485)', () => {
  const THEME = { fonts: [{ family: 'Inter', weights: [400] }] }

  it("asks Google as a WOFF2 browser, once per stylesheet per process", async () => {
    fetchMock.mockResolvedValue(new Response(CSS))
    const first = await selfHostedThemeFonts(THEME)
    const second = await selfHostedThemeFonts(THEME)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('fonts.googleapis.com/css2?family=Inter:wght@400')
    expect(init.headers['User-Agent']).toMatch(/Chrome\//)
    expect(first).toEqual(second)
    expect(first?.css).toContain('/api/fonts/inter/v18/lat400.woff2')
    expect(first?.preloads).toEqual(['/api/fonts/inter/v18/lat400.woff2'])
  })

  it('answers null when Google cannot be read and nothing is catalogued', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    expect(await selfHostedThemeFonts(THEME)).toBeNull()
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }))
    resetSelfHostedFontsForTests()
    expect(await selfHostedThemeFonts(THEME)).toBeNull()
  })

  it('⛔ never holds a render on a fetch that does not settle', async () => {
    // A fetch whose render Next abandoned can answer with a promise that
    // never resolves and that no abort signal reaches. Held across requests,
    // that stalled every page on the instance until the function timed out.
    jest.useFakeTimers()
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      fetchMock.mockReturnValue(new Promise(() => undefined))
      const pending = selfHostedThemeFonts(THEME)
      await jest.advanceTimersByTimeAsync(2_500)
      await expect(pending).resolves.toBeNull()
      // The deadline says so, by name (AGL-3569).
      expect(warn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ label: 'self-hosted-fonts.stylesheet', ms: 2_500 }),
      )
      // A second render does not wait on the first one's promise either.
      const again = selfHostedThemeFonts(THEME)
      await jest.advanceTimersByTimeAsync(0)
      await expect(again).resolves.toBeNull()
    } finally {
      warn.mockRestore()
      jest.useRealTimers()
    }
  })

  it('asks nothing for a theme with no Google font', async () => {
    expect(await selfHostedThemeFonts({ fonts: [] })).toBeNull()
    expect(await selfHostedThemeFonts(undefined)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('serveSelfHostedFont (AGL-3485)', () => {
  it('serves the file from Google with a year-long immutable policy', async () => {
    fetchMock.mockResolvedValue(
      new Response('WOFF2', { headers: { 'content-length': '5' } }),
    )
    const res = await serveSelfHostedFont('inter/v18/lat400.woff2')
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://fonts.gstatic.com/s/inter/v18/lat400.woff2',
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('font/woff2')
    expect(res.headers.get('cache-control')).toBe(SELF_HOSTED_FONT_CACHE_CONTROL)
    expect(SELF_HOSTED_FONT_CACHE_CONTROL).toContain('immutable')
    expect(await res.text()).toBe('WOFF2')
  })

  it('refuses any path that is not a Google font file, asking nobody', async () => {
    for (const path of ['../secrets', 'inter/v18/a.ttf', 'a/b/c/d.woff2']) {
      expect((await serveSelfHostedFont(path)).status).toBe(404)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('caches nothing when Google fails', async () => {
    fetchMock.mockResolvedValue(new Response('down', { status: 503 }))
    const res = await serveSelfHostedFont('inter/v18/lat400.woff2')
    expect(res.status).toBe(502)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

describe('the loader picks faces, delivery and fallbacks (AGL-3656)', () => {
  const INTER: ThemeFontFacts = {
    family: 'Inter',
    category: 'sans-serif',
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    italics: [400],
    variableWeights: [100, 900],
    metrics: { unitsPerEm: 2048, ascent: 1984, descent: -494, lineGap: 0, xWidthAvg: 967 },
  }
  const catalog = (facts: ThemeFontFacts) =>
    registerPluginThemeFontCatalog(
      { facts: async (family) => (family.toLowerCase() === facts.family.toLowerCase() ? facts : undefined) },
      { pluginId: 'test' },
    )
  const sheet = (weight: string, file: string, style = 'normal') => `/* latin */
@font-face {
  font-family: 'Inter';
  font-style: ${style};
  font-weight: ${weight};
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/v20/${file}.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}`
  /** Google, as the per-face and combined requests see it, and file sizes for HEAD. */
  const google = (sizes: Record<string, number>) => (url: string, init?: RequestInit) => {
    if (init?.method === 'HEAD') {
      const file = /\/([^/]+)\.woff2$/.exec(url)?.[1] ?? ''
      return Promise.resolve(new Response(null, { headers: { 'content-length': String(sizes[file] ?? 0) } }))
    }
    const axis = decodeURIComponent(url).split(':').pop()?.split('&')[0] ?? ''
    const tuples = axis.includes('@') ? axis.split('@')[1].split(';') : []
    if (tuples.length > 1) {
      // A variable family asked for several faces: the same file for each.
      return Promise.resolve(
        new Response(
          tuples
            .map((tuple) => {
              const [ital, weight] = tuple.includes(',') ? tuple.split(',') : ['0', tuple]
              return sheet(weight, ital === '1' ? 'varitalic' : 'var', ital === '1' ? 'italic' : 'normal')
            })
            .join('\n'),
        ),
      )
    }
    const [ital, weight] = tuples[0].includes(',') ? tuples[0].split(',') : ['0', tuples[0]]
    return Promise.resolve(
      new Response(sheet(weight, `s${ital === '1' ? 'i' : ''}${weight}`, ital === '1' ? 'italic' : 'normal')),
    )
  }
  const BASE = { fontFamily: 'system-ui', h1: { fontWeight: 900 }, body1: { fontWeight: 400 } }
  const THEME = {
    fonts: [{ family: 'Inter', source: 'google' as const }],
    typography: { fontFamily: '"Inter", sans-serif' },
  }

  it('serves a file per weight when the statics are smaller, with a sized fallback', async () => {
    catalog(INTER)
    fetchMock.mockImplementation(google({ var: 120_000, s400: 24_000, s900: 23_000, s300: 22_000, s500: 24_000, s700: 24_000 }))
    const fonts = await selfHostedThemeFonts(THEME, { baseTypography: { ...BASE, fontWeightLight: 300 } })
    // Asked one face at a time, so a static instance comes back.
    const asked = fetchMock.mock.calls.map(([url]) => decodeURIComponent(url))
    expect(asked).toContain('https://fonts.googleapis.com/css2?family=Inter:wght@900&display=swap')
    expect(fonts?.css).toContain("src:url(/api/fonts/inter/v20/s900.woff2) format('woff2');")
    expect(fonts?.css).toContain("font-style:italic;font-weight:400;")
    expect(fonts?.css).not.toContain('/var.woff2')
    expect(fonts?.css).toContain("@font-face{font-family:'Inter Fallback';src:local('Arial')")
    expect(fonts?.preloads).toEqual(['/api/fonts/inter/v20/s400.woff2', '/api/fonts/inter/v20/s900.woff2'])
  })

  it('serves the variable file as one range when it is smaller than the statics', async () => {
    catalog(INTER)
    fetchMock.mockImplementation(google({ var: 30_000, s400: 24_000, s900: 23_000, s300: 22_000, s500: 24_000, s700: 24_000 }))
    const fonts = await selfHostedThemeFonts(THEME, { baseTypography: BASE })
    expect(fonts?.css).toContain("font-weight:300 900;font-display:swap;src:url(/api/fonts/inter/v20/var.woff2)")
    expect(fonts?.css).not.toContain('/s400.woff2')
    expect(fonts?.preloads).toEqual(['/api/fonts/inter/v20/var.woff2'])
  })

  it('asks again within minutes when it chose without the sizes, not a day later', async () => {
    catalog(INTER)
    jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'queueMicrotask', 'nextTick'] })
    try {
      // The sizes cannot be read: the statics are the default.
      fetchMock.mockImplementation(google({}))
      const first = await selfHostedThemeFonts(THEME, { baseTypography: BASE })
      expect(first?.css).not.toContain('/var.woff2')
      // Six minutes on, the sizes answer and the variable file is smaller.
      jest.setSystemTime(Date.now() + 6 * 60 * 1000)
      fetchMock.mockImplementation(google({ var: 30_000, s400: 24_000, s900: 23_000, s300: 22_000, s500: 24_000, s700: 24_000 }))
      const second = await selfHostedThemeFonts(THEME, { baseTypography: BASE })
      expect(second?.css).toContain('/var.woff2')
    } finally {
      jest.useRealTimers()
    }
  })

  it('still sizes the fallback when Google cannot be read, and never links Google', async () => {
    catalog(INTER)
    fetchMock.mockRejectedValue(new Error('offline'))
    const fonts = await selfHostedThemeFonts(THEME, { baseTypography: BASE })
    expect(fonts?.css).toMatch(/^@font-face\{font-family:'Inter Fallback';/)
    expect(fonts?.css).not.toContain('googleapis')
    expect(fonts?.preloads).toEqual([])
  })

  it("serves a site's uploaded faces from its media route, versioned", async () => {
    const fonts = await selfHostedThemeFonts(
      {
        fonts: [
          {
            family: 'Acme Sans',
            source: 'custom',
            category: 'sans-serif',
            metrics: { unitsPerEm: 1000, ascent: 900, descent: -250, lineGap: 0, xWidthAvg: 470 },
            faces: [
              { weight: 400, style: 'normal', src: 'media:org:o1/m1', version: 'abc123' },
              { weight: 700, style: 'normal', src: 'media:org:o1/m2', version: 'def456', unicodeRange: 'U+0000-00FF' },
            ],
          },
        ],
        typography: { fontFamily: '"Acme Sans", sans-serif' },
      },
      { hostId: 'h1', baseTypography: BASE },
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(fonts?.css).toContain("src:url(/api/media/cdn/org:o1:h1/m1?v=abc123.2) format('woff2');")
    expect(fonts?.css).toContain('unicode-range:U+0000-00FF;')
    expect(fonts?.css).toContain("font-family:'Acme Sans Fallback'")
    expect(fonts?.preloads).toEqual([
      '/api/media/cdn/org:o1:h1/m1?v=abc123.2',
      '/api/media/cdn/org:o1:h1/m2?v=def456.2',
    ])
  })

  it("loads the base's own face — the brand on an operator host — when the theme names none", async () => {
    catalog({ ...INTER, family: 'Roboto Flex', italics: [] })
    fetchMock.mockImplementation(google({}))
    const fonts = await selfHostedThemeFonts(
      {},
      {
        baseTypography: { ...BASE, fontFamily: '"Roboto Flex", -apple-system' },
        baseFonts: [{ family: 'Roboto Flex', source: 'google' }],
      },
    )
    expect(decodeURIComponent(fetchMock.mock.calls[0][0])).toContain('family=Roboto+Flex:wght@')
    expect(fonts?.css).toContain("font-family:'Roboto Flex Fallback'")
  })

  it('prices the files the page declares, as the page chooses them (AGL-3656)', async () => {
    catalog(INTER)
    const sizes = { var: 120_000, s400: 24_000, s900: 23_000, s300: 22_000, s500: 24_000, s700: 24_000, si400: 26_000 }
    fetchMock.mockImplementation(google(sizes))
    const cost = await themeFontDeliveryCost(THEME, { baseTypography: BASE })
    expect(cost.complete).toBe(true)
    expect(cost.families).toHaveLength(1)
    const [inter] = cost.families
    expect(inter.family).toBe('Inter')
    expect(inter.files.map((file) => `${file.style[0]}${file.weight}`).sort()).toEqual(
      ['i400', 'n400', 'n500', 'n700', 'n900'],
    )
    expect(cost.bytes).toBe(24_000 + 24_000 + 24_000 + 23_000 + 26_000)
    expect(cost.files).toBe(5)
    // The same page, rendered: every priced file is one it declares.
    const page = await selfHostedThemeFonts(THEME, { baseTypography: BASE })
    expect(page?.css).toContain('/s900.woff2')
  })

  it('counts a variable file once, however many weights it holds', async () => {
    catalog({ ...INTER, italics: [] })
    fetchMock.mockImplementation(google({ var: 30_000, s400: 24_000, s900: 23_000, s500: 24_000, s700: 24_000 }))
    const cost = await themeFontDeliveryCost(THEME, { baseTypography: BASE })
    expect(cost.files).toBe(1)
    expect(cost.bytes).toBe(30_000)
  })

  it('answers incomplete rather than throwing when Google cannot be read', async () => {
    catalog(INTER)
    fetchMock.mockRejectedValue(new Error('offline'))
    const cost = await themeFontDeliveryCost(THEME, { baseTypography: BASE })
    expect(cost).toEqual({
      families: [{ family: 'Inter', source: 'google', files: [], bytes: 0, complete: false }],
      bytes: 0,
      files: 0,
      complete: false,
    })
  })

  it('costs nothing for system fonts, and counts an upload’s Latin files', async () => {
    expect(await themeFontDeliveryCost({}, { baseTypography: BASE })).toEqual({
      families: [],
      bytes: 0,
      files: 0,
      complete: true,
    })
    const cost = await themeFontDeliveryCost(
      {
        fonts: [
          {
            family: 'Acme Sans',
            source: 'custom',
            faces: [
              { weight: 400, style: 'normal', src: 'media:org:o1/m1' },
              { weight: 400, style: 'normal', src: 'media:org:o1/m2', unicodeRange: 'U+0400-045F' },
            ],
          },
        ],
        typography: { fontFamily: '"Acme Sans", sans-serif' },
      },
      { baseTypography: BASE },
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(cost.files).toBe(1)
    expect(cost.complete).toBe(false)
  })

  it('adds nothing for a site on system fonts', async () => {
    catalog(INTER)
    expect(await selfHostedThemeFonts({}, { baseTypography: BASE })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
