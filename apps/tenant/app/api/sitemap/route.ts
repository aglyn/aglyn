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

import {
  collectionCategorySlug,
  collectionListUrl,
  contentSitemapSection,
  contentSitemapSectionSlug,
  hostCollectionKind,
  hostPublicOrigin,
  isScreenIndexable,
  isSearchDiscouraged,
  parseSitemapSectionPath,
  screenRoutePathToUrl,
  sitemapIndexXml,
  sitemapPageCount,
  sitemapSectionPath,
  sitemapUrlsetXml,
  SITEMAP_SECTION_CATALOG,
  SITEMAP_SECTION_PAGES,
  SITEMAP_SECTION_PRODUCTS,
  SITEMAP_URLS_PER_FILE,
  type AglynHost,
} from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  tenantDataTag,
  withRenderCache,
} from '@aglyn/tenant-data-admin/render-cache'
import getTemplateScreenIds from '@aglyn/tenant-runtime/template-screens'
import getHost from '../../../utils/get-host'

export const dynamic = 'force-dynamic'

/**
 * The sweeps below read whole collections — crawlers plus verification traffic
 * hit these routes constantly (AGL-1302). Cached for 5 minutes under the same
 * `tenant-data:{hostId}` tag every publish busts, so a sitemap reflects a
 * publish IMMEDIATELY — the TTL only bounds writes that never announce
 * themselves. That keeps AGL-1160's intent (revalidation on publish) while
 * restoring cacheability.
 */
const SITEMAP_TTL_SECONDS = 300

/**
 * How many collection documents the index will look at. A site's collections
 * are its content sections, so this is the number of child sitemaps a content
 * site can advertise, not a number of pages.
 */
const COLLECTION_SCAN_LIMIT = 500

/** One XML response shape, so every path answers with the same headers. */
function xmlResponse(xml: string): Response {
  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml',
      // MEASURED 2026-08-04 (AGL-1160): this header was OVERRIDDEN in
      // production — Vercel returned `public, max-age=0, must-revalidate`
      // here, on `collections-rss`, on `robots` and on ordinary pages alike,
      // and cached the route under its own ~60s revalidation instead. So do
      // not treat this value as the thing a CDN necessarily honors; the
      // read-amplification fix that actually holds is the tagged data cache
      // around each sweep (AGL-1302), which works regardless of what the CDN
      // does. The header still states the intent — CDN-cache for 5 minutes,
      // serve stale for up to an hour while refreshing, never cache in the
      // browser — for any front that does respect it.
      'Cache-Control': 's-maxage=300, stale-while-revalidate=3600',
    },
  })
}

