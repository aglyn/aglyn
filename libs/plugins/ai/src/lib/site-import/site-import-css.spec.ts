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
 * The small cascade the layout reader reads a page through (AGL-4106): what
 * a 1280-pixel screen in light mode applies, in the order a browser applies
 * it, and the values the reader asks about.
 */

import {
  siteImportAspectRatio,
  siteImportBackgroundOf,
  siteImportBorderSides,
  siteImportColorDistance,
  siteImportColorOf,
  siteImportOpaque,
  SITE_IMPORT_CSS_WIDE_WIDTH,
  siteImportCssOf,
  siteImportFontFamilies,
  siteImportGridBoxes,
  siteImportGridColumns,
  siteImportGridTrackCount,
  siteImportHasBorder,
  siteImportHex,
  siteImportStylesOf,
  siteImportTwelfths,
} from './site-import-css'
import { extractSiteImportPage } from './site-import-html'
import { siteImportGoogleFamilies } from './site-import-layout'
import { SITE_LAYOUT_PAGES, siteLayoutRecording, siteLayoutSameSite } from './fixtures/site-layout-recordings'

const PAGE = 'https://example.com/'
const sameSite = (url: URL) => url.origin === 'https://example.com'

/** A page's elements' styles, by the `id` the markup gives them. */
function styled(body: string, css: string[] = []) {
  const page = extractSiteImportPage(`<html><head></head><body>${body}</body></html>`, PAGE, sameSite, { structure: true })
  const structure = page.structure
  if (!structure) throw new Error('no structure')
  const styles = siteImportStylesOf(structure, siteImportCssOf([...structure.styles, ...css]))
  return (id: string) => {
    const element = structure.elements.find((entry) => entry.attrs.id === id)
    if (!element) throw new Error(`no #${id}`)
    return styles.of(element.id)
  }
}

describe('the cascade', () => {
  it('applies specificity, then order, then !important, and the element’s own style over every rule', () => {
    const style = styled(
      '<div id="a" class="card"></div><div id="b" class="card x" style="color: #00ff00"></div><div id="c" class="card"></div>',
      ['.card{color:#111111;display:block} div.card{color:#222222} .card{display:grid} #c{color:#333333} .card.x{color:#444444 !important}'],
    )
    expect(style('a').get('color')).toBe('#222222')
    expect(style('a').get('display')).toBe('grid')
    expect(style('c').get('color')).toBe('#333333')
    // !important beats the inline style; the inline style beats every plain rule.
    expect(style('b').get('color')).toBe('#444444')
  })

  it('reads the page as a wide screen in light mode: min-width rules apply, phone, print and dark ones do not', () => {
    const style = styled('<div id="grid" class="grid"></div>', [
      '.grid{grid-template-columns:1fr}',
      '@media (min-width:600px){.grid{grid-template-columns:repeat(2,1fr)}}',
      '@media (min-width:900px){.grid{grid-template-columns:repeat(3,1fr)}}',
      '@media (max-width:899.95px){.grid{grid-template-columns:1fr 1fr 1fr 1fr}}',
      '@media print{.grid{grid-template-columns:none}}',
      '@media (prefers-color-scheme: dark){.grid{background-color:#000}}',
      '@media (width >= 1536px){.grid{grid-template-columns:repeat(6,1fr)}}',
    ])
    expect(style('grid').get('grid-template-columns')).toBe('repeat(3,1fr)')
    expect(style('grid').get('background-color')).toBeUndefined()
  })

  it('reads through @layer and @supports, and skips keyframes, hover and generated parts', () => {
    const style = styled('<a id="link" class="mui-x">Go</a>', [
      '@layer mui{.mui-x{color:#0077ad}.mui-x:hover{color:#ff0000}.mui-x::before{background:#000}}',
      '@supports (display:grid){.mui-x{display:inline-flex}}',
      '@keyframes spin{from{color:#123456}}',
    ])
    expect(style('link').get('color')).toBe('#0077ad')
    expect(style('link').get('display')).toBe('inline-flex')
    expect(style('link').get('background')).toBeUndefined()
  })

  it('matches escaped utility classes, attributes and combinators', () => {
    const style = styled('<section id="s" data-section-theme="dark"><div class="md:grid-cols-3 w-1/2" id="d"><p id="p">Hi</p></div></section>', [
      '@media (min-width:768px){.md\\:grid-cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}}',
      '.w-1\\/2{width:50%}',
      '[data-section-theme="dark"]{background-color:#1d2b2a}',
      'section > div p{font-weight:700}',
      'section > p{font-weight:300}',
    ])
    expect(style('d').get('grid-template-columns')).toBe('repeat(3,minmax(0,1fr))')
    expect(style('d').get('width')).toBe('50%')
    expect(style('s').get('background-color')).toBe('#1d2b2a')
    expect(style('p').get('font-weight')).toBe('700')
  })

  it('inherits text properties and custom properties, and reads var() by the property’s own case', () => {
    const style = styled('<div id="outer" class="theme"><a id="btn" class="btn">Start</a></div>', [
      '.theme{color:#222222;font-family:"Roboto Flex",sans-serif;--Brand-Main:#00B0FF}',
      '.btn{background-color:var(--Brand-Main);border-color:var(--missing, #e0e0e0)}',
    ])
    expect(style('btn').get('color')).toBe('#222222')
    expect(style('btn').get('font-family')).toBe('"Roboto Flex",sans-serif')
    expect(style('btn').get('background-color')).toBe('#00b0ff')
    expect(style('btn').get('border-color')).toBe('#e0e0e0')
  })
})

