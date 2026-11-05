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

/*==========================================
 * WHICH ADDRESSES OF A SITE ARE PAGES OF ITS OWN (AGL-4152).
 *
 * A site answers at more addresses than it has pages: a gallery's `?itemId=`
 * for each photo, a home page at `/` and `/home`, its platform's empty cart.
 * Pure rules over what the reader already has, for no platform in particular:
 *
 * - **The page's own canonical.** It names another address of the site. On
 *   the same path it is believed: `/photos?itemId=1` is `/photos`. On another
 *   path, or where the query is what chooses the page (`/?page_id=12`,
 *   `/index.php?id=3`), a template that names the home page on every page is
 *   as common as the real thing, so the words have to agree.
 * - **Its main content.** The same words and photos as a page already found
 *   is the same page, whatever its address says.
 * - **A platform's screen.** A cart, checkout, account or search address that
 *   has almost nothing to say, or that the site keeps out of search. Neither
 *   signal alone: a site not yet launched keeps every page out of search, and
 *   a dealer's `/cart` can be a real page about carts.
 *=========================================*/

import type { SiteImportBlock, SiteImportExtract } from './site-import-html'

const wordsIn = (text: string) => (text.match(/[\p{L}\p{N}]+/gu) ?? []).length

/** The words a page without a photo must say for its content to be compared: two "back soon" stubs are two pages. */
const SIGNATURE_MIN_WORDS = 12

/** An address with its origin and trailing slash set aside: the site's two names are one site. */
export function siteImportAddressOf(key: string): string {
  const url = new URL(key)
  return `${url.pathname.replace(/\/+$/, '') || '/'}${url.search}`
}

/**
 * A page's main content as one string, to compare with another's: its words
 * and photos in order, its forms and its videos. `null` for a page with too
 * little on it to call the same as anything.
 */
export function siteImportContentSignature(page: Pick<SiteImportExtract, 'blocks' | 'forms' | 'videos'>): string | null {
  const lines: string[] = []
  let words = 0
  let photos = 0
  for (const block of page.blocks) {
    if (block.region !== 'main') continue
    if (block.kind === 'image') {
      photos += 1
      lines.push(`image ${block.url.split('?')[0]}`)
    } else if (!(block.kind === 'link' && block.inline)) {
      words += wordsIn(block.text)
      lines.push(`${block.kind} ${block.text.replace(/\s+/g, ' ').trim()}`)
    }
  }
  if (words < SIGNATURE_MIN_WORDS && !photos) return null
  for (const form of page.forms.kept) lines.push(`form ${form.fields.map((field) => field.label).join('|')}`)
  for (const video of page.videos ?? []) lines.push(`video ${JSON.stringify(video)}`)
  return lines.join('\n')
}

/**
 * The address a page's canonical names, when that is another page address of
 * this site; `null` when it names the page itself, another site or a file.
 */
export function siteImportCanonicalClaim(
  canonical: string | null,
  pageKey: string,
  keyOf: (url: URL) => string | null,
): string | null {
  if (!canonical) return null
  let url: URL
  try {
    url = new URL(canonical)
  } catch {
    return null
  }
  // A page served over https that still writes its canonical over http means itself.
  if (url.protocol === 'http:') url.protocol = 'https:'
  const key = keyOf(url)
  if (!key || siteImportAddressOf(key) === siteImportAddressOf(pageKey)) return null
  return key
}

/** A path whose query is what chooses the page on the older sites that have them: `/?p=5`, `/index.php?id=3`. */
const QUERY_ROUTED_PATH = /^\/$|\.(?:php\d?|aspx?|jsp|cfm|cgi|pl)$/i

/** Whether a canonical is believed on its own: it keeps the path, where a query does not choose the page. */
export function siteImportCanonicalBelieved(pageKey: string, claim: string): boolean {
  const path = (key: string) => new URL(key).pathname.replace(/\/+$/, '') || '/'
  return path(pageKey) === path(claim) && !QUERY_ROUTED_PATH.test(path(claim))
}

/** The screens a website platform makes, as the one address they sit at. Only at the top of a site: `/shop/cart` can be a product. */
const SYSTEM_SCREEN =
  /^(?:cart|cart-page|view-cart|shopping-cart|shopping-bag|bag|basket|checkout|check-out|account|accounts|my-account|myaccount|login|log-in|signin|sign-in|wishlist|search)$/
/** The screens that have screens under them. */
const SYSTEM_SECTION = /^(?:account|accounts|my-account|myaccount|checkout)$/
const LOCALE_SEGMENT = /^[a-z]{2}(?:[-_][a-z]{2})?$/
const SCRIPT_EXTENSION = /\.(?:html?|php\d?|aspx?|jsp)$/

/** More words than a screen with nothing in it says; a real page says more. */
export const SITE_IMPORT_SYSTEM_SCREEN_MAX_WORDS = 25

/** Whether the path is one a website platform keeps for its cart, checkout, account or search screens. */
export function siteImportSystemScreenPath(pathname: string): boolean {
  const segments = pathname.toLowerCase().split('/').filter(Boolean)
  if (segments[0] && segments.length > 1 && LOCALE_SEGMENT.test(segments[0])) segments.shift()
  const first = (segments[0] ?? '').replace(SCRIPT_EXTENSION, '')
  return segments.length === 1 ? SYSTEM_SCREEN.test(first) : SYSTEM_SECTION.test(first)
}

/** Whether a page is its platform's screen rather than a page of the owner's site. */
export function siteImportIsSystemScreen(
  pathname: string,
  page: { blocks: readonly SiteImportBlock[]; noindex: boolean },
): boolean {
  if (!siteImportSystemScreenPath(pathname)) return false
  if (page.noindex) return true
  const words = page.blocks.reduce(
    (total, block) => total + (block.region !== 'main' || block.kind === 'image' || (block.kind === 'link' && block.inline) ? 0 : wordsIn(block.text)),
    0,
  )
  return words <= SITE_IMPORT_SYSTEM_SCREEN_MAX_WORDS
}
