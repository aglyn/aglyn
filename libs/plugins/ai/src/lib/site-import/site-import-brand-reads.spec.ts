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
 * A site's real brand, read to the end (AGL-4152): every stylesheet it links
 * to a byte budget, its custom properties resolved and its look facts filled.
 * All offline, over a page written for it.
 */

import { siteImportColorOf, siteImportCssOf, siteImportHex, siteImportReadStylesheets, siteImportStylesOf, SITE_IMPORT_SHEET_LIMITS, type SiteImportSheetAnswer } from './site-import-css'
import { extractSiteImportPage, SITE_IMPORT_PAGE_LIMITS, siteImportStylesheetLinks } from './site-import-html'
import { siteImportLayout, siteImportLookOf } from './site-import-layout'
import type { SiteImportFrameSource } from './site-import-nav'
import { crawlSiteForImport } from './site-import-crawl'
import { SITE_READ_ORIGIN, SITE_READ_VARS_THEME_URL, siteReadPage, siteReadVarsThemeSheets } from './fixtures/site-layout-recordings'
import type { PublicFetchOptions, PublicFetchResult } from '../jobs/ai-theme-brand-inputs'

const sameSite = (url: URL) => url.origin === SITE_READ_ORIGIN
const hsl = (triple: string) => siteImportHex(siteImportColorOf(`hsl(${triple})`) as NonNullable<ReturnType<typeof siteImportColorOf>>)
const TEAL = hsl('168,62%,32%')
const VIOLET = hsl('262 52% 30%')
const INVENTED = hsl('210,65%,45%')

const varsTheme = () => extractSiteImportPage(siteReadPage('vars-theme.html'), SITE_READ_VARS_THEME_URL, sameSite, { structure: true }) as SiteImportFrameSource
const sheetsOf = () => siteReadVarsThemeSheets().map((sheet) => sheet.text)

/** An answer as the fetch gives it: a body cut at the cap, and how much was read. */
const answerOf = (text: string, maxBytes: number): SiteImportSheetAnswer => ({ ok: true, text: text.slice(0, maxBytes), bytes: Math.min(text.length, maxBytes), truncated: text.length > maxBytes })