describe('values', () => {
  it('reads hex, rgb, hsl and named colors, with their strength', () => {
    expect(siteImportColorOf('#0af')).toEqual({ r: 0, g: 170, b: 255, a: 1 })
    expect(siteImportColorOf('rgb(22, 28, 33)')).toMatchObject({ r: 22, g: 28, b: 33, a: 1 })
    expect(siteImportColorOf('rgba(0 0 0 / 50%)')).toMatchObject({ a: 0.5 })
    expect(siteImportHex(siteImportColorOf('hsl(200, 100%, 50%)') as never)).toBe('#00aaff')
    expect(siteImportColorOf('transparent')).toMatchObject({ a: 0 })
    expect(siteImportColorOf('whitesmoke')).toMatchObject({ r: 245, g: 245, b: 245 })
  })

  it('reads a background: its color, a gradient’s stops, or a photo', () => {
    const background = siteImportBackgroundOf(
      new Map([
        ['background-color', 'rgb(22, 28, 33)'],
        ['background-image', 'linear-gradient(242deg, rgb(0, 144, 217) 0%, rgb(122, 92, 240) 55%, #e040fb 100%)'],
      ]),
    )
    expect(siteImportHex(background.color as never)).toBe('#161c21')
    expect(background.gradient).toHaveLength(3)
    expect(siteImportBackgroundOf(new Map([['background', 'url("/hero.jpg") center / cover no-repeat']])).image).toBe('/hero.jpg')
    expect(siteImportBackgroundOf(new Map([['background-color', 'transparent']])).color).toBeNull()
  })

  it('reads a border only when one is drawn', () => {
    expect(siteImportHasBorder(new Map([['border', '1px solid'], ['border-color', 'rgba(0, 0, 0, 0.12)']]))).toBe(true)
    expect(siteImportHasBorder(new Map([['border', '0']]))).toBe(false)
    expect(siteImportHasBorder(new Map([['border', '0px solid']]))).toBe(false)
    expect(siteImportHasBorder(new Map([['border', 'none']]))).toBe(false)
  })

  it('reads the sides a border is drawn on, each with its width and color (AGL-4138)', () => {
    const step = siteImportBorderSides(new Map([['border-top', '3px solid'], ['border-color', '#00b0ff']]))
    expect(Object.keys(step)).toEqual(['top'])
    expect(step.top?.width).toBe(3)
    expect(step.top?.color && siteImportHex(step.top.color)).toBe('#00b0ff')
    expect(Object.keys(siteImportBorderSides(new Map([['border', '1px solid'], ['border-color', 'rgba(0, 0, 0, 0.12)']])))).toEqual(['top', 'right', 'bottom', 'left'])
    expect(Object.keys(siteImportBorderSides(new Map([['border', '1px solid'], ['border-top', 'none']])))).toEqual(['right', 'bottom', 'left'])
    expect(Object.keys(siteImportBorderSides(new Map([['border-style', 'solid'], ['border-width', '0 0 1px 0']])))).toEqual(['bottom'])
    expect(siteImportBorderSides(new Map([['border', '0px solid']]))).toEqual({})
  })

  it('reads a box’s aspect ratio, and a color as it shows over its ground (AGL-4138)', () => {
    expect(siteImportAspectRatio('16 / 9')).toBeCloseTo(16 / 9, 6)
    expect(siteImportAspectRatio('16/9')).toBeCloseTo(16 / 9, 6)
    expect(siteImportAspectRatio('1.5')).toBe(1.5)
    expect(siteImportAspectRatio('auto 4 / 3')).toBeCloseTo(4 / 3, 6)
    expect(siteImportAspectRatio('auto')).toBeNull()
    expect(siteImportAspectRatio(undefined)).toBeNull()
    expect(siteImportHex(siteImportOpaque(siteImportColorOf('rgba(0, 0, 0, 0.6)') as never))).toBe('#666666')
    expect(siteImportColorDistance(siteImportColorOf('#e040fb') as never, siteImportColorOf('#e040fb') as never)).toBe(0)
    expect(siteImportColorDistance(siteImportColorOf('#000000') as never, siteImportColorOf('#ffffff') as never)).toBeCloseTo(1, 2)
  })

  it('resolves a picture’s aspect-ratio and height through the cascade, a wider screen’s rule over a phone’s (AGL-4138)', () => {
    const style = styled('<div id="frame" class="frame"><img id="img" class="pic" src="/a.jpg" alt=""></div>', [
      '.frame{aspect-ratio:4 / 3} @media (min-width:900px){.frame{aspect-ratio:16 / 9}} .pic{height:220px} @media (min-width:1200px){.pic{height:320px}}',
    ])
    expect(style('frame').get('aspect-ratio')).toBe('16 / 9')
    expect(style('img').get('height')).toBe('320px')
  })

  it('reads a grid template as relative widths, in twelfths', () => {
    expect(siteImportGridColumns('repeat(3, 1fr)')).toEqual([1, 1, 1])
    expect(siteImportGridColumns('420fr 788fr')).toEqual([420, 788])
    expect(siteImportGridColumns('repeat(3, minmax(0, 1fr))')).toEqual([1, 1, 1])
    expect(siteImportGridColumns('220px repeat(8, 1fr)')).toHaveLength(9)
    expect(siteImportGridColumns('none')).toBeNull()
    expect(siteImportTwelfths([420, 788])).toEqual([4, 8])
    expect(siteImportTwelfths([1, 1, 1])).toEqual([1, 1, 1])
    expect(siteImportTwelfths([7, 5])).toEqual([7, 5])
  })

  it('names a font by its family, the system and generic ones left out, and Google Fonts’ by their address', () => {
    expect(siteImportFontFamilies('"Roboto Flex","Roboto Flex Fallback",-apple-system,BlinkMacSystemFont,sans-serif')).toEqual(['Roboto Flex', 'Roboto Flex Fallback'])
    expect(siteImportGoogleFamilies(['https://fonts.googleapis.com/css2?family=Fraunces:wght@600&family=Work+Sans:wght@400;500&display=swap'])).toEqual(['Fraunces', 'Work Sans'])
  })
})