/**
 * Per-host sitemaps (SEO Toolkit). The middleware rewrites
 * `{tenant-site}/sitemap.xml` and `{tenant-site}/sitemaps/{section}/{page}.xml`
 * here with the resolved tenant host.
 *
 * `/sitemap.xml` is a sitemap INDEX (AGL-2520); every URL lives in a child
 * sitemap addressed by section — pages, products, catalog, and one per content
 * collection — each paging at `SITEMAP_URLS_PER_FILE`. A flat file had no
 * answer for a site outgrowing the protocol's 50,000-URL cap, and the
 * per-section reads it forced were the whole cost of this route: one crawler
 * fetch swept every screen, product, collection and entry the site had.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const host = String(
    request.headers.get('x-aglyn-tenant-host') ??
      url.searchParams.get('host') ??
      '',
  )
  if (!host) return new Response('Missing host', { status: 400 })

  const hostRes = await getHost({ host })
  if (hostRes.error || !hostRes.host) {
    return new Response('Not found', { status: 404 })
  }

  // The `<loc>` base is the site's PUBLIC origin, not the domain this request
  // happened to arrive on (AGL-1160). Deriving it from the `Host` header meant
  // the sitemap contradicted the page's own `<link rel="canonical">`, which
  // `[host]/[[...slug]]/page.tsx` already builds from `hostPublicOrigin` — so a
  // site reachable on both its custom domain and `.aglyn.app` published two
  // different answers about where it lives. A preview deployment was worse
  // still: it emitted a sitemap full of `*.vercel.app` URLs.
  //
  // It is also what lets these responses be cached at all. A cache keys on the
  // URL, never the `Host` header, and `demo.aglyn.app`, `app.aglyn.com` and
  // every preview host all rewrite to `/api/sitemap?host=demo` — one key, three
  // bases. Reading the origin from the host record removes the header from the
  // output, so the response becomes a pure function of the URL.
  //
  // The header stays as a fallback only for a host record carrying neither a
  // cname nor a subdomain; `hostPublicOrigin` returns undefined there rather
  // than inventing a half-built URL.
  const base =
    hostPublicOrigin(hostRes.host) ??
    `https://${String(request.headers.get('host') ?? host)}`

  // Search discouraged site-wide (AGL-1263): a valid but EMPTY sitemap, not a
  // 404 and not an index. The file still exists and still parses, so a crawler
  // that already knows the URL — or Search Console, which keeps asking — reads
  // "nothing here" instead of an error it will retry. An empty `<urlset>` is
  // what that has always been and what an index would have to degrade to
  // anyway, since an index whose children are all empty still advertises them.
  // Returning early also skips every read below, which is the whole cost.
  if (isSearchDiscouraged(hostRes.host)) return xmlResponse(sitemapUrlsetXml([]))

  // Which child sitemap was asked for, or none of them — `/sitemap.xml` itself,
  // which is the index.
  //
  // The incoming path is read FIRST because a route handler behind a rewrite
  // sees the ORIGINAL request URL (measured against a production-mode server,
  // AGL-1501). `sitemapPath` is the middleware's copy of that same path, and
  // covers the other direction: a rewrite that DOES replace the URL a handler
  // sees would otherwise turn every child sitemap into the index.
  const requested =
    parseSitemapSectionPath(url.pathname) ??
    parseSitemapSectionPath(url.searchParams.get('sitemapPath') ?? '')
  const section = requested?.section ?? ''
  const page = requested?.page ?? 1

  try {
    const { xml } = await withRenderCache({
      key: ['tenant-sitemap', hostRes.host.$id, base, section, String(page)],
      revalidate: SITEMAP_TTL_SECONDS,
      tags: [tenantDataTag(hostRes.host.$id)],
      read: () => buildSitemap(hostRes.host, base, section, page),
      // A sweep that lost one of its fail-open reads still SERVES (partial
      // beats absent, matching the pre-cache behavior), but replaying the
      // gap for the whole TTL would widen a blip into minutes — degraded
      // sweeps are never stored.
      store: (value) => !value.degraded,
    })
    return xmlResponse(xml)
  } catch (error) {
    console.error(error)
    const { xml } = await buildSitemap(hostRes.host, base, section, page)
    return xmlResponse(xml)
  }
}

/** The document for one request: the index, or one section's page. */
async function buildSitemap(
  host: AglynHost,
  base: string,
  section: string,
  page: number,
): Promise<{ xml: string; degraded: boolean }> {
  if (!section) {
    const index = await buildSitemapIndex(host, base)
    // A site with nothing to submit answers with an empty `<urlset>` rather
    // than an empty `<sitemapindex>`: both are degenerate documents, but the
    // urlset is the one AGL-1263 already established here and the one a
    // crawler reads as "this site has no URLs" instead of "this index is
    // broken".
    return {
      xml: index.locs.length
        ? sitemapIndexXml(index.locs)
        : sitemapUrlsetXml([]),
      degraded: index.degraded,
    }
  }
  const sweep = await buildSectionUrls(host, base, section, page)
  return { xml: sitemapUrlsetXml(sweep.urls), degraded: sweep.degraded }
}

function hostRefOf(hostId: string) {
  return firebaseAdmin.app().firestore().collection('hosts').doc(hostId)
}

/**
 * Every content collection the index and the section builders address, read
 * once. Projected to the three fields both of them use — a collection document
 * also carries its schema and its template bindings, none of which a sitemap
 * has any use for.
 */
async function readCollections(hostId: string) {
  return hostRefOf(hostId)
    .collection('collections')
    .select('slug', 'kind', 'categories')
    .limit(COLLECTION_SCAN_LIMIT)
    .get()
}

/**
 * The child sitemaps this site publishes.
 *
 * Counts come from `count()` aggregations, which bill a fraction of a read
 * each rather than one per document — the index must know how many pages a
 * section has without sweeping it. A count can run slightly AHEAD of the URLs
 * a section really emits, because a soft-deleted product or an entry with no
 * slug is dropped in memory and no query can express that; the effect is a
 * final child sitemap that is short, or in the exact-boundary case empty. An
 * empty `<urlset>` is a valid document, so that costs a crawler one fetch and
 * nothing else.
 */
