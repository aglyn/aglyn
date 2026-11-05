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
 * `site-layout/` holds four pages of aglyn.com as AglynBot read them on
 * 2026-10-28 and 2026-10-29 (product, pricing, contact, one blog post), its
 * home page as it read on 2026-11-05, which the 11/5 Keep my site import fell
 * short on (AGL-4152), its pricing page again as it read on 2026-11-01, which a live import fell
 * short on (`livePricing`), its blog listing as it read on 2026-11-03, whose
 * cards crop their pictures to a height of their own (`blog`, AGL-4138), and
 * one page in the markup a Squarespace site is built with, written for these
 * specs about a studio that does not exist, so the readers are never tuned to
 * one site's markup.
 * A bakery that does not exist either, in the markup a WordPress block theme
 * writes, shows a film of every kind the reader reads (AGL-4140): a
 * `<video>` playing behind its opening, a YouTube frame, a `lite-youtube`
 * facade, a card's picture linking a Vimeo page, and an `og:video` in its
 * head.
 * A garden firm that does not exist either, in the markup a visual grid builder
 * writes (AGL-4152), places every block with a rule of its own on a 24-column
 * grid, inside a `min-width` query: `grid-services` shows three cards and a row
 * of pictures, `swapped-grid` a page whose written order is not the order a
 * visitor reads, so each card's words sit after the next card's heading.
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
 * blog listing keeps its first page of posts, a featured one and six cards,
 * without its search box and its newsletter band, inside the blog post's
 * header and footer. The home page keeps its header and footer whole, for
 * the menu reader. Every address, phone number, author and profile is a
 * placeholder.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(__dirname, 'site-layout')

export const SITE_LAYOUT_AGLYN_ORIGIN = 'https://aglyn.com'
export const SITE_LAYOUT_POTTERY_ORIGIN = 'https://www.tidewater-pottery.example'
export const SITE_LAYOUT_BAKERY_ORIGIN = 'https://www.hearth-bakery.example'
export const SITE_LAYOUT_GARDEN_ORIGIN = 'https://www.fern-and-stone.example'

/** The recorded pages, by name: the file and the address it was read from. */
export const SITE_LAYOUT_PAGES = {
  home: { file: 'aglyn-home.html', url: `${SITE_LAYOUT_AGLYN_ORIGIN}/` },
  product: { file: 'aglyn-product.html', url: `${SITE_LAYOUT_AGLYN_ORIGIN}/product` },
  pricing: { file: 'aglyn-pricing.html', url: `${SITE_LAYOUT_AGLYN_ORIGIN}/pricing` },
  livePricing: { file: 'aglyn-pricing-2026-11.html', url: `${SITE_LAYOUT_AGLYN_ORIGIN}/pricing` },
  contact: { file: 'aglyn-contact.html', url: `${SITE_LAYOUT_AGLYN_ORIGIN}/contact` },
  post: { file: 'aglyn-blog-post.html', url: `${SITE_LAYOUT_AGLYN_ORIGIN}/blog/multi-site-cost-sheet-2026` },
  blog: { file: 'aglyn-blog.html', url: `${SITE_LAYOUT_AGLYN_ORIGIN}/blog` },
  pottery: { file: 'squarespace-pottery.html', url: `${SITE_LAYOUT_POTTERY_ORIGIN}/` },
  bakery: { file: 'video-bakery.html', url: `${SITE_LAYOUT_BAKERY_ORIGIN}/` },
  gridServices: { file: 'grid-services.html', url: `${SITE_LAYOUT_GARDEN_ORIGIN}/` },
  swappedGrid: { file: 'swapped-grid.html', url: `${SITE_LAYOUT_GARDEN_ORIGIN}/plans` },
} as const

export type SiteLayoutPageName = keyof typeof SITE_LAYOUT_PAGES

/**
 * Pages written for the reads of a site's brand and its forms (AGL-4152),
 * about a bookkeeper that does not exist and in the markup of no builder, so
 * the readers are never tuned to one site. They are not scored against a build
 * as the pages above are.
 *
 * `vars-theme` links five stylesheets, saved beside it in `vars-theme/`: four
 * of a site kit's shared widgets, whose loud colors are nobody's brand, then
 * the site's own, the last link, whose colors and fonts are custom properties
 * (comma triples and the modern spaced syntax) and whose buttons are styled
 * through `:is()` and `:where()`. `json-form` has no `<form>`: its fields are
 * JSON a script block holds, beside two arrays that only look like fields.
 */
export const SITE_READ_ORIGIN = 'https://www.harbor-lane.example'

export const SITE_READ_VARS_THEME_URL = `${SITE_READ_ORIGIN}/`
export const SITE_READ_JSON_FORM_URL = `${SITE_READ_ORIGIN}/contact`

/** A written page's markup, by its file in `site-layout/`. */
export const siteReadPage = (file: 'vars-theme.html' | 'json-form.html'): string => readFileSync(join(DIR, file), 'utf8')

/** The `vars-theme` page's stylesheets, by the address its markup links each from, in link order. */
export const siteReadVarsThemeSheets = (): Array<{ url: string; text: string }> =>
  [
    ['https://cdn.sitekit.example/universal/reset.css', 'reset.css'],
    ['https://cdn.sitekit.example/components/gallery.css', 'gallery.css'],
    ['https://cdn.sitekit.example/components/map.css', 'map.css'],
    ['https://cdn.sitekit.example/components/booking.css', 'booking.css'],
    ['https://assets.sitekit.example/sites/4182/site.css', 'site.css'],
  ].map(([url, file]) => ({ url: url as string, text: readFileSync(join(DIR, 'vars-theme', file as string), 'utf8') }))

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