describe('aglyn.com, through its own stylesheet', () => {
  it('reads the sections’ backgrounds as the home page draws them', () => {
    const { url } = SITE_LAYOUT_PAGES.home
    const page = extractSiteImportPage(siteLayoutRecording('home'), url, siteLayoutSameSite('home'), { structure: true })
    const structure = page.structure as NonNullable<typeof page.structure>
    const styles = siteImportStylesOf(structure, siteImportCssOf(structure.styles))
    const sections = structure.elements.filter((element) => element.tag === 'section' && element.region === 'main')
    const fills = sections.map((section) => {
      const color = siteImportBackgroundOf(styles.of(section.id)).color
      return color ? siteImportHex(color) : null
    })
    expect(fills).toEqual(['#ffffff', '#f5f5f5', '#ffffff', '#f5f5f5', '#ffffff', '#f5f5f5', '#ffffff', '#f5f5f5', '#f5f5f5', '#f5f5f5', '#161c21'])
    expect(siteImportBackgroundOf(styles.of((sections[10] as { id: number }).id)).gradient).toHaveLength(3)
  })
})

describe('a screen wider than the page is read at (AGL-4083)', () => {
  const sheet = ['.box{width:100%}@media (min-width:1536px){.box{max-width:1536px}}']
  const page = extractSiteImportPage('<html><head></head><body><div id="a" class="box">words</div></body></html>', PAGE, sameSite, { structure: true })
  const structure = page.structure as NonNullable<typeof page.structure>
  const at = (viewport?: number) => siteImportStylesOf(structure, siteImportCssOf(sheet, viewport)).of(structure.elements.find((entry) => entry.attrs.id === 'a')?.id as number)

  it('applies a cap only a wider screen sees when it is asked for that screen, and not at the read width', () => {
    expect(at().get('max-width')).toBeUndefined()
    expect(at(SITE_IMPORT_CSS_WIDE_WIDTH).get('max-width')).toBe('1536px')
  })
})

