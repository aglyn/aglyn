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

import { buildRoute, Route } from './route-links'

export type MarketplaceSectionId =
  | 'browse'
  | 'installed'
  | 'licences'
  | 'upload'
  | 'profile'
  | 'listings'
  | 'payouts'
  | 'sales'

export interface MarketplaceSection {
  /** The section's URL segment, and the key the rail and specs match on. */
  id: MarketplaceSectionId
  label: string
  href: string
  /**
   * Needs `publishToMarketplace`. The seller sections read the org's revenue
   * and its payout account, so they are gated in the layout — above the pages
   * rather than in the rail that draws them, because a route is reachable by
   * typing it whether or not a tab was ever offered.
   */
  seller: boolean
}

/** Section metadata, in rail order. Hrefs are added per org below. */
const SECTIONS: ReadonlyArray<{
  id: MarketplaceSectionId
  label: string
  route: Route
  seller: boolean
}> = [
  // "Browse All" (AGL-1024): the same grid also renders publisher-filtered
  // views, so the unqualified verb was ambiguous about which you were getting.
  {
    id: 'browse',
    label: 'Browse All',
    route: Route.ORG_MARKETPLACE_BROWSE,
    seller: false,
  },
  {
    id: 'installed',
    label: 'Installed',
    route: Route.ORG_MARKETPLACE_INSTALLED,
    seller: false,
  },
  // What this workspace OWNS (AGL-2331) — an org can hold a licence nobody
  // has installed, and a member can install something they never bought.
  // Buyer-side, so deliberately NOT gated like the seller sections below: the
  // person who needs it is often not a publisher at all.
  {
    id: 'licences',
    label: 'Licences',
    route: Route.ORG_MARKETPLACE_LICENCES,
    seller: false,
  },
  {
    id: 'upload',
    // Covers uploading a bundle as well as publishing an existing artifact
    // (AGL-1024).
    label: 'Upload / Publish',
    route: Route.ORG_MARKETPLACE_UPLOAD,
    seller: true,
  },
  {
    id: 'profile',
    // Whose profile (AGL-1024) — the console also has org and user profiles.
    label: 'Publisher Profile',
    route: Route.ORG_MARKETPLACE_SELLER_PROFILE,
    seller: true,
  },
  {
    id: 'listings',
    label: 'Listings',
    route: Route.ORG_MARKETPLACE_SELLER_LISTINGS,
    seller: true,
  },
  {
    id: 'payouts',
    label: 'Payouts',
    route: Route.ORG_MARKETPLACE_SELLER_PAYOUTS,
    seller: true,
  },
  {
    id: 'sales',
    label: 'Sales',
    route: Route.ORG_MARKETPLACE_SELLER_SALES,
    seller: true,
  },
]

/**
 * The Marketplace hub's sections for one org, in rail order (AGL-2501).
 *
 * One list, read by everything that has to agree about it: the layout draws
 * the rail from it, `useActiveSection` resolves the breadcrumb's last crumb
 * against the same array, and the index redirect lands on its first entry.
 * Separate copies are how a section comes to be listed under one name, linked
 * under another, and missing from the trail entirely.
 */
export function marketplaceSections(orgSlug: string): MarketplaceSection[] {
  return SECTIONS.map(({ id, label, route, seller }) => ({
    id,
    label,
    seller,
    href: buildRoute(route as never, { orgSlug } as never),
  }))
}

/**
 * Where a Stripe round trip lands (AGL-2501).
 *
 * `connect.ts` and `checkout.ts` bake `${origin}/{orgSlug}/marketplace?…` into
 * the account-onboarding link and the checkout session, and Stripe holds those
 * URLs — a seller part-way through onboarding is carrying one right now. That
 * is exactly the case the settings sections did NOT have when they dropped
 * their `?tab=` map: nothing shipped held a `?tab=` link, and Stripe
 * demonstrably holds these.
 *
 * So the index keeps them working, and sends each to the section it is about
 * rather than to the default: a seller returning from Connect onboarding wants
 * Payouts, and a buyer returning from checkout wants what they now own. No
 * console code reads either parameter — they are markers on the URL — so this
 * map is the only thing that gives them meaning.
 */
export const MARKETPLACE_RETURN_SECTIONS: Readonly<
  Record<string, MarketplaceSectionId>
> = {
  // Stripe Connect onboarding, from `marketplace/server/connect.ts`.
  connect: 'payouts',
  // Marketplace checkout, from `marketplace/server/checkout.ts`.
  purchase: 'licences',
}

/** Where `/marketplace` lands when nothing names a section. */
export const DEFAULT_MARKETPLACE_SECTION_ID: MarketplaceSectionId = 'browse'
