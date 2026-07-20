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

import { resolveEntryCategoryName } from '@aglyn/aglyn/server'
import getCollectionContent from '@aglyn/tenant-runtime/get-collection-content'
import getHost from '../../../utils/get-host'

export const dynamic = 'force-dynamic'

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

  const content = await getCollectionContent({
    hostId: hostRes.host.$id,
    collectionSlug,
  })
  if (!content.collection) return new Response('Not found', { status: 404 })

  const base = `https://${request.headers.get('host') ?? host}`
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

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/rss+xml',
      'Cache-Control': 's-maxage=3600, stale-while-revalidate',
    },
  })
}
