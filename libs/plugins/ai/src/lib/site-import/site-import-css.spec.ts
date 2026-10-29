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
  siteImportBackgroundOf,
  siteImportColorOf,
  siteImportCssOf,
  siteImportFontFamilies,
  siteImportGridColumns,
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
