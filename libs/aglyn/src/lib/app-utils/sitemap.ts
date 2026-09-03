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
 * Sitemap addressing and XML (AGL-2520).
 *
 * A site publishes ONE sitemap index at `/sitemap.xml` and a child sitemap per
 * section — pages, products, the catalog, and one per content collection —
 * each of which pages further at {@link SITEMAP_URLS_PER_FILE}.
 *
 * The split is what makes the sitemap survive a site growing. The protocol
 * caps a single sitemap at 50,000 URLs and 50MB, and a flat file has no
 * answer once a site crosses either: the URLs past the cap are simply not
 * submitted, silently. It also makes the sweep behind each file bounded —
 * a crawler asking for `/sitemaps/content-blog/2.xml` reads one page of one
 * collection's entries instead of the whole site.
 *
 * These are pure functions on purpose: the tenant route handler that answers
 * these URLs and the middleware that routes them to it must agree on the
 * shape exactly, and so must the tests.
 */

/** Where a site's sitemap index lives; what `robots.txt` advertises. */
export const SITEMAP_INDEX_PATH = '/sitemap.xml'

/**
 * URLs per child sitemap.
 *
 * An order of magnitude under the protocol's 50,000 because the cap that
 * binds first here is not the protocol's but Firestore's: a page of this file
 * is a page of a query, and 5,000 keeps one crawler fetch to 5,000 document
 * reads and a few hundred KB of XML. Raising it trades read cost for fewer
 * files, and nothing in the format cares which side of that trade we take.
 */
export const SITEMAP_URLS_PER_FILE = 5000

/**
 * A ceiling on how many pages one section may advertise, so a runaway
 * collection cannot produce an index with tens of thousands of entries — the
 * index has its own 50,000 limit, and a sweep that large is a bug long before
 * it is a sitemap. 100 pages is 500,000 URLs in one section.
 */
export const SITEMAP_MAX_PAGES_PER_SECTION = 100

/** The fixed sections; a content collection adds one of its own. */
export const SITEMAP_SECTION_PAGES = 'pages'
export const SITEMAP_SECTION_PRODUCTS = 'products'
export const SITEMAP_SECTION_CATALOG = 'catalog'

/**
 * The prefix a content collection's section carries.
 *
 * It exists so a collection slugged `products` cannot claim the commerce
 * section, and it cannot itself collide: stripping happens ONCE, so a
 * collection actually slugged `content-products` addresses
 * `content-content-products` and stays distinct from `content-products`,
 * which is the collection slugged `products`.
 */
const CONTENT_SECTION_PREFIX = 'content-'

/** The sitemap section a content collection's URLs live in. */
export function contentSitemapSection(collectionSlug: string): string {
  return `${CONTENT_SECTION_PREFIX}${collectionSlug}`
}

/** The collection a `content-…` section names, or `undefined` for the rest. */
export function contentSitemapSectionSlug(
  section: string,
): string | undefined {
  if (!section.startsWith(CONTENT_SECTION_PREFIX)) return undefined
  const slug = section.slice(CONTENT_SECTION_PREFIX.length)
  return slug || undefined
}

/**
 * A child sitemap's path.
 *
 * The page is ALWAYS its own segment, including page 1. A one-file section is
 * the common case and could have been the bare `/sitemaps/{section}.xml`, but
 * then the page number would have to be encoded into the section name for
 * every other page — and `content-blog-2` is ambiguous between page 2 of the
 * collection `blog` and page 1 of the collection `blog-2`, which is a real
 * slug someone can create. A separate segment cannot be ambiguous, and
 * nothing but the index ever writes these URLs.
 */
export function sitemapSectionPath(section: string, page: number): string {
  return `/sitemaps/${section}/${Math.max(1, Math.floor(page))}.xml`
}

/** Matches {@link sitemapSectionPath}; the one parser, shared with the middleware. */
const SITEMAP_SECTION_PATH = /^\/sitemaps\/([^/]+)\/([0-9]+)\.xml$/

/** The section and page a path addresses, or `undefined` if it addresses none. */
export function parseSitemapSectionPath(
  pathname: string,
): { section: string; page: number } | undefined {
  const match = SITEMAP_SECTION_PATH.exec(pathname)
  if (!match) return undefined
  const page = Number(match[2])
  if (!Number.isFinite(page) || page < 1) return undefined
  return { section: decodeURIComponent(match[1]), page }
}

/**
 * How many files a section of `urlCount` URLs needs. Zero URLs means zero
 * files — a section with nothing in it is left out of the index rather than
 * advertised as an empty document a crawler has to fetch to discover is empty.
 */
export function sitemapPageCount(urlCount: number): number {
  if (!Number.isFinite(urlCount) || urlCount <= 0) return 0
  return Math.min(
    SITEMAP_MAX_PAGES_PER_SECTION,
    Math.ceil(urlCount / SITEMAP_URLS_PER_FILE),
  )
}

/** XML text escaping — a slug or a query string may carry any of these. */
export function escapeSitemapXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * A `<urlset>` document. De-duplicated (AGL-582): a collection slug can shadow
 * a screen path, and the same URL twice in one sitemap is a submission of a
 * duplicate, not a stronger signal.
 */
export function sitemapUrlsetXml(urls: readonly string[]): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    [...new Set(urls)]
      .map((item) => `  <url><loc>${escapeSitemapXml(item)}</loc></url>`)
      .join('\n') +
    '\n</urlset>\n'
  )
}

/** A `<sitemapindex>` document — the children of `/sitemap.xml`. */
export function sitemapIndexXml(locs: readonly string[]): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    [...new Set(locs)]
      .map((item) => `  <sitemap><loc>${escapeSitemapXml(item)}</loc></sitemap>`)
      .join('\n') +
    '\n</sitemapindex>\n'
  )
}
