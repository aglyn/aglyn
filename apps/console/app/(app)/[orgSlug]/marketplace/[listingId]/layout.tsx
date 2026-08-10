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
import { listingSocialCard } from './listing-social-card'
import { readListingForSocialCard } from './listing-social-card.server'

// Server shell (AGL-1059): the page is a client component, and a client
// component cannot export `metadata` — so the head lives here, in the nearest
// server layout. The `· Aglyn` suffix comes from the root title template.
//
// It was a title-only constant until AGL-876. Now it also builds the social
// card from the listing itself, so a link shared into Slack unfurls as the
// listing rather than as the generic console card every listing shared. The
// read is best-effort and the card falls back to exactly the old constant —
// see `listing-social-card.ts` for why a page behind a client-side auth gate
// has a card worth getting right, and which listings deliberately do not.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ listingId: string }>
}): Promise<Metadata> {
  const { listingId } = await params
  return listingSocialCard(await readListingForSocialCard(listingId))
}

export default function MarketplaceListingMetaLayout({
  children,
}: {
  children: ReactNode
}) {
  return <>{children}</>
}