describe('a page’s dark scheme (AGL-4152)', () => {
  const color = (css: string, tag = 'p', cls = '', scheme: 'light' | 'dark' = 'dark') => {
    const parsed = siteImportCssOf([css], undefined, { scheme })
    const structure = { root: { attrs: {} }, elements: [{ id: 0, tag: 'body', parent: -1, children: [1], region: 'main', nav: false, attrs: {} }, { id: 1, tag, parent: 0, children: [], region: 'main', nav: false, attrs: cls ? { class: cls } : {} }] } as never
    return { rules: parsed.darkRules, color: siteImportStylesOf(structure, parsed).of(1).get('color') }
  }

  it('reads a prefers-color-scheme: dark rule only on a dark read', () => {
    const css = 'p { color: #111111; } @media (prefers-color-scheme: dark) { p { color: #eeeeee; } }'
    expect(color(css)).toEqual({ rules: 1, color: '#eeeeee' })
    expect(color(css, 'p', '', 'light')).toEqual({ rules: 0, color: '#111111' })
    expect(color('p { color: #111111; } @media (prefers-color-scheme: light) { p { color: #222222; } }')).toEqual({ rules: 0, color: '#111111' })
  })

  it('lifts a dark mark off a selector, as a class or a data attribute on the root', () => {
    for (const mark of ['.dark', 'html.dark', '.dark-mode', ':root.dark', 'html[data-theme="dark"]', '[data-theme*=dark]', '[data-mui-color-scheme="dark"]', 'body.dark']) {
      expect([mark, color(`.card { color: #111111; } ${mark} .card { color: #eeeeee; }`, 'div', 'card')]).toEqual([mark, { rules: 1, color: '#eeeeee' }])
      // A light read leaves the rule to the mark no element has.
      expect([mark, color(`.card { color: #111111; } ${mark} .card { color: #eeeeee; }`, 'div', 'card', 'light').color]).toEqual([mark, '#111111'])
    }
  })

  it('outranks the same rule of the light scheme, wherever the sheet sets it', () => {
    expect(color('.dark .card { color: #eeeeee; } .card { color: #111111; }', 'div', 'card').color).toBe('#eeeeee')
  })

  it('takes a mark standing alone as the root’s, so its custom properties reach every rule', () => {
    expect(color(':root { --ink: #111111; } .dark { --ink: #eeeeee; } p { color: var(--ink); }').color).toBe('#eeeeee')
  })

  it('never reads a class that only sounds dark', () => {
    expect(color('.darker .card { color: #eeeeee; } .card { color: #111111; }', 'div', 'card')).toEqual({ rules: 0, color: '#111111' })
  })

  it('finds none in aglyn.com’s Home: its dark palette is in its script', () => {
    const page = extractSiteImportPage(siteLayoutRecording('home'), SITE_LAYOUT_PAGES.home.url, siteLayoutSameSite('home'), { structure: true })
    expect(siteImportCssOf(page.structure?.styles ?? [], undefined, { scheme: 'dark' }).darkRules).toBe(0)
  })
})

