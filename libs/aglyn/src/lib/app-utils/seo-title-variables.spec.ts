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

import { resolveSeoTitle } from './seo-title'
import {
  DEFAULT_TITLE_PATTERN,
  hasSeoTitleVariables,
  resolveSeoTitleVariables,
  SEO_TITLE_VARIABLES,
} from './seo-title-variables'

/** The real marketing host: a long site title and a bare `-`. */
const SITE = {
  'site.name': 'Website Builder - Create Your Own Websites - Aglyn',
  'site.separator': '-',
}

describe('a written title resolves to a rendered one', () => {
  it('fills every variable the catalog defines', () => {
    expect(
      resolveSeoTitleVariables(DEFAULT_TITLE_PATTERN, {
        ...SITE,
        'page.name': 'Pricing',
      }),
    ).toBe('Pricing - Website Builder - Create Your Own Websites - Aglyn')
  })

  it('leaves an unknown variable visible rather than swallowing it', () => {
    // A typo that vanished would leave a title that merely reads short, and
    // the author's next look at the live page would not show them anything
    // wrong. Visible is the version somebody notices.
    expect(
      resolveSeoTitleVariables('{{page.subtitle}} {{site.name}}', SITE),
    ).toBe(`{{page.subtitle}} ${SITE['site.name']}`)
  })

  it('drops a separator that has nothing on one side of it', () => {
    // AGL-1341's "both sides live" rule, which survives the move into a
    // pattern: a page whose name is missing would otherwise render a `<title>`
    // that begins with a dash.
    expect(
      resolveSeoTitleVariables(DEFAULT_TITLE_PATTERN, {
        'page.name': '',
        ...SITE,
      }),
    ).toBe(SITE['site.name'])
    expect(
      resolveSeoTitleVariables('{{site.name}} {{site.separator}} {{page.name}}', {
        'page.name': '',
        ...SITE,
      }),
    ).toBe(SITE['site.name'])
  })

  it('takes the spacing with an empty variable', () => {
    expect(
      resolveSeoTitleVariables('Buy {{page.name}} today', { 'page.name': '' }),
    ).toBe('Buy today')
  })

  it('stands for the separator a site actually composes with, default and all', () => {
    // An unset separator resolves to the en dash `seo-title` has padded around
    // since AGL-1341, NOT to nothing. A variable that vanished here would
    // silently change the title of every untitled page on every site that
    // never filled the field in — which is the outcome this feature is not
    // allowed to have. A site that wants no separator removes the variable.
    expect(
      resolveSeoTitleVariables(DEFAULT_TITLE_PATTERN, {
        'page.name': 'Pricing',
        'site.name': 'Aglyn',
        'site.separator': '',
      }),
    ).toBe('Pricing – Aglyn')
  })

  it('keeps the literal text around the variables', () => {
    expect(
      resolveSeoTitleVariables('Buy {{page.name}} online | {{site.name}}', {
        'page.name': 'Espresso',
        'site.name': 'Lumen',
      }),
    ).toBe('Buy Espresso online | Lumen')
  })

  it('tolerates padding inside the braces', () => {
    expect(resolveSeoTitleVariables('{{ page.name }}', { 'page.name': 'A' })).toBe('A')
  })

  it('returns a title with no variables by identity', () => {
    // The property the whole feature rests on, asserted as identity rather
    // than equality: an untouched string cannot have been touched.
    const written = 'Pricing — start free, add Aglyn AI, scale as you grow | Aglyn'
    expect(resolveSeoTitleVariables(written, SITE)).toBe(written)
    expect(hasSeoTitleVariables(written)).toBe(false)
  })

  it('offers every variable it can resolve, and resolves every one it offers', () => {
    // The catalog is what the console's picker and autocomplete draw from, so
    // a name in the menu that the renderer does not know would insert a token
    // that prints itself on the live page.
    for (const variable of SEO_TITLE_VARIABLES) {
      expect(
        resolveSeoTitleVariables(`{{${variable.name}}}`, {
          'page.name': 'N',
          'site.name': 'S',
          'site.separator': '|',
        }),
      ).not.toContain('{{')
    }
  })
})

describe('⛔ nothing renders differently because variables shipped', () => {
  const CASES = [
    { name: 'About', siteTitle: SITE['site.name'], separator: '-' },
    { name: 'About', siteTitle: SITE['site.name'], separator: null },
    { name: 'About', siteTitle: '', separator: '|' },
    { name: '', siteTitle: 'Lumen', separator: '|' },
    { name: 'Home', siteTitle: 'Lumen', separator: '·' },
  ]

  it('the default pattern composes exactly what the code did', () => {
    // `DEFAULT_TITLE_PATTERN` is the previous hard-coded composition said in
    // tokens. If the two ever disagree, every untitled page on every site
    // changes its `<title>` the moment a site saves its SEO tab — which is the
    // one outcome this feature is not allowed to have.
    for (const options of CASES) {
      expect([options, resolveSeoTitle({ ...options, pattern: DEFAULT_TITLE_PATTERN })]).toEqual([
        options,
        resolveSeoTitle(options),
      ])
    }
  })

  it('an authored title stays verbatim, pattern or no pattern', () => {
    const authored = 'Pricing — start free, add Aglyn AI, scale as you grow | Aglyn'
    expect(
      resolveSeoTitle({
        title: authored,
        name: 'Pricing',
        siteTitle: SITE['site.name'],
        separator: '-',
        pattern: '{{site.name}} {{site.separator}} {{page.name}}',
      }),
    ).toBe(authored)
  })
})

describe('a site composes untitled pages its own way', () => {
  it('puts the site name first when the pattern says so', () => {
    expect(
      resolveSeoTitle({
        name: 'Pricing',
        siteTitle: 'Aglyn',
        separator: '—',
        pattern: '{{site.name}} {{site.separator}} {{page.name}}',
      }),
    ).toBe('Aglyn — Pricing')
  })

  it('and drops the site name entirely when it does not', () => {
    // Which is the case the marketing site wants for its home page: the brand
    // is already in front of the title there, so the trailing copy is noise.
    expect(
      resolveSeoTitle({
        name: 'Pricing',
        siteTitle: 'Aglyn',
        separator: '—',
        pattern: '{{page.name}}',
      }),
    ).toBe('Pricing')
  })

  it('falls back when a pattern resolves to nothing at all', () => {
    // An empty `<title>` is never an acceptable answer, whatever the pattern
    // says and whatever the page turned out to be missing.
    expect(
      resolveSeoTitle({
        name: '',
        siteTitle: '',
        pattern: DEFAULT_TITLE_PATTERN,
        fallback: 'Lumen site',
      }),
    ).toBe('Lumen site')
  })
})

describe('an authored title may use variables too', () => {
  it('so a page can add the brand without typing it', () => {
    expect(
      resolveSeoTitle({
        title: 'Plans and pricing {{site.separator}} {{site.name}}',
        name: 'Pricing',
        siteTitle: 'Aglyn',
        separator: '|',
      }),
    ).toBe('Plans and pricing | Aglyn')
  })

  it('and still never takes the pattern on top of itself', () => {
    expect(
      resolveSeoTitle({
        title: '{{page.name}} deals',
        name: 'Espresso',
        siteTitle: 'Lumen',
        separator: '|',
        pattern: DEFAULT_TITLE_PATTERN,
      }),
    ).toBe('Espresso deals')
  })
})
