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
 * What reads as a call to action (AGL-4152): an element's own `--primary` or
 * `--secondary`, and never a skip link.
 */

import { extractSiteImportPage } from './site-import-html'
import { siteImportButtonStyleOf } from './site-import-layout'
import { siteImportNavTree, type SiteImportFrameSource } from './site-import-nav'
import { SITE_READ_ORIGIN, SITE_READ_VARS_THEME_URL, siteReadPage, siteReadVarsThemeSheets } from './fixtures/site-layout-recordings'

const sameSite = (url: URL) => url.origin === SITE_READ_ORIGIN
const varsTheme = () => extractSiteImportPage(siteReadPage('vars-theme.html'), SITE_READ_VARS_THEME_URL, sameSite, { structure: true }) as SiteImportFrameSource
const sheetsOf = () => siteReadVarsThemeSheets().map((sheet) => sheet.text)

describe('a button’s class hints', () => {
  const element = (className: string) => ({ id: 0, tag: 'a', parent: -1, children: [], region: 'main', nav: false, attrs: { class: className }, blocks: [] }) as never

  it('reads an element’s `--primary` as filled and its `--secondary` as outlined, with nothing of its stylesheet read', () => {
    expect(siteImportButtonStyleOf(element('btn btn--primary'), new Map(), '#ffffff')).toBe('primary')
    expect(siteImportButtonStyleOf(element('site-button--secondary'), new Map(), '#ffffff')).toBe('secondary')
    expect(siteImportButtonStyleOf(element('card-button button-element--primary'), new Map(), '#ffffff')).toBe('primary')
  })

  it('does not take a theme’s longer name, or a link that is no button, for one', () => {
    expect(siteImportButtonStyleOf(element('btn theme-btn--primary-inverse'), new Map(), '#ffffff')).toBe('quiet')
    expect(siteImportButtonStyleOf(element('nav-link--primary'), new Map(), '#ffffff')).toBeNull()
  })

  it('lets what the page draws decide over the hint', () => {
    const outlined = new Map([['border', '2px solid #112233'], ['padding', '12px 24px']])
    const filled = new Map([['background-color', '#112233'], ['padding', '12px 24px']])
    expect(siteImportButtonStyleOf(element('btn btn--secondary'), filled, '#ffffff')).toBe('primary')
    expect(siteImportButtonStyleOf(element('btn btn--primary'), outlined, '#ffffff')).toBe('primary')
  })
})

describe('a skip link', () => {
  const nav = (header: string, sheets: string[] = []) => {
    const read = extractSiteImportPage(`<html><body><header>${header}</header><main><h1>Hi</h1></main></body></html>`, SITE_READ_VARS_THEME_URL, sameSite, { structure: true })
    return siteImportNavTree(read as SiteImportFrameSource, sheets)
  }

  it('is never a call to action, drawn as a button or not, by its words or its class', () => {
    const tree = siteImportNavTree(varsTheme(), sheetsOf())
    expect(tree?.ctas.map((cta) => cta.label)).toEqual(['Book a call'])
    expect(tree?.items.map((item) => item.label)).toEqual(['Services', 'About'])
    const byClass = nav('<a class="btn btn--primary skip-nav" href="#main">Jump ahead</a><nav><a href="/a">A</a><a href="/b">B</a></nav><a class="btn btn--primary" href="/c">Call</a>')
    expect(byClass?.ctas.map((cta) => cta.label)).toEqual(['Call'])
  })

  it('leaves a button that goes to a place on the page, and one that merely says “skip” elsewhere', () => {
    const tree = nav('<nav><a href="/a">A</a><a href="/b">B</a></nav><a class="btn btn--primary" href="#quote">Get a quote</a><a class="btn btn--secondary" href="/skip-hire">Skip hire</a>')
    expect(tree?.ctas.map((cta) => cta.label)).toEqual(['Get a quote', 'Skip hire'])
  })

  it('takes the strongest drawing of a button the header holds twice', () => {
    const tree = nav('<nav><a href="/a">A</a><a href="/b">B</a></nav><a class="btn btn--secondary" href="/c">Call</a><a class="btn btn--primary" href="/c">Call</a>')
    expect(tree?.ctas).toEqual([expect.objectContaining({ label: 'Call', style: 'primary' })])
  })
})
