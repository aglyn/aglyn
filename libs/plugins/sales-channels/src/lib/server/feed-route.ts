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

import type { CatalogPage, CatalogStore } from '@aglyn/aglyn/plugin-manager/plugin-product-catalog'
import { salesChannel, type SalesChannelDefinition } from '../model/channels'
import { resolveOffer } from '../model/feed-columns'
import { feedHead, feedRow, feedTail } from '../model/feed-writer'
import type { SalesChannelSettings } from '../model/settings'
import { CatalogUnavailableError, cachedPage, cachedStore, FEED_MAX_PAGES } from './catalog-source'
import { getFeed, getSettings, isDocumentId, stampFetch, tokenMatches, type FeedDocument } from './feed-store'
import { siteSells } from './site-gate'

/**
 * THE FEED A CHANNEL FETCHES (AGL-3637), on the store's own domain:
 *
 *   GET /api/sales-channels/feed/{channel}/{token}.{ext}?hostId={site}
 *
 * The token is the lock and the file name together: TikTok and Microsoft
 * want a URL that names a file, and a token in the path never lands in a
 * query-string log on the channel's side. A wrong channel, extension or
 * token, a feed switched off and a site that does not sell all answer the
 * same 404, so the URL is the only thing that tells anyone a feed exists.
 *
 * STREAMED, page by page from the cached catalog, so a large catalog is
 * never held in memory. The first page is read BEFORE the response starts:
 * a catalog that cannot be read answers 503, which every channel treats as
 * "try again later". A page that fails after that ERRORS the stream rather
 * than ending it, because a channel set to replace its products would read
 * a cleanly ended half-file as "the other half was deleted".
 *
 * Never cached by the CDN: the catalog pages are cached server-side under
 * the site's data tag, which a product edit busts; a CDN copy could not be.
 */

const textResponse = (status: number, body: string, extra?: Record<string, string>) =>
  new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  })

const notFound = () => textResponse(404, 'Not found')

/** Splits `{token}.{ext}`; `null` when it is not that shape. */
export function parseFeedFile(file: string): { token: string; extension: string } | null {
  const match = /^([A-Za-z0-9_-]{32,64})\.([a-z]{3})$/.exec(file)
  return match ? { token: match[1], extension: match[2] } : null
}

interface StreamInput {
  hostId: string
  channel: SalesChannelDefinition
  store: CatalogStore
  settings: SalesChannelSettings
  first: CatalogPage
  head: boolean
}

/** The feed as a streamed response, from a first page already in hand. */
export function feedResponse(input: StreamInput): Response {
  const { hostId, channel, store, settings, first } = input
  const headers = {
    'Content-Type': channel.contentType,
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'Content-Disposition': `inline; filename="products.${channel.extension}"`,
  }
  if (input.head) return new Response(null, { status: 200, headers })
  const encoder = new TextEncoder()
  const rows = (page: CatalogPage): string => {
    let text = ''
    for (const offer of page.offers) {
      const resolved = resolveOffer(offer, { channel, store, settings })
      if (resolved.included) text += feedRow(channel, store, resolved.row)
    }
    return text
  }
  let cursor = first.nextCursor
  let pages = 1
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(feedHead(channel, store) + rows(first)))
      if (!cursor) {
        controller.enqueue(encoder.encode(feedTail(channel)))
        controller.close()
      }
    },
    async pull(controller) {
      if (!cursor) return
      try {
        if (pages >= FEED_MAX_PAGES) {
          // The ceiling is a cut the merchant can see in diagnostics, not an error.
          console.warn(`sales-channels: feed for ${hostId} stopped at ${FEED_MAX_PAGES} pages`)
          cursor = null
        } else {
          const page = await cachedPage(hostId, cursor)
          pages += 1
          cursor = page.nextCursor
          const text = rows(page)
          if (text) controller.enqueue(encoder.encode(text))
        }
        if (!cursor) {
          controller.enqueue(encoder.encode(feedTail(channel)))
          controller.close()
        }
      } catch (error) {
        console.error('sales-channels: feed page failed', error)
        controller.error(error)
      }
    },
  })
  return new Response(body, { status: 200, headers })
}

/** Reads the store, the settings and the first page, then streams. */
async function serveFeed(
  request: Request,
  hostId: string,
  channel: SalesChannelDefinition,
  feed: FeedDocument | null,
): Promise<Response> {
  const sells = await siteSells(hostId)
  if ('response' in sells) return sells.response
  try {
    const [store, settings] = await Promise.all([cachedStore(hostId), getSettings(hostId)])
    if (!store) return notFound()
    const first = await cachedPage(hostId, null)
    void stampFetch({
      hostId,
      channel: channel.id,
      feed,
      agent: request.headers.get('user-agent') ?? '',
    })
    return feedResponse({
      hostId,
      channel,
      store,
      settings,
      first,
      head: request.method === 'HEAD',
    })
  } catch (error) {
    if (error instanceof CatalogUnavailableError) return notFound()
    console.error('sales-channels: feed unavailable', error)
    return textResponse(503, 'Feed temporarily unavailable', { 'Retry-After': '300' })
  }
}

export async function feedRoute(
  request: Request,
  params: Record<string, string | string[]>,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return textResponse(405, 'Method not allowed', { Allow: 'GET, HEAD' })
  }
  const channel = salesChannel(String(params['channel'] ?? ''))
  const file = parseFeedFile(String(params['file'] ?? ''))
  const hostId = new URL(request.url).searchParams.get('hostId') ?? ''
  if (!channel || !file || file.extension !== channel.extension || !isDocumentId(hostId)) {
    return notFound()
  }
  let feed: FeedDocument | null
  try {
    feed = await getFeed(hostId, channel.id)
  } catch (error) {
    console.error('sales-channels: feed state unreadable', error)
    return textResponse(503, 'Feed temporarily unavailable', { 'Retry-After': '300' })
  }
  if (!feed?.enabled || !tokenMatches(file.token, feed.token)) return notFound()
  return serveFeed(request, hostId, channel, feed)
}

/**
 * The address Google Merchant Center was given before the channels existed
 * (`/api/commerce/feed?hostId=`, AGL-299), which the catalog's owner still
 * receives and hands here through core's `core.catalog-feed` contract
 * (`declarations.server.ts`). It keeps answering with the Google
 * feed so no store's scheduled fetch breaks. It carries no token, so it stops
 * for good when the merchant rotates the Google feed or turns the old
 * address off, and it follows the Google channel's switch once the merchant
 * has set one.
 */
export async function legacyGoogleFeedRoute(request: Request, hostId: string): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return textResponse(405, 'Method not allowed', { Allow: 'GET, HEAD' })
  }
  if (!isDocumentId(hostId)) return textResponse(400, 'Missing hostId')
  let feed: FeedDocument | null
  try {
    feed = await getFeed(hostId, 'google')
  } catch (error) {
    console.error('sales-channels: feed state unreadable', error)
    return textResponse(503, 'Feed temporarily unavailable', { 'Retry-After': '300' })
  }
  if (feed && (feed.legacyRetired || !feed.enabled)) return notFound()
  return serveFeed(request, hostId, salesChannel('google')!, feed)
}
