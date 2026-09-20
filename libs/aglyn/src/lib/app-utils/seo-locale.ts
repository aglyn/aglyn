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
 * WHAT LANGUAGE A PAGE IS IN, answered once (AGL-3148).
 *
 * Three surfaces need this answer and none of them had it: `og:locale` and
 * `og:locale:alternate` were absent from every page type on the platform,
 * and `inLanguage` was absent from every JSON-LD node. The fourth surface,
 * `<link rel="alternate" hreflang>`, has had its own copy of the fallback
 * since AGL-164.
 *
 * They must agree. A page that declares `en` in its markup, `fr` in its Open
 * Graph and nothing in its structured data has told three readers three
 * things, and the one that matters — which language a searcher should be
 * served — is the one they disagree about. So the chain lives here and every
 * surface reads it.
 */

/**
 * The language a page is in when nothing on the site says otherwise.
 *
 * NOT a guess: it is the language the document actually declares. The
 * `lang` attribute is no longer the literal `"en"` it was when this constant
 * was written — `apps/tenant/app/[host]/layout.tsx` resolves it through
 * `resolvePageLocale` and the two host-agnostic boundaries beside the root
 * layout emit THIS value (AGL-3153) — so the coupling now runs the honest
 * way round: the markup takes its answer from here rather than this constant
 * restating a literal somewhere else.
 *
 * That is what keeps `og:locale` safe to emit unconditionally. A page derived
 * from this chain can only ever repeat what the same chain put in the
 * document's own `lang`.
 *
 * ⚠️ Still PINNED to that attribute, in the direction that is now true: this
 * resolver is its SOURCE. A surface that needs a fallback language reads this
 * constant; it never writes a second default of its own, and changing this
 * value changes what every untranslated site declares.
 *
 * ⚠️ `<html lang>` is the SITE's language, not the screen's. A layout is the
 * deepest thing that can render `<html>`, and no layout has the slug the
 * screen is resolved from, so a locale variant's own language reaches the
 * metadata surfaces below — which call this resolver WITH a screen — and not
 * the document element. `apps/tenant/app/[host]/layout.tsx` records why
 * closing that gap would cost the catch-all's ISR window.
 */
export const PLATFORM_DEFAULT_LOCALE = 'en'

/** The hreflang key for "no locale of its own", as `alternates.languages` spells it. */
export const LOCALE_X_DEFAULT = 'x-default'

/**
 * A language tag, or nothing.
 *
 * Validated rather than trusted: these values reach a `<meta>` and a JSON-LD
 * document, and a locale field is free text in Firestore. An unparseable one
 * is dropped so the chain falls through to the next candidate — a page with a
 * corrupt locale emits the site's language, never the corruption.
 *
 * Accepts `language[-Script][-REGION]` — `en`, `en-GB`, `zh-Hant`,
 * `zh-Hant-TW`, `es-419` — in any casing, and returns it in the canonical
 * BCP-47 casing so two spellings of one locale cannot read as two locales.
 */
export function normalizeLocaleTag(
  value: string | null | undefined,
): string | undefined {
  if (typeof value !== 'string') return undefined
  // `_` is the Open Graph separator and `-` the BCP-47 one; a stored value may
  // legitimately arrive in either, and both name the same locale.
  const raw = value.trim().replace(/_/g, '-')
  if (!raw) return undefined
  const match =
    /^([A-Za-z]{2,3})(?:-([A-Za-z]{4}))?(?:-([A-Za-z]{2}|[0-9]{3}))?$/.exec(raw)
  if (!match) return undefined
  const [, language, script, region] = match
  return [
    language.toLowerCase(),
    script ? script[0].toUpperCase() + script.slice(1).toLowerCase() : undefined,
    region ? region.toUpperCase() : undefined,
  ]
    .filter(Boolean)
    .join('-')
}

/** The screen and host fields the language of a page is decided from. */
export interface PageLocaleSources {
  /** The screen being rendered — its `locale` is the most specific answer. */
  screen?: { locale?: string } | null
  /** The host document — `defaultLocale`, then the first of `locales`. */
  host?: { defaultLocale?: string; locales?: string[] } | null
}

/**
 * The language THIS page is written in.
 *
 * Most specific first: the screen says what it was written in, the site says
 * what it defaults to, and the platform default answers for the sites — today
 * every one of them — that have configured neither.
 *
 * Never returns `undefined`. A page is always in some language, and a reader
 * that finds no answer assumes one anyway; saying which one out loud is
 * strictly more information than leaving it to be guessed.
 */
export function resolvePageLocale(sources: PageLocaleSources): string {
  return (
    normalizeLocaleTag(sources.screen?.locale) ??
    normalizeLocaleTag(sources.host?.defaultLocale) ??
    normalizeLocaleTag(sources.host?.locales?.[0]) ??
    PLATFORM_DEFAULT_LOCALE
  )
}

/**
 * A language tag in the form Open Graph spells it — `en_GB`, not `en-GB`.
 *
 * The one transformation, kept beside the normalizer so the two forms cannot
 * drift: `alternates.languages` keys stay BCP-47 because that is what
 * `hreflang` takes, and `og:locale` takes the underscore form.
 */
export function toOpenGraphLocale(
  value: string | null | undefined,
): string | undefined {
  const tag = normalizeLocaleTag(value)
  return tag ? tag.replace(/-/g, '_') : undefined
}

/**
 * The OTHER languages this page exists in, as `og:locale:alternate` values.
 *
 * Derived from the very keys that drive `alternates.languages`, deliberately,
 * rather than from the site's configured `locales`: a language reaches that
 * map only once its translated screen resolves to a real routed path, so
 * every value returned here has a page behind it. A site that lists `fr`
 * among its locales but has translated nothing advertises no French card.
 *
 * `x-default` is dropped — it is a routing instruction, not a language — and
 * so is the page's own locale, which `og:locale` already carries.
 */
export function openGraphAlternateLocales(
  languageKeys: readonly string[] | null | undefined,
  pageLocale?: string,
): string[] {
  const own = toOpenGraphLocale(pageLocale)
  const alternates = new Set<string>()
  for (const key of languageKeys ?? []) {
    if (key === LOCALE_X_DEFAULT) continue
    const tag = toOpenGraphLocale(key)
    if (tag && tag !== own) alternates.add(tag)
  }
  return [...alternates]
}