async function buildSitemapIndex(
  host: AglynHost,
  base: string,
): Promise<{ locs: string[]; degraded: boolean }> {
  let degraded = false
  const hostRef = hostRefOf(host.$id)
  const sections: Array<{ section: string; pages: number }> = []

  // Screens are the routing map plus a projection read, which the section
  // itself also does — there is no aggregation that can answer "how many of
  // these are indexable", because the exclusions are a set built from three
  // sources the query language cannot express.
  const pages = await buildPageUrls(host, base)
  degraded ||= pages.degraded
  sections.push({
    section: SITEMAP_SECTION_PAGES,
    pages: sitemapPageCount(pages.urls.length),
  })

  try {
    const storeSettings = await hostRef.collection('settings').doc('store').get()
    if (storeSettings.get('pdpScreenId')) {
      const count = (
        await hostRef
          .collection('products')
          .where('status', '==', 'active')
          .count()
          .get()
      ).data().count
      sections.push({
        section: SITEMAP_SECTION_PRODUCTS,
        pages: sitemapPageCount(count),
      })
    }
    if (storeSettings.get('collectionScreenId')) {
      const count = (
        await hostRef
          .collection('collections')
          .where('kind', '==', 'catalog')
          .count()
          .get()
      ).data().count
      sections.push({
        section: SITEMAP_SECTION_CATALOG,
        pages: sitemapPageCount(count),
      })
    }
  } catch {
    // The index stays screens-only if commerce reads fail, matching the
    // fail-open the flat sweep had.
    degraded = true
  }

  try {
    const collections = await readCollections(host.$id)
    // Entry counts are independent, so they overlap instead of queueing: one
    // round trip of latency for a site with many collections rather than one
    // per collection.
    const counted = await Promise.all(
      collections.docs
        .filter((docSnapshot) => {
          // Commerce's product collections have no `entries` and serve under
          // /collections/{slug} instead (AGL-954).
          if (hostCollectionKind(docSnapshot.data() as any) !== 'content') {
            return false
          }
          return Boolean((docSnapshot.data() as any).slug)
        })
        .map(async (docSnapshot) => {
          const raw = docSnapshot.data() as any
          const entries = (
            await docSnapshot.ref
              .collection('entries')
              .where('status', '==', 'published')
              .count()
              .get()
          ).data().count
          return { slug: String(raw.slug), entries }
        }),
    )
    for (const { slug, entries } of counted) {
      // At least one file, always: the listing URL itself lives on page 1 and
      // exists whether or not anything has been published into the collection.
      sections.push({
        section: contentSitemapSection(slug),
        pages: Math.max(1, sitemapPageCount(entries)),
      })
    }
  } catch {
    // The index stays screens-and-commerce if content reads fail.
    degraded = true
  }

  const locs: string[] = []
  for (const { section, pages: pageCount } of sections) {
    for (let page = 1; page <= pageCount; page += 1) {
      locs.push(`${base}${sitemapSectionPath(section, page)}`)
    }
  }
  return { locs, degraded }
}

/** One section's page of URLs. An unknown section is an empty sitemap. */
async function buildSectionUrls(
  host: AglynHost,
  base: string,
  section: string,
  page: number,
): Promise<{ urls: string[]; degraded: boolean }> {
  if (section === SITEMAP_SECTION_PAGES) {
    const sweep = await buildPageUrls(host, base)
    return { urls: pageOf(sweep.urls, page), degraded: sweep.degraded }
  }
  if (section === SITEMAP_SECTION_PRODUCTS) {
    return buildProductUrls(host.$id, base, page)
  }
  if (section === SITEMAP_SECTION_CATALOG) {
    return buildCatalogUrls(host.$id, base, page)
  }
  const collectionSlug = contentSitemapSectionSlug(section)
  if (collectionSlug) {
    return buildContentUrls(host.$id, base, collectionSlug, page)
  }
  return { urls: [], degraded: false }
}

/** The slice of an in-memory list one child sitemap carries. */
function pageOf(urls: string[], page: number): string[] {
  const start = (page - 1) * SITEMAP_URLS_PER_FILE
  return urls.slice(start, start + SITEMAP_URLS_PER_FILE)
}

/**
 * Screens minus the ones a crawler must not be handed. Paged in memory: the
 * source is `host.screens`, the routing map that already travels with the host
 * document, so there is nothing to page at the query.
 */
