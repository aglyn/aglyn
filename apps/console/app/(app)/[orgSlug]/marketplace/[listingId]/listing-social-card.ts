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
 * The social card for a marketplace listing (AGL-876).
 *
 * ## Why a gated page gets a card at all
 *
 * The issue was filed as "needs a public marketplace surface", on the premise
 * that a crawler cannot fetch a page behind console auth. It can: the auth
 * gate is `AuthenticatedLayout` in `(app)/layout.tsx`, which is `'use client'`
 * — an anonymous GET returns 200 with the server-rendered `<head>`, and the
 * two nested title shells prove it (`/{org}/marketplace` answers "Marketplace"
 * and `/{org}/marketplace/{id}` answers "Marketplace listing", so each route's
 * own metadata export runs for an unauthenticated client).
 *
 * So the choice was never "card or no card". Every listing link ALREADY
 * unfurls — as the generic console card from the root layout, identical for
 * every listing in the marketplace. The recipient still lands on a sign-in
 * wall either way, and `continueParam` returns them to this listing once they
 * are through it, which is the org-internal Slack/Teams share this is for.
 * A correct name, description and image is strictly better than one wrong
 * card repeated; it is not a substitute for a public listing page.
 *
 * ## Why the visibility gate is the interesting half
 *
 * The read runs through the Admin SDK, which bypasses Firestore rules
 * entirely — so `allow read: if true` on `marketplaceListings/{listingId}` is
 * not the control here, this module is. And the audience is unauthenticated
 * by construction: there is no viewer to exempt, so the owner exemption that
 * `marketplace-browse` applies (a publisher may watch their own submission
 * move through review) has no analogue and must NOT be reproduced.
 *
 * A listing that is soft-deleted, private, staff-hidden, or a plugin still
 * awaiting review — or rejected — therefore falls back to the generic shell:
 * same `<title>` it has today, and the root layout's `openGraph` inherited
 * untouched, because a metadata export that omits a field inherits the
 * parent's. Nothing about it is disclosed that was not already public.
 *
 * The rule itself is `isListingBrowsable`/`isListingDeleted`, imported from
 * core rather than restated — they are the same predicates browse and install
 * apply, and a third reading that drifted from them would be a disclosure
 * bug. They were moved into core for this (`scope:app` may not depend on
 * `aglyn:addons`); the marketplace plugin re-exports them unchanged.
 */

import { resolveSeoTitle } from '@aglyn/aglyn/app-utils/seo-title'
import { resolveSocialImage } from '@aglyn/aglyn/app-utils/social-image'
import {
  isListingBrowsable,
  isListingDeleted,
} from '@aglyn/aglyn/app-utils/marketplace-listing-visibility'
import type { Metadata } from 'next'

/**
 * The title the route has always shipped, and still ships for a listing that
 * does not exist or must not be described. The root layout's `%s · Aglyn`
 * template affixes the brand.
 */
export const LISTING_TITLE_FALLBACK = 'Marketplace listing'

/**
 * `og:description` budget. The listing description is a free-form textarea
 * with no length cap in the editor, and consumers truncate somewhere between
 * 150 and 300 characters anyway — so cut it here, where an ellipsis can be
 * placed deliberately, rather than shipping a multi-kilobyte meta tag and
 * letting each crawler pick its own cut.
 */
export const LISTING_DESCRIPTION_MAX = 200

/**
 * The console's own origin — a listing image is not served by a tenant site,
 * so there is no host record to derive one from.
 *
 * Read at call time, not module load, so a self-hosted install's
 * `NEXT_PUBLIC_CONSOLE_URL` is honoured — the same variable the auth action
 * links already track. Trailing slashes are trimmed: one typed into that
 * variable would otherwise reach `og:image` as `https://host//api/…`.
 */
export function consoleOrigin(): string {
  const origin = process.env.NEXT_PUBLIC_CONSOLE_URL ?? 'https://app.aglyn.com'
  return origin.replace(/\/+$/, '')
}

