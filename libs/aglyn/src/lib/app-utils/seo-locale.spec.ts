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
 * The one answer to "what language is this page in" (AGL-3148).
 *
 * `og:locale`, `og:locale:alternate` and every JSON-LD `inLanguage` read this,
 * and `alternates.languages` is built from the same map — so what these pin is
 * that four surfaces cannot come back saying different things.
 */

import {
  LOCALE_X_DEFAULT,
  PLATFORM_DEFAULT_LOCALE,
  normalizeLocaleTag,
  openGraphAlternateLocales,
  resolvePageLocale,
  toOpenGraphLocale,
} from './seo-locale'

describe('normalizeLocaleTag', () => {
  it('canonicalizes the casing of every subtag', () => {
    // Two spellings of one locale must not read as two locales.
    expect(normalizeLocaleTag('EN')).toBe('en')
    expect(normalizeLocaleTag('en-gb')).toBe('en-GB')
    expect(normalizeLocaleTag('ZH-hant-tw')).toBe('zh-Hant-TW')
    expect(normalizeLocaleTag('es-419')).toBe('es-419')
  })

  it('accepts the Open Graph separator as well as the BCP-47 one', () => {
    // A stored value may legitimately arrive in either form, and both name
    // the same locale.
    expect(normalizeLocaleTag('en_GB')).toBe('en-GB')
  })

  it('drops a value that is not a language tag', () => {
    // These reach a `<meta>` and a JSON-LD document, and the field is free
    // text in Firestore. A corrupt value must fall through to the next
    // candidate rather than be published.
    for (const bad of [
      '',
      '   ',
      'english',
      'en-US-x-private-everything',
      'en/GB',
      '<script>',
      null,
      undefined,
      42 as unknown as string,
    ]) {
      expect(normalizeLocaleTag(bad)).toBeUndefined()
    }
  })
})

describe('resolvePageLocale', () => {
  it('prefers the screen, then the site default, then the site list', () => {
    expect(
      resolvePageLocale({
        screen: { locale: 'fr-CA' },
        host: { defaultLocale: 'de', locales: ['es'] },
      }),
    ).toBe('fr-CA')
    expect(
      resolvePageLocale({ host: { defaultLocale: 'de', locales: ['es'] } }),
    ).toBe('de')
    expect(resolvePageLocale({ host: { locales: ['es', 'en'] } })).toBe('es')
  })

  it('falls back to the language the document actually declares', () => {
    // No host on the platform has ever set `locales` or `defaultLocale`, so
    // this is the branch every live page takes. It is not a guess: it is the
    // `lang` the root layout puts on every tenant document.
    expect(resolvePageLocale({})).toBe(PLATFORM_DEFAULT_LOCALE)
    expect(resolvePageLocale({ screen: null, host: null })).toBe(
      PLATFORM_DEFAULT_LOCALE,
    )
  })

  it('skips an unparseable value rather than publishing it', () => {
    expect(
      resolvePageLocale({
        screen: { locale: 'not a locale' },
        host: { defaultLocale: 'pt-BR' },
      }),
    ).toBe('pt-BR')
  })
})

describe('toOpenGraphLocale', () => {
  it('spells a tag the way Open Graph does', () => {
    expect(toOpenGraphLocale('en-GB')).toBe('en_GB')
    expect(toOpenGraphLocale('en')).toBe('en')
  })

  it('emits nothing for a value that is not a language tag', () => {
    expect(toOpenGraphLocale('nonsense!')).toBeUndefined()
  })
})

describe('openGraphAlternateLocales', () => {
  it('names the other languages the page exists in', () => {
    expect(openGraphAlternateLocales(['en', 'fr', 'es-MX'], 'en')).toEqual([
      'fr',
      'es_MX',
    ])
  })

  it('never repeats the page’s own locale', () => {
    // `og:locale` already carries it; listing it again as an alternate tells
    // a reader the page is a translation of itself.
    expect(openGraphAlternateLocales(['en-GB', 'fr'], 'en-gb')).toEqual(['fr'])
  })

  it('drops x-default, which is a routing instruction rather than a language', () => {
    expect(openGraphAlternateLocales([LOCALE_X_DEFAULT, 'fr'], 'en')).toEqual([
      'fr',
    ])
  })

  it('returns nothing for a page with no variants', () => {
    expect(openGraphAlternateLocales([], 'en')).toEqual([])
    expect(openGraphAlternateLocales(undefined, 'en')).toEqual([])
  })
})
