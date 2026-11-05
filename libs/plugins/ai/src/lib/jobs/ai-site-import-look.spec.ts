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
 * An imported site wears its source's look (AGL-4108), over aglyn.com's home
 * page as AglynBot read it on 10/28 and a Squarespace page's markup.
 *
 * On 10/29 the look pass read nothing: production registers the import step
 * with no seams, so its read of the home page went without the edge header
 * the crawl sends, our own edge challenged it, and the site kept the
 * starter's indigo, teal and Plus Jakarta Sans. Here the look pass asks the
 * edge itself, takes the brand from the source's buttons and the accent from
 * its links, keeps its grey ground, and sets the site in Roboto Flex, the
 * source's own family, because the theme font catalog has it.
 */

const mockServed = jest.fn(async (_hostname: string) => true)

// Whether the platform serves a hostname is a Firestore read; the edge's own spec drives it.
jest.mock('../site-import/site-import-edge-server', () => ({
  __esModule: true,
  isPlatformServedDomain: (hostname: string) => mockServed(hostname),
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { increment: (n: number) => ({ __inc: n }), serverTimestamp: () => '__now__' },
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { contrastRatio } from '@aglyn/aglyn/app-utils/site-theme'
import { DEFAULT_SITE_THEME } from '@aglyn/aglyn/app-utils/default-site'
import type { ThemeFontFacts } from '@aglyn/aglyn/plugin-manager/plugin-theme-font-catalog'
import type { AiSiteImportFinish, AiSiteImportHome, SiteImportLookFacts } from '../model/ai-site-import'
import { aiSiteKindFor } from '../model/ai-site-kinds'
import { aiHexOklch, aiOklabDistance, aiSiteOwnButton, aiSiteSeed, aiSiteStyleFor, aiSiteTheme, type AiSiteStyle } from '../model/ai-site-look'
import { SITE_IMPORT_EDGE_HEADER } from '../site-import/site-import-edge'
import { extractSiteImportPage } from '../site-import/site-import-html'
import { siteImportLookOf, siteImportLookOfHtml } from '../site-import/site-import-layout'
import type { SiteImportFrameSource } from '../site-import/site-import-nav'
import { SITE_LAYOUT_PAGES, siteLayoutRecording, siteLayoutSameSite, type SiteLayoutPageName } from '../site-import/fixtures/site-layout-recordings'
import { SITE_LOOK_SLATE_HTML, SITE_LOOK_SLATE_URL } from '../site-import/fixtures/site-look-slate'
import type { SiteImportPage } from '../site-import/site-import-crawl'
import { aiSiteImportHomeOf } from './ai-job-import-step'
import { aiRunSiteImportLook, aiSiteImportBrandOf, aiSiteImportLookHeaders, aiSiteImportSourceFonts, readSiteImportLookPage } from './ai-site-import-look'
import type { PublicFetchOptions, PublicFetchResult } from './ai-theme-brand-inputs'

const TOKEN = 'a'.repeat(64)
const NOW = '2026-10-29T18:00:00.000Z'

/** The fonts plugin's catalog, read by path: one plugin's spec never imports another plugin. */
const catalog = JSON.parse(readFileSync(join(__dirname, '../../../../fonts/src/lib/catalog/google-fonts.catalog.json'), 'utf8')) as {
  families: Array<{ f: string; c: ThemeFontFacts['category']; w: number[] }>
}
const fontFacts = async (family: string): Promise<ThemeFontFacts | undefined> => {
  const row = catalog.families.find((entry) => entry.f.toLowerCase() === family.toLowerCase())
  return row ? { family: row.f, category: row.c, weights: row.w, italics: [] } : undefined
}

const lookOf = (name: SiteLayoutPageName) => {
  const { url } = SITE_LAYOUT_PAGES[name]
  const extract = extractSiteImportPage(siteLayoutRecording(name), url, siteLayoutSameSite(name), { structure: true })
  return siteImportLookOf(extract as SiteImportFrameSource)
}

function home(name: SiteLayoutPageName): AiSiteImportHome {
  return {
    url: SITE_LAYOUT_PAGES[name].url,
    title: 'Home',
    description: 'A website platform.',
    ogImage: null,
    siteName: name === 'home' ? 'Aglyn' : 'Tidewater Pottery Studio',
    brand: { kind: 'name-only', text: 'Aglyn', logo: null },
    facts: { lines: [], emails: [], phones: [], social: [], address: '' },
    look: lookOf(name),
  }
}

const ok = (url: string, text: string, contentType = 'text/html'): PublicFetchResult => ({ ok: true, url, text, bytes: text.length, truncated: false, contentType, refusal: null })

/** The 11/4 evidence's slate page as the crawl keeps it (AGL-4152). */
function slateHome(): AiSiteImportHome {
  return { ...home('home'), url: SITE_LOOK_SLATE_URL, siteName: 'Slate Studio', look: siteImportLookOfHtml(SITE_LOOK_SLATE_HTML, SITE_LOOK_SLATE_URL) as SiteImportLookFacts }
}

/** The look pass over a recorded home page, with no seam for its headers: what it read with, and the style it saved. */
async function runLook(name: SiteLayoutPageName | 'slate', patch: { fontFacts?: typeof fontFacts; finish?: AiSiteImportFinish | null } = {}) {
  const asked: Array<{ url: string; options: PublicFetchOptions }> = []
  const saved: AiSiteStyle[] = []
  const page = name === 'slate' ? { url: SITE_LOOK_SLATE_URL, html: SITE_LOOK_SLATE_HTML, home: slateHome() } : { url: SITE_LAYOUT_PAGES[name].url, html: siteLayoutRecording(name), home: home(name) }
  const look = await aiRunSiteImportLook(
    {
      firestore: {} as never,
      hostId: 'host-import',
      orgId: 'org-test',
      uid: 'uid-owner',
      jobId: 'importJob',
      domain: new URL(page.url).hostname.replace(/^www\./, ''),
      home: page.home,
      at: NOW,
      ...(patch.finish !== undefined ? { finish: patch.finish } : {}),
    },
    {
      fetch: async (url, options) => {
        asked.push({ url, options })
        return url === page.url ? ok(url, page.html) : { ...ok(url, ''), ok: false, refusal: 'status' as never }
      },
      save: async (_firestore, input) => {
        saved.push(input.style)
        return { write: 'applied', baseName: 'Base' }
      },
      others: async () => [],
      readHost: async () => null,
      fontFacts: patch.fontFacts ?? fontFacts,
    },
  )
  return { look, asked, saved }
}

const previous = process.env['SITE_IMPORT_EDGE_TOKEN']
beforeEach(() => {
  process.env['SITE_IMPORT_EDGE_TOKEN'] = TOKEN
  mockServed.mockClear()
})
afterAll(() => {
  if (previous === undefined) delete process.env['SITE_IMPORT_EDGE_TOKEN']
  else process.env['SITE_IMPORT_EDGE_TOKEN'] = previous
})

describe('the look pass reads the source past our own edge, with no seam handed in (AGL-4108)', () => {
  it('sends the edge header with the home page’s read, as the crawl does, when the step was registered with no deps', async () => {
    const { asked, look } = await runLook('home')
    const page = asked.find((entry) => entry.url === SITE_LAYOUT_PAGES.home.url)
    // Asked of the fetch for every hop, as the crawl's are: the page's own address gets it.
    expect(page?.options.headersFor?.(new URL(SITE_LAYOUT_PAGES.home.url))?.[SITE_IMPORT_EDGE_HEADER]).toBe(TOKEN)
    // A hop off the site's two origins gets nothing.
    expect(page?.options.headersFor?.(new URL('https://cdn.example.net/x'))).toEqual({})
    expect(mockServed).toHaveBeenCalledWith('aglyn.com')
    expect(look.theme).toBe('applied')
  })

  it('sends nothing to a site this platform does not serve', async () => {
    mockServed.mockImplementation(async () => false)
    const { asked } = await runLook('pottery')
    expect(asked.every((entry) => !entry.options.headersFor?.(new URL(entry.url))?.[SITE_IMPORT_EDGE_HEADER])).toBe(true)
    mockServed.mockImplementation(async () => true)
  })

  it('still takes a caller’s headers where it hands them in, and none on a failed read', async () => {
    const handed = await aiSiteImportLookHeaders('aglyn.com', { headersFor: async () => ({ 'x-test': '1' }) })
    expect(handed(new URL('https://www.aglyn.com/'))).toEqual({ 'x-test': '1' })
    expect(handed(new URL('https://example.com/'))).toEqual({})
    const failed = await aiSiteImportLookHeaders('aglyn.com', { edgeHeadersFor: async () => { throw new Error('down') } })
    expect(failed(new URL('https://aglyn.com/'))).toEqual({})
  })
})

describe('aglyn.com’s look (AGL-4108)', () => {
  it('takes its buttons’ blue as the brand and its links’ blue as the accent, on its own grey ground', async () => {
    const { saved, look } = await runLook('home')
    const style = saved[0]
    expect(style.brand).toBe('#00b0ff')
    expect(style.accent).toBe(Math.round(aiHexOklch('#0077ad').h) % 360)
    expect(style.page).toBe('#f5f5f5')
    expect(look.colors.slice(0, 2)).toEqual(['#00b0ff', '#0077ad'])
    // Its buttons' corners, 4 pixels, round the theme's shape.
    expect(style.buttons).toBe('rounded')
    expect(style.corners).toBe('soft')
  })

  it('draws a theme in the source’s blue on its grey, every color reading as the theme asks', async () => {
    const { saved } = await runLook('home')
    const theme = aiSiteTheme(saved[0], DEFAULT_SITE_THEME)
    const light = theme.colorSchemes?.light
    const primary = light?.primary?.main as string
    // White words on the source's own #00b0ff read at 2.4:1; the brand is its nearest shade that reads.
    expect(Math.abs(aiHexOklch(primary).h - aiHexOklch('#00b0ff').h)).toBeLessThanOrEqual(4)
    expect(contrastRatio('#ffffff', primary)).toBeGreaterThanOrEqual(4.5)
    // Which is the deeper blue the source draws its own links in, within a step of it.
    const a = aiHexOklch(primary)
    const b = aiHexOklch('#0077ad')
    const delta = Math.hypot(a.L - b.L, a.C * Math.cos((a.h * Math.PI) / 180) - b.C * Math.cos((b.h * Math.PI) / 180), a.C * Math.sin((a.h * Math.PI) / 180) - b.C * Math.sin((b.h * Math.PI) / 180))
    expect(delta).toBeLessThanOrEqual(0.06)
    expect(light?.background?.default).toBe('#f5f5f5')
    expect(contrastRatio(primary, '#f5f5f5')).toBeGreaterThanOrEqual(3)
    // Never the starter's indigo.
    expect(primary).not.toBe(DEFAULT_SITE_THEME.colorSchemes?.light?.primary?.main)
  })

  it('sets the site in Roboto Flex, its own family, because the theme font catalog has it', async () => {
    const { saved } = await runLook('home')
    expect(saved[0].sourceFonts?.body).toMatchObject({ family: 'Roboto Flex', category: 'sans-serif' })
    expect(saved[0].sourceFonts?.heading).toBeNull()
    const theme = aiSiteTheme(saved[0], DEFAULT_SITE_THEME)
    expect(theme.fonts?.map((font) => [font.family, font.source])).toEqual([['Roboto Flex', 'google']])
    expect(theme.typography?.fontFamily).toMatch(/^"?Roboto Flex"?/)
    expect(JSON.stringify(theme)).not.toContain('Plus Jakarta Sans')
  })

  it('falls back to a pairing of its type mood where the family is not in the catalog', async () => {
    const { saved } = await runLook('home', { fontFacts: async () => undefined })
    expect(saved[0].sourceFonts ?? null).toBeNull()
    const theme = aiSiteTheme(saved[0], DEFAULT_SITE_THEME)
    expect(theme.fonts?.[0]?.family).not.toBe('Roboto Flex')
  })
})

describe('aglyn.com’s eyebrows, third color and motion (AGL-4138)', () => {
  it('sets its eyebrows as spaced capitals with no line before them, and pins their magenta as the theme’s third', async () => {
    const { saved, look } = await runLook('home')
    const style = saved[0]
    // A seed's draw once set them after a short dash, which the source never draws.
    expect(style.eyebrow).toBe('caps')
    expect(style.tertiary).toBe('#e040fb')
    expect(look.colors.slice(0, 3)).toEqual(['#00b0ff', '#0077ad', '#e040fb'])
    const theme = aiSiteTheme(style, DEFAULT_SITE_THEME)
    // No short line drawn before an overline: the theme's Typography carries no variant of its own.
    expect((theme.components as Record<string, unknown> | undefined)?.['MuiTypography']).toBeUndefined()
    const tertiary = theme.colorSchemes?.light?.tertiary?.main as string
    // The magenta at the nearest shade of it that reads on white, its hue kept.
    expect(Math.abs(aiHexOklch(tertiary).h - aiHexOklch('#e040fb').h)).toBeLessThanOrEqual(2)
    expect(contrastRatio(tertiary, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(tertiary, '#f5f5f5')).toBeGreaterThanOrEqual(4)
  })

  it('moves as the source does: a page that animates nothing pins the still motion, whatever the seed would draw', async () => {
    const { saved, look } = await runLook('home')
    expect(saved[0].motion).toBe('still')
    expect(look.style?.motion).toBe('still')
  })

  it('pins no third color for a source whose eyebrows are its words’ own, and keeps the accent’s neighbor', async () => {
    const { saved } = await runLook('pottery')
    expect(lookOf('pottery')?.eyebrow).toBeNull()
    expect(saved[0].tertiary).toBeUndefined()
    expect(saved[0].eyebrow).toBe('caps')
    const unpinned = aiSiteTheme({ ...saved[0], tertiary: undefined }, DEFAULT_SITE_THEME)
    expect(aiSiteTheme(saved[0], DEFAULT_SITE_THEME).colorSchemes?.light?.tertiary).toEqual(unpinned.colorSchemes?.light?.tertiary)
  })
})

describe('a Squarespace page’s look (AGL-4108)', () => {
  it('sets its body in Work Sans and its headings in Fraunces, the families it loads from Google Fonts', async () => {
    const fonts = await aiSiteImportSourceFonts(lookOf('pottery'), async () => undefined)
    expect(fonts).toEqual({ body: { family: 'Work Sans', category: 'sans-serif', weights: [] }, heading: { family: 'Fraunces', category: 'sans-serif', weights: [] } })
    const { saved } = await runLook('pottery')
    const theme = aiSiteTheme(saved[0], DEFAULT_SITE_THEME)
    expect(theme.fonts?.map((font) => font.family)).toEqual(['Work Sans', 'Fraunces'])
    expect(theme.typography?.variants?.h1?.fontFamily).toMatch(/Fraunces/)
  })

  it('takes its terracotta buttons as the brand and its rust links as the accent', () => {
    expect(aiSiteImportBrandOf(lookOf('pottery'))).toEqual({ brand: '#c4622d', accent: '#8a3f17' })
    // A source whose buttons are grey takes its links' color as the brand.
    expect(aiSiteImportBrandOf({ buttonFill: '#222222', link: '#0b6e4f' })).toEqual({ brand: '#0b6e4f', accent: null })
    expect(aiSiteImportBrandOf({ buttonFill: null, link: null })).toBeNull()
  })
})

/*------------------------------------------
 * Keep my site, or Improve it (AGL-4152)
 *-----------------------------------------*/

/** A theme's filled and outlined primary button styles, as its components hold them. */
const buttonVariants = (theme: ReturnType<typeof aiSiteTheme>) =>
  ((theme.components?.['MuiButton']?.variants ?? []) as Array<{ props: Record<string, unknown>; sx?: Record<string, unknown> }>)

describe('Keep my site keeps aglyn.com’s look closer (AGL-4152)', () => {
  it('is what an import that names no finish gets', async () => {
    const absent = (await runLook('home')).saved[0]
    const kept = (await runLook('home', { finish: 'keep' })).saved[0]
    expect(absent).toEqual(kept)
    expect(absent?.finish).toBe('keep')
  })

  it('pins its dark band’s ground, its buttons’ capitals and its buttons’ own fill and words', async () => {
    const style = (await runLook('home')).saved[0] as AiSiteStyle
    expect(style).toMatchObject({ page: '#f5f5f5', darkPage: '#161c21', buttonCase: 'upper', buttonFill: '#00b0ff', buttonText: '#ffffff' })
    const theme = aiSiteTheme(style, DEFAULT_SITE_THEME)
    const dark = theme.colorSchemes?.dark
    // The dark scheme sits on the source's own dark ground, not the near-black of every other site.
    expect(aiOklabDistance(dark?.background?.default as string, '#161c21')).toBeLessThanOrEqual(0.05)
    expect(theme.typography?.variants?.button).toMatchObject({ textTransform: 'uppercase', letterSpacing: '0.06em' })
    // Its dark bands carry the cyan itself, so its outlined buttons there are cyan.
    expect(dark?.primary?.main).toBe('#00b0ff')
    // Its recorded white words read on the light cyan at 2.4:1 and have no lighter shade: the cyan stays, under black.
    expect(aiSiteOwnButton(style)).toEqual({ label: 'common.black', outlined: false })
    expect(theme.colorSchemes?.light?.primary?.light).toBe('#00b0ff')
    // Links and outlined buttons keep the deeper shade white reads on.
    expect(contrastRatio('#ffffff', theme.colorSchemes?.light?.primary?.main)).toBeGreaterThanOrEqual(4.5)
    // Its white bands are the paper, its grey page the page, so the dark scheme orders them the same.
    expect(style).toMatchObject({ paper: '#ffffff', textCase: 'none', outlinedCase: 'upper', buttonOutline: '#0077ad' })
    expect(theme.colorSchemes?.light?.background).toEqual({ default: '#f5f5f5', paper: '#ffffff' })
    expect(aiHexOklch(dark?.background?.paper as string).L).toBeGreaterThan(aiHexOklch(dark?.background?.default as string).L)
  })
})

describe('Keep my site on the 11/4 evidence: a slate hero and light cyan buttons under dark words (AGL-4152)', () => {
  it('draws the dark scheme on the slate, its buttons in capitals, and its filled buttons in their own cyan under their own dark words', async () => {
    const style = (await runLook('slate')).saved[0] as AiSiteStyle
    expect(style).toMatchObject({ finish: 'keep', darkPage: '#2b2f36', buttonCase: 'upper', buttonFill: '#00b0ff', buttonText: '#0b1b2b' })
    const theme = aiSiteTheme(style, DEFAULT_SITE_THEME)
    const light = theme.colorSchemes?.light
    const dark = theme.colorSchemes?.dark
    expect(aiOklabDistance(dark?.background?.default as string, '#2b2f36')).toBeLessThanOrEqual(0.05)
    expect(theme.typography?.variants?.button).toMatchObject({ textTransform: 'uppercase', letterSpacing: '0.06em' })
    // The filled buttons are the source's own cyan, under black on its words' side of the fill.
    const contained = buttonVariants(theme).find((variant) => variant.props['variant'] === 'contained' && variant.props['color'] === 'primary')
    expect(contained?.sx).toMatchObject({ bgcolor: 'primary.light', color: 'common.black' })
    expect(light?.primary?.light).toBe('#00b0ff')
    expect(dark?.primary?.light).toBe('#00b0ff')
    // The links keep the brand's deeper shade, which white reads on and which reads on the grey page.
    expect(contrastRatio('#ffffff', light?.primary?.main)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(light?.primary?.main, '#f5f5f5')).toBeGreaterThanOrEqual(3)
    expect(Math.abs(aiHexOklch(light?.primary?.main as string).h - aiHexOklch('#00b0ff').h)).toBeLessThanOrEqual(4)
    // On the slate the cyan is the brand itself, under the source's own words.
    expect(dark?.primary).toMatchObject({ main: '#00b0ff', contrastText: '#0b1b2b' })
  })
})

describe('Improve it pins only the brand’s colors and fonts (AGL-4152)', () => {
  it('drops aglyn.com’s grounds, button corners, case and fill, and its eyebrows, so the base that suits the site shows', async () => {
    const style = (await runLook('home', { finish: 'improve' })).saved[0] as AiSiteStyle
    expect(style.finish).toBe('improve')
    for (const key of ['page', 'darkPage', 'buttonCase', 'buttonFill', 'buttonText'] as const) expect([key, style[key]]).toEqual([key, undefined])
    // Still its own colors and type.
    expect(style.brand).toBe('#00b0ff')
    expect(style.accent).toBe(Math.round(aiHexOklch('#0077ad').h) % 360)
    expect(style.tertiary).toBe('#e040fb')
    expect(style.sourceFonts?.body?.family).toBe('Roboto Flex')
    // Everything else is the seed's draw for the kind: the same style as one pinned with the colors and fonts alone.
    const drawn: Partial<AiSiteStyle> = { ...style }
    delete drawn.finish
    delete drawn.sourceFonts
    const kind = aiSiteKindFor('Aglyn A website platform.')
    const pins = { brand: '#00b0ff', hue: style.hue, accent: style.accent, tertiary: '#e040fb', fonts: style.fonts }
    expect(drawn).toEqual(aiSiteStyleFor({ kind, answer: {}, seed: aiSiteSeed('importJob'), brand: '#00b0ff', avoid: [], pins }))
    const theme = aiSiteTheme(style, DEFAULT_SITE_THEME)
    expect(aiSiteOwnButton(style)).toBeNull()
    expect(buttonVariants(theme).some((variant) => variant.props['variant'] === 'contained')).toBe(false)
    expect(theme.colorSchemes?.light?.background?.default).not.toBe('#f5f5f5')
    expect(theme.colorSchemes?.dark?.background?.default).not.toBe('#161c21')
  })

  it('keeps the slate page’s cyan and its type, and none of its slate, capitals or own-fill buttons', async () => {
    const style = (await runLook('slate', { finish: 'improve' })).saved[0] as AiSiteStyle
    expect(style).toMatchObject({ finish: 'improve', brand: '#00b0ff' })
    expect([style.darkPage, style.buttonCase, style.buttonFill, style.page]).toEqual([undefined, undefined, undefined, undefined])
    const theme = aiSiteTheme(style, DEFAULT_SITE_THEME)
    expect(theme.colorSchemes?.dark?.background?.default).not.toBe('#2b2f36')
    expect(theme.colorSchemes?.light?.primary?.light).not.toBe('#00b0ff')
    // Every color a theme role: the components name palette paths, never a color of their own.
    expect(JSON.stringify(theme.components ?? {})).not.toMatch(/#[0-9a-f]{6}\b/i)
  })
})

/*------------------------------------------
 * A bare read never leaves the stock theme (AGL-4152)
 *-----------------------------------------*/

describe('a look with no colorful fact falls back to its pictures, and never leaves the stock theme (AGL-4152)', () => {
  const GREY_FACTS: SiteImportLookFacts = {
    fonts: { body: null, headings: null, google: [] },
    background: '#ffffff',
    text: '#111111',
    buttonFill: '#000000',
    buttonText: '#ffffff',
    buttonRadius: null,
    link: '#333333',
    header: null,
  }
  const HOME: AiSiteImportHome = {
    url: 'https://www.harbor-lane.example/',
    title: 'Home',
    description: 'Bookkeeping for small businesses.',
    ogImage: null,
    siteName: 'Harbor Lane Bookkeeping',
    brand: { kind: 'logo-only', text: '', logo: { url: 'https://cdn.harbor-lane.example/logo.png', alt: 'Harbor Lane', type: 'raster' } },
    facts: { lines: [], emails: [], phones: [], social: [], address: '' },
    look: GREY_FACTS,
    hero: { url: 'https://cdn.harbor-lane.example/harbor.jpg', alt: 'Boats' },
  }
  const PICTURE = new Uint8Array(4096).fill(7)

  /** The pass over a page that draws nothing colorful, with a library door and pictures of known colors. */
  async function bare(home: Partial<AiSiteImportHome>, colors: Record<string, readonly string[] | null>, deps: { ingest?: boolean; html?: string; pageRead?: boolean } = {}) {
    const saved: AiSiteStyle[] = []
    const fetched: string[] = []
    const stored: string[] = []
    const look = await aiRunSiteImportLook(
      { firestore: {} as never, hostId: 'host-import', orgId: 'org-test', uid: 'uid-owner', jobId: 'importJob', domain: 'harbor-lane.example', home: { ...HOME, ...home }, at: NOW },
      {
        fetch: async (url, options) => {
          fetched.push(url)
          if (options.binary) return { ...ok(url, ''), contentType: 'image/png', data: PICTURE, bytes: PICTURE.length }
          if (url === HOME.url && deps.pageRead !== false) return ok(url, deps.html ?? '<html><head><title>Home</title></head><body><h1>Hi</h1></body></html>')
          return { ...ok(url, ''), ok: false, refusal: 'http-status' }
        },
        save: async (_firestore, input) => {
          saved.push(input.style)
          return { write: 'applied', baseName: 'Base' }
        },
        others: async () => [],
        readHost: async () => null,
        fontFacts,
        pictureColors: async (photo) => colors[photo.from as string] ?? null,
        ingest:
          deps.ingest === false
            ? null
            : ({
                findImportedPhoto: async () => null,
                ingest: async (input: { importedFrom?: { url: string } }) => {
                  stored.push(input.importedFrom?.url ?? '')
                  return { ok: true, mediaId: `m${stored.length}`, src: `media:host-import/m${stored.length}` }
                },
              } as never),
      },
    )
    return { look, saved, fetched, stored }
  }

  const LOGO = 'https://cdn.harbor-lane.example/logo.png'
  const HERO = 'https://cdn.harbor-lane.example/harbor.jpg'

  it('takes the brand and accent from the logo’s colorful colors', async () => {
    const { look, saved, stored } = await bare({}, { [LOGO]: ['#0f766e', '#c2410c'] })
    expect(look).toMatchObject({ theme: 'applied', from: 'logo' })
    expect(saved[0]?.brand).toBe('#0f766e')
    expect(saved[0]?.accent).toBe(Math.round(aiHexOklch('#c2410c').h) % 360)
    expect(look.colors).toContain('#0f766e')
    // The photo was never brought in: the logo said enough.
    expect(stored).toEqual([LOGO])
  })

  it('goes on to the hero photo when the logo has no colorful color, or cannot be read', async () => {
    for (const logo of [['#000000', '#777777'], null]) {
      const { look, saved, stored } = await bare({}, { [LOGO]: logo, [HERO]: ['#1d4e89', '#c2410c'] })
      expect(look).toMatchObject({ theme: 'applied', from: 'photo' })
      expect(saved[0]?.brand).toBe('#1d4e89')
      expect(stored).toEqual([LOGO, HERO])
    }
  })

  it('goes to the home page’s share picture where it kept no hero, on a read made before it was kept', async () => {
    const { look, saved } = await bare({ hero: undefined, ogImage: 'https://cdn.harbor-lane.example/share.jpg' }, { [LOGO]: null, 'https://cdn.harbor-lane.example/share.jpg': ['#7c2d12'] })
    expect(look.from).toBe('photo')
    expect(saved[0]?.brand).toBe('#7c2d12')
  })

  it('never reads a picture for a look that has its own color', async () => {
    const { look, saved, stored } = await bare({ look: { ...GREY_FACTS, buttonFill: '#0f766e' } }, { [LOGO]: ['#c2410c'], [HERO]: ['#1d4e89'] })
    expect(look.from).toBe('source')
    expect(saved[0]?.brand).toBe('#0f766e')
    // The logo is still brought in for the header; the hero is not.
    expect(stored).toEqual([LOGO])
  })

  it('takes a root stylesheet’s declared palette as a color of the look’s own, its second color the accent', async () => {
    const { look, saved } = await bare({ look: { ...GREY_FACTS, palette: ['#a16207', '#312e81'] } }, { [LOGO]: ['#c2410c'] })
    expect(look.from).toBe('source')
    expect(saved[0]?.brand).toBe('#a16207')
    expect(saved[0]?.accent).toBe(Math.round(aiHexOklch('#312e81').h) % 360)
  })

  it('keeps a filled button’s brand and takes the palette’s other color as the accent where its links have none', () => {
    expect(aiSiteImportBrandOf({ buttonFill: '#a16207', link: '#ffffff', palette: ['#a16207', '#312e81'] })).toEqual({ brand: '#a16207', accent: '#312e81' })
    expect(aiSiteImportBrandOf({ buttonFill: '#a16207', link: '#0f766e', palette: ['#a16207', '#312e81'] })).toEqual({ brand: '#a16207', accent: '#0f766e' })
    expect(aiSiteImportBrandOf({ buttonFill: null, link: null, palette: [] })).toBeNull()
  })

  it('draws the kind of site’s own look from the seed with no logo and no picture, so the site still leaves the stock theme', async () => {
    const { look, saved, stored } = await bare({ brand: { kind: 'name-only', text: 'Harbor Lane', logo: null }, hero: null }, {})
    expect(look).toMatchObject({ theme: 'applied', from: 'seed', logo: null, colors: [] })
    expect(stored).toEqual([])
    expect(saved).toHaveLength(1)
    const kind = aiSiteKindFor('Harbor Lane Bookkeeping Bookkeeping for small businesses.')
    const drawn = aiSiteStyleFor({ kind, answer: {}, seed: aiSiteSeed('importJob'), avoid: [] })
    expect(saved[0]).toMatchObject({ base: drawn.base, hue: drawn.hue, fonts: drawn.fonts })
    expect(aiSiteTheme(saved[0] as AiSiteStyle, DEFAULT_SITE_THEME).colorSchemes?.light?.primary?.main).not.toBe(DEFAULT_SITE_THEME.colorSchemes?.light?.primary?.main)
  })

  it('leaves the stock theme even when the home page cannot be read again and nothing was found of it', async () => {
    const { look, saved } = await bare({ brand: { kind: 'name-only', text: '', logo: null }, hero: null, look: null }, {}, { pageRead: false })
    expect(look).toMatchObject({ theme: 'applied', from: 'seed' })
    expect(saved).toHaveLength(1)
  })

  it('falls through to the seed where no library can hold a picture, and says so', async () => {
    const { look } = await bare({}, { [LOGO]: ['#0f766e'] }, { ingest: false })
    expect(look).toMatchObject({ theme: 'applied', from: 'seed' })
  })

  it('still tells of an owner’s theme it kept', async () => {
    const look = await aiRunSiteImportLook(
      { firestore: {} as never, hostId: 'h', orgId: 'o', uid: 'u', jobId: 'j', domain: 'harbor-lane.example', home: { ...HOME, brand: { kind: 'name-only', text: '', logo: null }, hero: null }, at: NOW },
      { fetch: async (url) => ({ ...ok(url, ''), ok: false, refusal: 'http-status' }), save: async () => ({ write: 'kept', baseName: 'Base' }), others: async () => [], readHost: async () => null, fontFacts },
    )
    expect(look.theme).toBe('kept')
  })

  it('reads every sheet the home page links, to the same budget as the crawl, and no Google Fonts sheet', async () => {
    const asked: string[] = []
    const page = await readSiteImportLookPage('https://www.harbor-lane.example/', {
      fetch: async (url) => {
        asked.push(url)
        if (url.endsWith('/')) return ok(url, `<html><head>${[1, 2, 3, 4, 5, 6].map((at) => `<link rel="stylesheet" href="https://cdn.sitekit.example/${at}.css">`).join('')}<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora"></head></html>`)
        return ok(url, `.s{color:red}/*${url}*/`, 'text/css')
      },
    })
    expect(page?.stylesheets).toHaveLength(6)
    expect(page?.stylesheets[4]).toContain('5.css')
    expect(asked.some((url) => url.includes('googleapis'))).toBe(false)
  })
})

describe('the hero a home page keeps for the look (AGL-4152)', () => {
  it('is its first main picture that is not its logo', () => {
    const page = {
      url: 'https://www.harbor-lane.example/',
      path: '/',
      foundBy: 'home',
      title: 'Home',
      description: '',
      ogImage: null,
      siteName: 'Harbor Lane',
      icons: [],
      organization: null,
      blocks: [],
      links: [],
      navLinks: [],
      forms: { kept: [], removed: 0 },
      lang: 'en',
      canonical: null,
      bytes: 1,
      brand: { logo: { url: 'https://cdn.example/logo.png', alt: 'Logo', type: 'raster' }, text: '' },
      images: [
        { url: 'https://cdn.example/logo.png', alt: 'Logo', sameSite: false, region: 'header' },
        { url: 'https://cdn.example/logo.png', alt: 'Logo', sameSite: false, region: 'main' },
        { url: 'https://cdn.example/harbor.jpg', alt: 'Boats', sameSite: false, region: 'main' },
      ],
    } as unknown as SiteImportPage
    expect(aiSiteImportHomeOf({ pages: [page] })?.hero).toEqual({ url: 'https://cdn.example/harbor.jpg', alt: 'Boats' })
    expect(aiSiteImportHomeOf({ pages: [{ ...page, images: [] }] })?.hero).toBeUndefined()
  })
})