describe('every stylesheet a page links, to a byte budget', () => {
  it('lists every link past the old four, Google Fonts’ left out', () => {
    const html = siteReadPage('vars-theme.html').replace('</head>', '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora"></head>')
    const links = siteImportStylesheetLinks(html, SITE_READ_VARS_THEME_URL)
    expect(links).toEqual(siteReadVarsThemeSheets().map((sheet) => sheet.url))
    expect(varsTheme().structure.stylesheets).toHaveLength(5)
    expect(SITE_IMPORT_PAGE_LIMITS.stylesheets).toBeGreaterThanOrEqual(20)
  })

  it('reads a 1.29 MB last link whole, and hands every sheet back in link order, as the cascade needs', async () => {
    const big = `:root{--accent:#123456}${'.widget{color:#000000}'.repeat(60_000)}`
    expect(big.length).toBeGreaterThan(1_290_000)
    const bodies: Record<string, string> = { 'https://a.example/1.css': '.a{color:red}', 'https://a.example/2.css': '.b{color:red}', 'https://a.example/3.css': '.c{color:red}', 'https://a.example/4.css': '.d{color:red}', 'https://a.example/5.css': big }
    const read = jest.fn(async (url: string, maxBytes: number) => answerOf(bodies[url] as string, maxBytes))
    const sheets = await siteImportReadStylesheets(Object.keys(bodies), read)
    expect(sheets).toEqual(Object.values(bodies))
    // The small ones are whole from their first read; only the big one is asked twice.
    expect(read).toHaveBeenCalledTimes(6)
  })

  it('reads the sheet that declares `:root` custom properties first when the budget cannot hold them all', async () => {
    const filler = (name: string) => `.${name}{color:#000000}`.repeat(60_000)
    const theme = `:root{--brand:#123456}\n${filler('theme')}`
    const bodies: Record<string, string> = { 'https://a.example/widgets.css': filler('widget'), 'https://a.example/more.css': filler('more'), 'https://a.example/theme.css': theme }
    expect(Object.values(bodies).every((body) => body.length > 1_000_000)).toBe(true)
    const sheets = await siteImportReadStylesheets(Object.keys(bodies), async (url, maxBytes) => answerOf(bodies[url] as string, maxBytes), { budgetBytes: 1_500_000 })
    expect(sheets).toHaveLength(3)
    expect(sheets[2]).toBe(theme)
    // What was left of the budget went to the next in link order; the last kept only its first look.
    expect((sheets[0] as string).length).toBeLessThan(1_500_000)
    expect((sheets[1] as string).length).toBe(SITE_IMPORT_SHEET_LIMITS.firstLookBytes)
  })

  it('keeps its cost bounded: first looks plus the budget, however large the sheets', async () => {
    const urls = Array.from({ length: SITE_IMPORT_PAGE_LIMITS.stylesheets }, (_, at) => `https://a.example/${at}.css`)
    const huge = '.x{color:#000000}'.repeat(600_000)
    let read = 0
    await siteImportReadStylesheets(urls, async (_url, maxBytes) => {
      const answer = answerOf(huge, maxBytes)
      read += answer.bytes
      return answer
    })
    expect(read).toBeLessThanOrEqual(urls.length * SITE_IMPORT_SHEET_LIMITS.firstLookBytes + SITE_IMPORT_SHEET_LIMITS.budgetBytes)
  })

  it('reads no more once time is out, and a sheet that cannot be read is only left out', async () => {
    const read = jest.fn(async (url: string, maxBytes: number) => (url.endsWith('bad.css') ? null : answerOf('.x{color:red}', maxBytes)))
    expect(await siteImportReadStylesheets(['https://a.example/bad.css', 'https://a.example/ok.css'], read)).toEqual(['.x{color:red}'])
    const late = jest.fn(read)
    expect(await siteImportReadStylesheets(['https://a.example/ok.css'], late, { outOfTime: () => true })).toEqual([])
    expect(late).not.toHaveBeenCalled()
  })

  it('reads the whole set through a crawl: the fifth link’s look facts reach the home page', async () => {
    const pages = new Map([...siteReadVarsThemeSheets().map((sheet): [string, string] => [sheet.url, sheet.text])])
    const big = `${pages.get('https://assets.sitekit.example/sites/4182/site.css')}${'.widget{color:#000000}'.repeat(60_000)}`
    pages.set('https://assets.sitekit.example/sites/4182/site.css', big)
    const asked: string[] = []
    const fetch = async (url: string, options: PublicFetchOptions): Promise<PublicFetchResult> => {
      asked.push(url)
      const none: PublicFetchResult = { ok: false, url, text: '', bytes: 0, truncated: false, contentType: '', refusal: 'http-status', status: 404 }
      const body = new URL(url).pathname === '/' && url.includes('harbor-lane') ? siteReadPage('vars-theme.html') : pages.get(url)
      if (body === undefined) return none
      const cut = body.length > options.maxBytes
      if (cut && options.refuseOver) return { ...none, refusal: 'too-large' }
      const text = body.slice(0, options.maxBytes)
      return { ok: true, url, text, bytes: text.length, truncated: cut, contentType: url.endsWith('.css') ? 'text/css' : 'text/html', refusal: null }
    }
    const inventory = await crawlSiteForImport({ domain: 'harbor-lane.example', maxPages: 1 }, { fetch })
    const home = inventory.pages[0]
    expect(home?.look?.buttonFill).toBe(TEAL)
    expect(home?.look?.fonts.headings).toBe('Playfair Display')
    expect(asked.filter((url) => url.endsWith('reset.css'))).toHaveLength(1)
    expect(asked.filter((url) => url.endsWith('site.css'))).toHaveLength(2)
  })
})