async function buildPageUrls(
  host: AglynHost,
  base: string,
): Promise<{ urls: string[]; degraded: boolean }> {
  let degraded = false
  const hostRef = hostRefOf(host.$id)

  // Screens that are not indexable must not be submitted (AGL-1263). The
  // routing map is every PUBLISHED screen, which is not the same set: an
  // unlisted page carries `noindex` in its own head, and listing it here
  // meant the site contradicted itself about that page. Password-protected,
  // members-only and private screens were listed too — URLs that answer a
  // crawler with a gate.
  //
  // `select('visibility')` keeps this a projection over exactly the field the
  // predicate reads; the doc id it also needs always travels with a snapshot.
  const excluded = new Set<string>()

  // Started before the screens read and collected after it, so it overlaps
  // rather than adding a round trip. Never rejects, so a floating promise here
  // cannot become an unhandled rejection.
  const templateScreenIdsPromise = getTemplateScreenIds({ hostId: host.$id })

  try {
    const screenDocs = await hostRef
      .collection('screens')
      .select('visibility')
      .limit(1000)
      .get()
    for (const docSnapshot of screenDocs.docs) {
      if (!isScreenIndexable(docSnapshot.data() as any)) {
        excluded.add(docSnapshot.id)
      }
    }
  } catch {
    // Fail OPEN, matching robots.txt: a read failure must not blank a working
    // sitemap. The pages' own `noindex` still holds.
    degraded = true
  }

  // Template screens are not pages (AGL-1267, AGL-1270) — the router now
  // refuses to serve them, so listing them here would submit URLs that 404.
  // Before the router fix they were worse than dead: a second, duplicate URL
  // for `/{collection}` and `/{collection}/{entry}`, whose body was raw
  // `{{entry.*}}` tokens. The de-dupe in `sitemapUrlsetXml` cannot catch that —
  // the paths differ, only the rendering is the same page.
  //
  // The commerce templates (AGL-1270) made that duplication provable right
  // here: `pdpScreenId`'s own slug was emitted as an ordinary screen URL, and
  // the products section ALSO emits every `/products/{slug}` that same
  // template renders. Excluding it keeps the real catalog URLs and drops the
  // token-rendering twin.
  for (const screenId of await templateScreenIdsPromise) {
    excluded.add(screenId)
  }

  // Error screens are not pages either (AGL-2486). `aglyn.com` published
  // `/401`, `/404` and `/503` into its sitemap, which hands a brand-new domain
  // the worst possible first crawl: Google fetches them, gets the status code
  // each one exists to represent, and logs crawl errors and soft-404s against
  // a site it has never seen before. Measured on production 2026-08-23, the
  // sitemap carried all three among 97 URLs.
  //
  // BOTH sources are excluded, because the binding is not how these exist
  // today. `resolveNotFoundScreenId` records that `errorScreens` was unset on
  // EVERY host as of 2026-08-19, and that an error screen on this platform is
  // simply a screen published at the status path — so filtering only the
  // bound ids would have changed nothing on the site that has the problem.
  // Filtering only the path would miss a host that did bind one.
  const errorScreens = (host as unknown as {
    errorScreens?: Record<string, string | undefined>
    notFoundScreenId?: string
  } | null) ?? {}
  for (const bound of [
    ...Object.values(errorScreens.errorScreens ?? {}),
    errorScreens.notFoundScreenId,
  ]) {
    if (typeof bound === 'string' && bound) excluded.add(bound)
  }
  for (const [screenId, path] of Object.entries(host.screens ?? {})) {
    // A bare HTTP status code as the whole path. Anchored so a real page at
    // `/404-guide` or `/products/503` keeps its place in the sitemap.
    if (/^\/?[1-5][0-9][0-9]$/.test(String(path))) excluded.add(screenId)
  }

  const urls = Object.entries(host.screens ?? {})
    .filter(([screenId]) => !excluded.has(screenId))
    .map(([, path]) => `${base}${screenRoutePathToUrl(path)}`)
    .sort()

  return { urls, degraded }
}

/**
 * Commerce product pages (AGL-299), ordered by document id so a page number
 * addresses the same slice on every fetch. `offset` bills the documents it
 * skips, which is the price of addressable pages over a query that has no
 * stable cursor to hand a crawler; it is bounded by the page number the index
 * advertised, and the whole response is cached.
 */
