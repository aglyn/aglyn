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
 * Pages recorded with their layout (AGL-4106), for the specs of the layout,
 * menu and stylesheet readers, and for the compile and fidelity specs that
 * read what they find.
 *
 * `site-layout/` holds five pages of aglyn.com as AglynBot read them on
 * 2026-10-28 and 2026-10-29 (home, product, pricing, contact, one blog post)
 * and one page in the markup a Squarespace site is built with, written for
 * these specs about a studio that does not exist, so the readers are never
 * tuned to one site's markup.
 *
 * The aglyn.com recordings keep what the `aglyn-com/` ones dropped and the
 * layout is made of: class names, inline icons and the page's own stylesheet.
 * Each was trimmed before it entered the repo: script bodies are gone (one
 * small inline script with a hostile line stands in for them; the
 * structured data stays), so are preload links, `data-*` attributes and
 * `srcset`s; the stylesheet keeps only the rules for classes the page uses
 * and the properties the readers read; class names the kept rules do not name
 * are dropped, a grid framework's own hints kept; the pricing page keeps the
 * first 14 rows of its plan table, and the product, pricing, contact and blog
 * pages their header menu without its panels and their footer's © line. The
 * home page keeps its header and footer whole, for the menu reader. Every
 * address, phone number, author and profile is a placeholder.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(__dirname, 'site-layout')

export const SITE_LAYOUT_AGLYN_ORIGIN = 'https://aglyn.com'
export const SITE_LAYOUT_POTTERY_ORIGIN = 'https://www.tidewater-pottery.example'

/** The recorded pages, by name: the file and the address it was read from. */
export const SITE_LAYOUT_PAGES = {
  home: { file: 'aglyn-home.html', url: `${SITE_LAYOUT_AGLYN_ORIGIN}/` },
  product: { file: 'aglyn-product.html', url: `${SITE_LAYOUT_AGLYN_ORIGIN}/product` },
  pricing: { file: 'aglyn-pricing.html', url: `${SITE_LAYOUT_AGLYN_ORIGIN}/pricing` },
  contact: { file: 'aglyn-contact.html', url: `${SITE_LAYOUT_AGLYN_ORIGIN}/contact` },
  post: { file: 'aglyn-blog-post.html', url: `${SITE_LAYOUT_AGLYN_ORIGIN}/blog/multi-site-cost-sheet-2026` },
  pottery: { file: 'squarespace-pottery.html', url: `${SITE_LAYOUT_POTTERY_ORIGIN}/` },
} as const

export type SiteLayoutPageName = keyof typeof SITE_LAYOUT_PAGES

const cache = new Map<string, string>()

/** One recorded page's markup. */
export function siteLayoutRecording(name: SiteLayoutPageName): string {
  const { file } = SITE_LAYOUT_PAGES[name]
  const held = cache.get(file)
  if (held !== undefined) return held
  const text = readFileSync(join(DIR, file), 'utf8')
  cache.set(file, text)
  return text
}

/** Whether an address is on the recorded page's own site. */
export function siteLayoutSameSite(name: SiteLayoutPageName): (url: URL) => boolean {
  const origin = new URL(SITE_LAYOUT_PAGES[name].url).origin
  const bare = origin.replace('://www.', '://')
  const www = origin.replace('://', '://www.').replace('://www.www.', '://www.')
  return (url) => url.origin === origin || url.origin === bare || url.origin === www
}