/**
 * The listing fields the card reads. Deliberately structural rather than the
 * plugin's `MarketplaceListing`: that type lives in an `aglyn:addons` lib the
 * console may not import, and the doc arrives from the Admin SDK as untyped
 * data regardless.
 */
export interface ListingSocialCardSource {
  displayName?: string
  description?: string
  /** Publisher-uploaded or DAM-picked card art; validated https at write. */
  previewImageUrl?: string
  /** The publisher's own logo — the fallback when there is no preview. */
  logoUrl?: string
  artifactType?: string
  type?: string
  kind?: string
  reviewStatus?: string
  hiddenAt?: unknown
  visibility?: string
  deletedAt?: unknown
}

/** Trimmed, or `''` for anything that is not a live string. */
function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * The description, trimmed and cut to {@link LISTING_DESCRIPTION_MAX}.
 *
 * Cuts at the last word boundary inside the budget when there is one, so the
 * card does not end mid-word; the ellipsis is only added when something was
 * actually removed. Returns `''` for an absent or whitespace-only field —
 * never `undefined` or `''` reaching a meta tag, since `strictNullChecks` is
 * off repo-wide and an emitted `og:description` of "undefined" is worse than
 * an absent one.
 */
export function listingCardDescription(value: unknown): string {
  const text = clean(value).replace(/\s+/g, ' ')
  if (text.length <= LISTING_DESCRIPTION_MAX) return text
  const cut = text.slice(0, LISTING_DESCRIPTION_MAX)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > LISTING_DESCRIPTION_MAX / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/**
 * Builds the route's `Metadata` from the listing document.
 *
 * Pure, and separated from the read so the policy above is testable without
 * firebase-admin. `undefined` covers both "no such listing" and "the read
 * failed" — the caller does not distinguish, because the answer is the same
 * generic shell either way.
 */
export function listingSocialCard(
  listing: ListingSocialCardSource | null | undefined,
  options?: { origin?: string },
): Metadata {
  const shell: Metadata = { title: LISTING_TITLE_FALLBACK }
  if (!listing) return shell
  // The one gate. Deleted has no owner exemption anywhere; browsable has one
  // in the UI, and deliberately none here — see the module docblock.
  if (isListingDeleted(listing) || !isListingBrowsable(listing)) return shell

  const name = clean(listing.displayName)
  if (!name) return shell

  const description = listingCardDescription(listing.description)
  // Precedence, not `??`: `previewImageUrl` is the card art a publisher chose
  // for exactly this purpose, and `logoUrl` is the mark that identifies them.
  // An empty string is a cleared field, which is why this is the resolver's
  // source LIST rather than a coalesce — `''` must fall through to the logo.
  //
  // Neither field carries dimensions (nothing records them at write time), so
  // no `og:image:width/height` is emitted. Stated rather than silent: adding
  // them means capturing the pair when the image is set, not guessing here.
  const image = resolveSocialImage({
    sources: [{ image: listing.previewImageUrl }, { image: listing.logoUrl }],
    origin: options?.origin ?? consoleOrigin(),
  })
  const title = resolveSeoTitle({ name, fallback: LISTING_TITLE_FALLBACK })

  return {
    title,
    ...(description ? { description } : {}),
    // Defining `openGraph` REPLACES the root layout's wholesale for this
    // route, so `siteName` and `type` are restated rather than inherited.
    openGraph: {
      title,
      ...(description ? { description } : {}),
      siteName: 'Aglyn',
      type: 'website',
      ...(image ? { images: [image] } : {}),
    },
    twitter: {
      // No image means the large card would render a blank slab; degrade to
      // the small one instead, the same rule the tenant head follows.
      card: image ? 'summary_large_image' : 'summary',
      title,
      ...(description ? { description } : {}),
      ...(image ? { images: [image.url] } : {}),
    },
  }
}
