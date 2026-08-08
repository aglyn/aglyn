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

import { hostPublicOrigin, resolveEntryCategoryName } from '@aglyn/aglyn/server'
import {
  tenantDataTag,
  withRenderCache,
} from '@aglyn/tenant-data-admin/render-cache'
import getCollectionContent from '@aglyn/tenant-runtime/get-collection-content'
import getHost from '../../../utils/get-host'

export const dynamic = 'force-dynamic'

/**
 * Feed readers poll relentlessly, and every poll re-read the collection and
 * its entries (AGL-1302). The rendered XML is a pure function of the host
 * doc and the collection's published entries, so it caches whole for 5
 * minutes under the `tenant-data:{hostId}` tag every publish busts. A
 * missing collection is never cached — creating one shows up immediately.
 */
const RSS_TTL_SECONDS = 300

const escapeXml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * RSS feed for a content collection (AGL-81):
 * `/api/collections-rss?host={subdomain|cname}&collection={slug}`.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const host = url.searchParams.get('host') ?? ''
  const collectionSlug = url.searchParams.get('collection') ?? ''
  if (!host || !collectionSlug) {
    return new Response('Missing host or collection', { status: 400 })
  }
  const hostRes = await getHost({ host })
  if (hostRes.error || !hostRes.host) {
    return new Response('Not found', { status: 404 })
  }

  // The site's public origin, not the domain the request arrived on — see the
  // longer note in `../sitemap/route.ts` (AGL-1160). It matters more here: a
  // feed's `<guid>` is the identity a reader stores, so a URL that changes with
  // the requesting domain re-announces every old entry as new.
  //
  // Computed BEFORE the cache and folded into its key (AGL-1302): the
  // header fallback is the one impurity in this response, so it must never
  // leak INTO a cached body another origin could then be served.
  const base =
    hostPublicOrigin(hostRes.host) ??
    `https://${request.headers.get('host') ?? host}`

  let xml: string | null
  try {
    xml = await withRenderCache({
      key: ['tenant-rss', hostRes.host.$id, collectionSlug, base],
      revalidate: RSS_TTL_SECONDS,
      tags: [tenantDataTag(hostRes.host.$id)],
      read: () => buildRssXml(hostRes.host.$id, collectionSlug, base),
      store: (value) => value !== null,
    })
  } catch (error) {
    console.error(error)
    xml = await buildRssXml(hostRes.host.$id, collectionSlug, base)
  }
  if (xml === null) return new Response('Not found', { status: 404 })

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/rss+xml',
      // CDN-cache for 5 minutes, serve stale up to an hour while refreshing
      // (AGL-1302). See the measured note in `../sitemap/route.ts`
      // (AGL-1160): production overrode this header, so the read savings
      // come from the tagged data cache above, not from here — the header
      // states the intent for any front that honors it.
      'Cache-Control': 's-maxage=300, stale-while-revalidate=3600',
    },
  })
}

/**
 * The rendered feed, or null when the slug names no content collection.
 * Pure function of published data + `base`, which is what makes it safe to
 * cache whole.
 */
async function buildRssXml(
  hostId: string,
  collectionSlug: string,
  base: string,
): Promise<string | null> {
  const content = await getCollectionContent({ hostId, collectionSlug })
  if (!content.collection) return null

  const categories = content.collection.categories
  const items = content.entries
    .map(
      (entry) =>
        '  <item>\n' +
        `    <title>${escapeXml(entry.title)}</title>\n` +
        `    <link>${base}/${collectionSlug}/${entry.slug}</link>\n` +
        `    <guid>${base}/${collectionSlug}/${entry.slug}</guid>\n` +
        (entry.publishedAt
          ? `    <pubDate>${new Date(entry.publishedAt.seconds * 1000).toUTCString()}</pubDate>\n`
          : '') +
        (entry.excerpt
          ? `    <description>${escapeXml(entry.excerpt)}</description>\n`
          : '') +
        // Entry model v2 (AGL-582): category + tags ride along as RSS
        // <category> elements. The category name resolves against the
        // collection's taxonomy (categoryId first, legacy fallback).
        [resolveEntryCategoryName(entry, categories), ...(entry.tags ?? [])]
          .filter((value): value is string => Boolean(value))
          .map((value) => `    <category>${escapeXml(value)}</category>\n`)
          .join('') +
        '  </item>',
    )
    .join('\n')

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0"><channel>\n' +
    `  <title>${escapeXml(content.collection.displayName)}</title>\n` +
    `  <link>${base}/${collectionSlug}</link>\n` +
    `  <description>${escapeXml(content.collection.displayName)}</description>\n` +
    items +
    '\n</channel></rss>\n'

  return xml
}
