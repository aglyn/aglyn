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

import { pluginCatalogFeed } from '@aglyn/aglyn/plugin-manager/plugin-product-catalog'

/**
 * `GET /api/commerce/feed?hostId=` — the Google Merchant Center feed address
 * this plugin served itself from AGL-299 until AGL-3637, which merchants
 * pasted into Merchant Center as a scheduled fetch.
 *
 * The feed is now written by whichever plugin publishes the catalog to
 * shopping channels, found through core's `core.catalog-feed` contract, so a
 * store that set up its fetch years ago keeps being read. With no publisher
 * registered the address answers 404, which is what it answers once the
 * merchant retires it from the sales channels card.
 */
export async function legacyFeedRoute(request: Request): Promise<Response> {
  const hostId = new URL(request.url).searchParams.get('hostId') ?? ''
  if (!hostId) {
    return new Response('Missing hostId', {
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }
  const publisher = pluginCatalogFeed()
  if (!publisher) {
    return new Response('Not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }
  return publisher.serveLegacyFeed(request, hostId)
}