describe('where a grid places its children (AGL-4152)', () => {
  const style = (entries: Record<string, string>) => new Map(Object.entries(entries))
  const grid = (entries: Record<string, string> = {}) => style({ display: 'grid', 'grid-template-columns': 'repeat(3, 1fr)', ...entries })
  const box = (rowStart: number, columnStart: number, rowEnd: number, columnEnd: number) => ({ rowStart, columnStart, rowEnd, columnEnd })

  it('counts a template’s tracks, a repeat of a calculation opened, the screen’s own count unknown', () => {
    expect(siteImportGridTrackCount('minmax(calc(4vw - 11px), 1fr) repeat(24, minmax(0, calc((1500px - (11px * 23)) / 24))) minmax(calc(4vw - 11px), 1fr)')).toBe(26)
    expect(siteImportGridTrackCount('[full-start] 1fr [mid] repeat(2, 1fr 2fr) [full-end]')).toBe(5)
    expect(siteImportGridTrackCount('repeat(auto-fill, minmax(240px, 1fr))')).toBeNull()
    expect(siteImportGridTrackCount(undefined)).toBeNull()
    expect(siteImportGridTrackCount('none')).toBeNull()
  })

  it('reads every way a child is placed, lines from the end included', () => {
    const boxes = siteImportGridBoxes(grid({ 'grid-template-rows': 'repeat(4, auto)' }), [
      style({ 'grid-area': '1 / 2 / 3 / 4' }),
      style({ 'grid-row': '3', 'grid-column': '1' }),
      style({ 'grid-row-start': '3', 'grid-row-end': 'span 2', 'grid-column-start': '2', 'grid-column-end': '-1' }),
      style({ 'grid-row': '1 / -1', 'grid-column': '1 / span 1' }),
    ])
    expect(boxes).toEqual([box(1, 2, 3, 4), box(3, 1, 4, 2), box(3, 2, 5, 4), box(1, 1, 5, 2)])
  })

  it('reads named areas from the container’s own template', () => {
    const container = style({ display: 'grid', 'grid-template-areas': '"a a b" "c c b"' })
    expect(siteImportGridBoxes(container, [style({ 'grid-area': 'b' }), style({ 'grid-area': 'a' }), style({ 'grid-area': 'c' })])).toEqual([box(1, 3, 3, 4), box(1, 1, 2, 3), box(2, 1, 3, 3)])
  })

  it('places the children it does not name as a browser would, `order` first', () => {
    expect(siteImportGridBoxes(grid(), [style({}), style({ 'grid-column': '2 / 4', 'grid-row': '1' }), style({}), style({ order: '-1' })])).toEqual([box(2, 1, 3, 2), box(1, 2, 2, 4), box(2, 2, 3, 3), box(1, 1, 2, 2)])
    expect(siteImportGridBoxes(grid(), [style({ 'grid-column': '2' }), style({ 'grid-column': '1' })])).toEqual([box(1, 2, 2, 3), box(2, 1, 3, 2)])
  })

  it('says nothing where no child says where it goes: a width alone, or the whole row, places nothing', () => {
    expect(siteImportGridBoxes(grid(), [style({ 'grid-column': '1 / -1' }), style({}), style({})])).toBeNull()
    expect(siteImportGridBoxes(grid(), [style({ 'grid-column': 'span 2' }), style({ 'grid-column': 'span 1' })])).toBeNull()
    expect(siteImportGridBoxes(grid(), [style({}), style({})])).toBeNull()
  })

  it('says nothing where it cannot place the rest as a browser would', () => {
    expect(siteImportGridBoxes(grid({ 'grid-template-columns': 'repeat(auto-fill, 100px)' }), [style({ 'grid-row': '2' }), style({})])).toBeNull()
    expect(siteImportGridBoxes(grid({ 'grid-auto-flow': 'column' }), [style({ 'grid-row': '2' }), style({})])).toBeNull()
    expect(siteImportGridBoxes(grid(), [style({ 'grid-row': 'content-start' }), style({ 'grid-column': 'main' })])).toBeNull()
  })

  it('keeps the placement properties through the cascade, as a wide screen reads them', () => {
    const read = styled(
      '<div id="box"><p id="a">One</p></div>',
      ['#a { grid-area: 3/2/5/10; order: 2 } @media (min-width: 768px) { #a { grid-area: 2/2/6/26; order: 1 } } #box { grid-template-rows: repeat(2, auto); grid-template-areas: "x"; grid-auto-flow: row }'],
    )
    expect(read('a').get('grid-area')).toBe('2/2/6/26')
    expect(read('a').get('order')).toBe('1')
    expect(read('box').get('grid-template-rows')).toBe('repeat(2, auto)')
    expect(read('box').get('grid-template-areas')).toBe('"x"')
    expect(read('box').get('grid-auto-flow')).toBe('row')
  })
})
