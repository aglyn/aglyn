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
 * The rendered page title (AGL-1341).
 *
 * ## The bug this ends
 *
 * Every head built its title the same way — `{page}{separator}{host title}` —
 * so the host's SEO title was an unconditional SUFFIX rather than a fallback.
 * On a site whose titles are written to be self-contained that reads the brand
 * twice and blows the budget:
 *
 * ```
 * Aglyn — the visual builder with a real platform underneath-Website Builder - Create Your Own Websites - Aglyn
 * ```
 *
 * 111 characters, of which Google shows about 60 — so the distinctive half is
 * exactly the half that gets cut. `Title*` and `Separator*` are both REQUIRED
 * in Host Setup → SEO, so no setting could switch this off; it had to be the
 * rule that changed.
 *
 * ## The rule
 *
 * 1. An **authored** SEO title wins **verbatim** — a screen's `seo.title`, an
 *    entry's `seoTitle`. Someone typed those into a field labelled "Title"
 *    with a 60-character counter beside it; appending to them overrides the
 *    only person who knows what the page is called.
 * 2. Otherwise the page's **name** (screen `displayName`, entry headline,
 *    collection or category name) composes with the site title, separator in
 *    between. This is what keeps the fallback path branded — and, more to the
 *    point, DISTINCT: falling straight back to the host title would give every
 *    untitled screen on a site the same `<title>`, which is a worse SEO defect
 *    than the one being fixed.
 * 3. The separator appears only with a live value on BOTH sides. A page with a
 *    name and no site title, or a site title and no name, renders the one it
 *    has; a page with neither renders the caller's `fallback`. No head ever
 *    emits a leading separator or an empty `<title>`.
 *
 * Empty and whitespace-only are ABSENT, not set — the console writes `''` for
 * a cleared field (AGL-1191), and a title of `'   '` is not a title.
 *
 * The brand does not disappear from the head: `og:site_name` still carries the
 * site title on every page, which is where a consumer looks for it.
 *
 * ## Why a shared function
 *
 * Four surfaces composed this independently — the screen branch, the
 * collection branch, the built-in gated pages and the search page — and they
 * had already drifted (the search page hard-coded an en dash and ignored the
 * host's separator entirely). One rule in one place is what makes the answer
 * uniform for the fifth surface nobody has written yet.
 */

/** Trimmed, or `''` for anything that is not a live string. */
function clean(value?: string | null): string {
  return typeof value === 'string' ? value.trim() : ''
}

export interface SeoTitleOptions {
  /**
   * The page's own AUTHORED title (screen `seo.title`, entry `seoTitle`).
   * Rendered verbatim when set — nothing is appended to it.
   */
  title?: string | null
  /**
   * What the page is CALLED when nobody authored a title for it: a screen's
   * `displayName`, an entry's headline, a collection or category name. This is
   * the side the site title joins.
   */
  name?: string | null
  /** The host's `seo.title` (or `displayName`) — the site-level fallback. */
  siteTitle?: string | null
  /** The host's `seo.separator`; padded and defaulted, see below. */
  separator?: string | null
  /**
   * Last resort for a page with no name and a site that named itself nothing.
   * Callers pass a brand-resolved string (never a hard-coded "Aglyn" — a
   * white-label site must not leak the platform brand into its `<title>`).
   */
  fallback?: string | null
}

/**
 * The separator, padded.
 *
 * The field caps at 3 characters and hosts type a bare `-`, which joined
 * without padding produced `…open web-Website Builder…` — two titles run
 * together into one word. Padding is applied around whatever was typed (and a
 * separator that is only whitespace is no separator), so an author who typed
 * `|` gets ` | ` and one who typed `·` gets ` · `.
 */
function padSeparator(separator?: string | null): string {
  return ` ${clean(separator) || '–'} `
}

/**
 * Resolves the `<title>` (and the matching `og:title`) for a page.
 *
 * See the module docblock for the rule; the short version is that `title` is
 * an override and `siteTitle` is a fallback, never a suffix.
 */
export function resolveSeoTitle(options: SeoTitleOptions): string {
  const authored = clean(options.title)
  if (authored) return authored

  const name = clean(options.name)
  const siteTitle = clean(options.siteTitle)
  // Both sides live: this is the only case that renders a separator.
  if (name && siteTitle) return `${name}${padSeparator(options.separator)}${siteTitle}`
  return name || siteTitle || clean(options.fallback)
}
