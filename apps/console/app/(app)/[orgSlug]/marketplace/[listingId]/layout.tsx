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

import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import {
  pluginRouteHead,
  pluginRouteMetadataOver,
} from '../../../../../utils/plugin-route-head'

/**
 * The title this route has always shipped, and still ships for a listing
 * that does not exist or must not be described. The root layout's
 * `%s · Aglyn` template affixes the brand.
 *
 * The console's own, deliberately: the constant used to live beside the card
 * builder, which is now the marketplace plugin's, and an app may not import
 * a plugin. It is also the shape the generic plugin route is in — a title
 * built without knowing what a listing is — which is the point of the move.
 */
const LISTING_TITLE_FALLBACK = 'Marketplace listing'

// Server shell (AGL-1059): the page is a client component, and a client
// component cannot export `metadata` — so the head lives here, in the nearest
// server layout.
//
// It was a title-only constant until AGL-876, which built the social card
// here from a listing read this route did itself. AGL-3080 hands both to the
// plugin: the shell asks whoever owns the `marketplace` route about this
// address and turns what comes back into tags. Nothing here knows what a
// listing is, which is what lets this route move onto the generic one
// without the card changing.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ listingId: string }>
}): Promise<Metadata> {
  const { listingId } = await params
  return pluginRouteMetadataOver(
    { title: LISTING_TITLE_FALLBACK },
    await pluginRouteHead('marketplace', [listingId]),
  )
}

export default function MarketplaceListingMetaLayout({
  children,
}: {
  children: ReactNode
}) {
  return <>{children}</>
}