async function buildProductUrls(
  hostId: string,
  base: string,
  page: number,
): Promise<{ urls: string[]; degraded: boolean }> {
  const urls: string[] = []
  try {
    const hostRef = hostRefOf(hostId)
    const storeSettings = await hostRef.collection('settings').doc('store').get()
    if (!storeSettings.get('pdpScreenId')) return { urls, degraded: false }
    const products = await hostRef
      .collection('products')
      .where('status', '==', 'active')
      .orderBy('__name__')
      .offset((page - 1) * SITEMAP_URLS_PER_FILE)
      .limit(SITEMAP_URLS_PER_FILE)
      .get()
    for (const docSnapshot of products.docs) {
      const raw = docSnapshot.data() as any
      // Soft deletes keep `status: 'active'` (see the commerce catalog reader),
      // so this half of the filter has to happen in memory.
      if (raw.deletedAt || !raw.slug) continue
      urls.push(`${base}/products/${raw.slug}`)
    }
  } catch {
    return { urls, degraded: true }
  }
  return { urls, degraded: false }
}

/** Commerce catalog collection pages — `/collections/{slug}` (AGL-954). */
async function buildCatalogUrls(
  hostId: string,
  base: string,
  page: number,
): Promise<{ urls: string[]; degraded: boolean }> {
  const urls: string[] = []
  try {
    const hostRef = hostRefOf(hostId)
    const storeSettings = await hostRef.collection('settings').doc('store').get()
    if (!storeSettings.get('collectionScreenId')) {
      return { urls, degraded: false }
    }
    const collections = await hostRef
      .collection('collections')
      .where('kind', '==', 'catalog')
      .orderBy('__name__')
      .offset((page - 1) * SITEMAP_URLS_PER_FILE)
      .limit(SITEMAP_URLS_PER_FILE)
      .get()
    for (const docSnapshot of collections.docs) {
      const raw = docSnapshot.data() as any
      if (raw.slug) urls.push(`${base}/collections/${raw.slug}`)
    }
  } catch {
    return { urls, degraded: true }
  }
  return { urls, degraded: false }
}

/**
 * One content collection's sitemap (AGL-582): the listing, its category
 * listings, and its published entries.
 *
 * The listing and the categories ride on PAGE 1 on top of that page's entries
 * rather than displacing them, so an entry's page number is a plain function
 * of its position — `floor(index / SITEMAP_URLS_PER_FILE) + 1` — and page 1
 * simply runs a handful of URLs long. The alternative was to offset every
 * entry by however many categories the collection happens to have, which makes
 * the whole collection's pagination shift the moment an author adds a category.
 */
async function buildContentUrls(
  hostId: string,
  base: string,
  collectionSlug: string,
  page: number,
): Promise<{ urls: string[]; degraded: boolean }> {
  const urls: string[] = []
  try {
    const found = await hostRefOf(hostId)
      .collection('collections')
      .where('slug', '==', collectionSlug)
      .limit(1)
      .get()
    const docSnapshot = found.docs[0]
    if (!docSnapshot) return { urls, degraded: false }
    const raw = docSnapshot.data() as any
    if (hostCollectionKind(raw) !== 'content') return { urls, degraded: false }

    if (page === 1) {
      urls.push(`${base}/${collectionSlug}`)
      // Category listings (AGL-1321). Free: `categories` is a field on the
      // collection doc already read, so no extra round trip — and a filtered
      // listing that no page links to from a crawlable position would
      // otherwise depend entirely on the pill row being reached.
      const categories = Array.isArray(raw.categories) ? raw.categories : []
      for (const category of categories) {
        const categorySlug =
          collectionCategorySlug(category?.id) ||
          collectionCategorySlug(category?.name)
        if (!categorySlug) continue
        urls.push(`${base}${collectionListUrl({ collectionSlug, categorySlug })}`)
      }
    }

    // `select('slug')` for the same reason the screens read carries one: a
    // sitemap needs an address per entry and nothing else, while an entry
    // document carries the whole post body. Firestore bills the document
    // either way, so this buys no reads — it stops thousands of articles'
    // worth of prose crossing the wire and being deserialized to build a list
    // of URLs.
    const entries = await docSnapshot.ref
      .collection('entries')
      .where('status', '==', 'published')
      .orderBy('__name__')
      .select('slug')
      .offset((page - 1) * SITEMAP_URLS_PER_FILE)
      .limit(SITEMAP_URLS_PER_FILE)
      .get()
    for (const entryDoc of entries.docs) {
      const entrySlug = (entryDoc.data() as any).slug
      if (entrySlug) urls.push(`${base}/${collectionSlug}/${entrySlug}`)
    }
  } catch {
    return { urls, degraded: true }
  }
  return { urls, degraded: false }
}
