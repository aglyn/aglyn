/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The marketplace shelf (AGL-3966), so the Aglyn app's Marketplace browse,
 * a listing's page and the workspace's Sell screen show listings:
 *
 * - `publisherProfiles/{orgId}`: two publishers, another studio and the demo
 *   workspace itself (`MarketplacePublisherProfile`, marketplace.ts), with
 *   no Stripe account, so nothing can be sold or bought for money.
 * - `marketplaceListings/{id}`: free listings of each artifact type a site
 *   installs (component, template, theme, email template), stamped with the
 *   browse fields every listing writer stamps (`listingQueryFields`).
 *
 * `marketplaceListings` has no host or org namespace, which is why this is
 * an emulator seed only (seed-native-emulator.mjs refuses a non-`demo-`
 * project). The listings carry no version snapshots: browse and the listing
 * page read them; installing one answers the console's "no version" refusal.
 */

import { listingQueryFields } from '../lib/listing-query-fields.mjs'

const DAY = 24 * 60 * 60_000

export async function seedMarketplace({ put, orgId, now: date }) {
  const now = date.getTime()
  const studio = 'seed-publisher-fernhill'
  await put(`publisherProfiles/${studio}`, {
    handle: 'fernhill-studio',
    displayName: 'Fernhill Studio',
    bio: 'Sections and themes for small food businesses.',
    website: 'https://fernhill.example',
  })
  await put(`publisherProfiles/${orgId}`, {
    handle: 'juniper-street',
    displayName: 'Juniper Street Co.',
    bio: 'The bakery that shares its menu sections.',
  })

  const listings = [
    ['seed-listing-menu', studio, 'component', 'Menu board', 'A two-column menu with prices, notes and dietary tags.', 'Sections', 41, 4.7, 12, 18],
    ['seed-listing-cafe', studio, 'template', 'Neighborhood cafe', 'A five-page cafe site: home, menu, story, events and contact.', 'Templates', 23, 4.5, 6, 11],
    ['seed-listing-harvest', studio, 'theme', 'Harvest', 'Warm neutrals, a serif headline and rounded buttons.', 'Themes', 64, 4.8, 19, 30],
    ['seed-listing-receipt', studio, 'emailTemplate', 'Friendly receipt', 'An order receipt with a thank-you note and a reorder button.', 'Email', 9, null, 0, 4],
    ['seed-listing-hours', orgId, 'component', 'Opening hours card', 'Today’s hours first, the week below, holiday closures called out.', 'Sections', 3, null, 0, 2],
  ]
  for (const [id, profileId, artifactType, displayName, description, category, installCount, ratingAverage, ratingCount, days] of listings) {
    const listing = {
      profileId,
      displayName,
      description,
      category,
      categories: [category.toLowerCase()],
      artifactType,
      latestVersion: 1,
      priceUsd: 0,
      license: 'Aglyn Marketplace',
      installCount,
      ratingAverage,
      ratingCount,
      deletedAt: null,
    }
    await put(`marketplaceListings/${id}`, {
      ...listing,
      ...listingQueryFields(listing),
      createdAt: new Date(now - days * DAY),
      updatedAt: new Date(now - Math.min(days, 3) * DAY),
    })
  }
  return `2 publishers, ${listings.length} listings`
}