describe('custom properties, read through', () => {
  const colorOf = (css: string, declaration: string) => {
    const page = extractSiteImportPage(`<html><body><div id="x"></div></body></html>`, 'https://example.com/', () => true, { structure: true })
    const structure = page.structure as NonNullable<typeof page.structure>
    const styles = siteImportStylesOf(structure, siteImportCssOf([`${css}#x{color:${declaration}}`]))
    const id = structure.elements.find((element) => element.attrs.id === 'x')?.id as number
    const color = siteImportColorOf(styles.of(id).get('color'))
    return color ? siteImportHex(color) : null
  }

  it('resolves a variable holding a comma triple, with and without a strength', () => {
    expect(colorOf(':root{--x-hsl:210,65%,45%}', 'hsl(var(--x-hsl))')).toBe(INVENTED)
    expect(colorOf(':root{--x-hsl:210,65%,45%}', 'hsla(var(--x-hsl),1)')).toBe(INVENTED)
    expect(colorOf(':root{--x-rgb:12,34,56}', 'rgb(var(--x-rgb))')).toBe('#0c2238')
  })

  it('resolves the modern spaced syntax', () => {
    expect(colorOf(':root{--x-hsl:210 65% 45%}', 'hsl(var(--x-hsl))')).toBe(INVENTED)
    expect(colorOf(':root{--x-hsl:210 65% 45%}', 'hsl(var(--x-hsl) / .9)')).toBe(INVENTED)
    expect(colorOf(':root{--x-hsl:210deg 65 45}', 'hsl(var(--x-hsl))')).toBe(INVENTED)
    expect(colorOf(':root{--x-rgb:12 34 56}', 'rgb(var(--x-rgb) / 1)')).toBe('#0c2238')
    expect(colorOf(':root{--h:210;--s:65%;--l:45%}', 'hsl(var(--h) var(--s) var(--l))')).toBe(INVENTED)
  })

  it('follows a long chain, and a fallback inside a fallback', () => {
    expect(colorOf(':root{--a:var(--b);--b:var(--c);--c:var(--d);--d:var(--e);--e:var(--f);--f:210,65%,45%}', 'hsl(var(--a))')).toBe(INVENTED)
    expect(colorOf('', 'var(--gone, var(--also-gone, hsl(210,65%,45%)))')).toBe(INVENTED)
  })

  it('reads a rule written through `:is()` and `:where()`, as a browser would', () => {
    const page = extractSiteImportPage('<html><body><div class="wrap"><a id="y" class="go" href="/x">Go</a><h1 id="z">Hi</h1></div></body></html>', 'https://example.com/', () => true, { structure: true })
    const structure = page.structure as NonNullable<typeof page.structure>
    const css = siteImportCssOf(['.wrap :is(.go, .stop){color:#112233}', ':where(.wrap) h1{color:#445566}', 'h1{color:#778899}'])
    const styles = siteImportStylesOf(structure, css)
    const idOf = (id: string) => structure.elements.find((element) => element.attrs.id === id)?.id as number
    expect(styles.of(idOf('y')).get('color')).toBe('#112233')
    // `:where()` weighs nothing, so the plain rule after it wins.
    expect(styles.of(idOf('z')).get('color')).toBe('#778899')
  })

  it('keeps an element’s own variable to it and its children, its neighbors reading the parent’s', () => {
    const page = extractSiteImportPage('<html><body><div id="a" style="--x:#111111"><p id="b">x</p></div><p id="c">y</p></body></html>', 'https://example.com/', () => true, { structure: true })
    const structure = page.structure as NonNullable<typeof page.structure>
    const styles = siteImportStylesOf(structure, siteImportCssOf([':root{--x:#222222}p{color:var(--x)}']))
    const idOf = (id: string) => structure.elements.find((element) => element.attrs.id === id)?.id as number
    expect(styles.of(idOf('b')).get('color')).toBe('#111111')
    expect(styles.of(idOf('c')).get('color')).toBe('#222222')
  })
})

describe('the look facts of a site whose brand is its custom properties', () => {
  const facts = () => siteImportLookOf(varsTheme(), sheetsOf())

  it('reads nothing of it from the first two sheets, which is where the import used to stop', () => {
    expect(siteImportLookOf(varsTheme(), sheetsOf().slice(0, 2))?.buttonFill).toBeNull()
  })

  it('fills its colors', () => {
    const look = facts()
    expect(look?.buttonFill).toBe(TEAL)
    expect(look?.buttonText).toBe('#ffffff')
    expect(look?.background).toBe('#ffffff')
    expect(look?.text).toBe('#000000')
    expect(look?.palette).toEqual(expect.arrayContaining([TEAL, VIOLET]))
  })

  it('leaves out what is declared and is no color of a brand: greys, and a font named after one', () => {
    const page = extractSiteImportPage('<html><body><h1>Hi</h1></body></html>', 'https://example.com/', () => true, { structure: true })
    const look = siteImportLookOf(page as SiteImportFrameSource, [':root{--accent-grey:#777777;--primary-font:Gold Sans;--brand-hsl:200,70%,40%}h1{color:hsl(var(--brand-hsl))}'])
    expect(look?.palette).toEqual([hsl('200,70%,40%')])
  })

  it('fills its fonts through variables, its body’s from where its words are set', () => {
    expect(facts()?.fonts).toMatchObject({ body: 'Source Sans 3', headings: 'Playfair Display' })
  })

  it('fills its button style and case', () => {
    const look = facts()
    expect(look?.buttonRadius).toBe(999)
    expect(look?.buttonCase).toBe('upper')
    expect(look?.outlinedCase).toBe('upper')
    expect(look?.buttonOutline).toBe(VIOLET)
  })

  it('reads its bands from what a section’s theme declares', () => {
    const layout = siteImportLayout(varsTheme(), sheetsOf())
    expect(layout?.sections.map((section) => section.band)).toEqual(['dark', 'soft'])
  })
})
