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
import type { AiSiteImportHome } from '../model/ai-site-import'
import { aiHexOklch, aiSiteTheme, type AiSiteStyle } from '../model/ai-site-look'
import { SITE_IMPORT_EDGE_HEADER } from '../site-import/site-import-edge'
import { extractSiteImportPage } from '../site-import/site-import-html'
import { siteImportLookOf } from '../site-import/site-import-layout'
import type { SiteImportFrameSource } from '../site-import/site-import-nav'
import { SITE_LAYOUT_PAGES, siteLayoutRecording, siteLayoutSameSite, type SiteLayoutPageName } from '../site-import/fixtures/site-layout-recordings'
import { aiRunSiteImportLook, aiSiteImportBrandOf, aiSiteImportLookHeaders, aiSiteImportSourceFonts } from './ai-site-import-look'
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

/** The look pass over a recorded home page, with no seam for its headers: what it read with, and the style it saved. */
async function runLook(name: SiteLayoutPageName, patch: { fontFacts?: typeof fontFacts } = {}) {
  const asked: Array<{ url: string; options: PublicFetchOptions }> = []
  const saved: AiSiteStyle[] = []
  const look = await aiRunSiteImportLook(
    { firestore: {} as never, hostId: 'host-import', orgId: 'org-test', uid: 'uid-owner', jobId: 'importJob', domain: new URL(SITE_LAYOUT_PAGES[name].url).hostname.replace(/^www\./, ''), home: home(name), at: NOW },
    {
      fetch: async (url, options) => {
        asked.push({ url, options })
        return url === SITE_LAYOUT_PAGES[name].url ? ok(url, siteLayoutRecording(name)) : { ...ok(url, ''), ok: false, refusal: 'status' as never }
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
