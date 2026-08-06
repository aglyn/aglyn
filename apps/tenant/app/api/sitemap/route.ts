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
  hostCollectionKind,
  hostPublicOrigin,
  isScreenIndexable,
  isSearchDiscouraged,
  screenRoutePathToUrl,
} from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import getCollectionTemplateScreenIds from '@aglyn/tenant-runtime/collection-template-screens'
import getHost from '../../../utils/get-host'

export const dynamic = 'force-dynamic'

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/**
 * The XML envelope, shared by the normal path and the discouraged-site early
 * return (AGL-1263) so an empty sitemap is a real, well-formed sitemap.
 */
function sitemapResponse(urls: string[]): Response {
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    // De-duplicated (AGL-582): a collection slug can shadow a screen path.
    [...new Set(urls)]
      .map((item) => `  <url><loc>${escapeXml(item)}</loc></url>`)
      .join('\n') +
    '\n</urlset>\n'

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml',
      // MEASURED 2026-08-04: this header is OVERRIDDEN and has no effect.
      // Production returns `public, max-age=0, must-revalidate` here, on
      // `collections-rss`, on `robots` and on ordinary pages alike — so the
      // value below has never reached a CDN, and neither did the
      // `s-maxage=3600` it replaced.
      //
      // What actually caches this route is Vercel's own revalidation, at
      // **60 s**, measured by polling `age`: it climbs to ~60, flips to
      // `x-vercel-cache: STALE`, then resets — twice, exactly 60 s apart.
      // Which is the same window every page uses, so a sitemap is never more
      // stale than the site it describes.
      //
      // Kept rather than deleted because it states the intent correctly and
      // costs nothing; do NOT treat it as the thing producing the 60 s.
      // AGL-1160 was filed believing this header made the sitemap an HOUR
      // stale. It never did.
      'Cache-Control': 's-maxage=60, stale-while-revalidate=60',
    },
  })
}

/**
 * Per-host sitemap (SEO Toolkit): the middleware rewrites
 * `{tenant-site}/sitemap.xml` here with the resolved tenant host. URLs come
 * from the host routing map — the published screens a crawler may index
 * (AGL-1263).
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
  // It is also what lets this response be cached at all. A cache keys on the
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

  const hostRef = firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostRes.host.$id)

  // Search discouraged site-wide (AGL-1263): a valid but EMPTY sitemap, not a
  // 404. The file still exists and still parses, so a crawler that already
  // knows the URL — or Search Console, which keeps asking — reads "nothing
  // here" instead of an error it will retry. Returning early also skips every
  // read below, which is the whole cost of this route.
  if (isSearchDiscouraged(hostRes.host)) return sitemapResponse([])

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
  }

  // Collection template screens are not pages (AGL-1267) — the router now
  // refuses to serve them, so listing them here would submit URLs that 404.
  // Before the router fix they were worse than dead: a second, duplicate URL
  // for `/{collection}` and `/{collection}/{entry}`, whose body was raw
  // `{{entry.*}}` tokens. The de-dupe at `sitemapResponse` cannot catch that —
  // the paths differ, only the rendering is the same page.
  for (const screenId of await getCollectionTemplateScreenIds({
    hostId: hostRes.host.$id,
  })) {
    excluded.add(screenId)
  }

  const urls = Object.entries(hostRes.host.screens ?? {})
    .filter(([screenId]) => !excluded.has(screenId))
    .map(([, path]) => `${base}${screenRoutePathToUrl(path)}`)
    .sort()

  // Commerce URLs (AGL-299): active product + collection pages join the
  // sitemap when the host has the matching template configured.
  try {
    const storeSettings = await hostRef.collection('settings').doc('store').get()
    if (storeSettings.get('pdpScreenId')) {
      const products = await hostRef.collection('products').limit(500).get()
      for (const docSnapshot of products.docs) {
        const raw = docSnapshot.data() as any
        if (raw.deletedAt || raw.status !== 'active' || !raw.slug) continue
        urls.push(`${base}/products/${raw.slug}`)
      }
    }
    if (storeSettings.get('collectionScreenId')) {
      const collections = await hostRef.collection('collections').limit(250).get()
      for (const docSnapshot of collections.docs) {
        const raw = docSnapshot.data() as any
        // Content collections share this path and serve at /{slug}, not
        // /collections/{slug} (AGL-954) — listing them here published a URL
        // that resolves to nothing.
        if (hostCollectionKind(raw) !== 'catalog') continue
        if (raw.slug) urls.push(`${base}/collections/${raw.slug}`)
      }
    }
  } catch {
    // Sitemap stays screens-only if commerce reads fail.
  }

  // Content collections & blog (AGL-582): /{collection} lists and their
  // published /{collection}/{entry} articles join the sitemap. Bounded
  // reads, fail-open — a content read failure never takes the sitemap down.
  try {
    const collections = await hostRef.collection('collections').limit(50).get()
    for (const docSnapshot of collections.docs) {
      const raw = docSnapshot.data() as any
      // Skip commerce's product collections — they have no `entries` and
      // serve under /collections/{slug} instead (AGL-954).
      if (hostCollectionKind(raw) !== 'content') continue
      const collectionSlug = raw.slug
      if (!collectionSlug) continue
      urls.push(`${base}/${collectionSlug}`)
      const entries = await docSnapshot.ref
        .collection('entries')
        .where('status', '==', 'published')
        .limit(200)
        .get()
      for (const entryDoc of entries.docs) {
        const entrySlug = (entryDoc.data() as any).slug
        if (entrySlug) urls.push(`${base}/${collectionSlug}/${entrySlug}`)
      }
    }
  } catch {
    // Sitemap stays screens-only if content reads fail.
  }

  return sitemapResponse(urls)
}
