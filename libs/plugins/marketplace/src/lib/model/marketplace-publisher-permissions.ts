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

import type { PluginPermission } from '@aglyn/aglyn/plugin-manager/plugin-permissions'

/*
 * THE WORKSPACE AS A MARKETPLACE PUBLISHER (AGL-4047).
 *
 * Saving the publisher profile, managing the listings the workspace has
 * published and setting up where its sales are paid asked whether the
 * member's workspace role was owner or admin: the routes through a role
 * helper, and the Firestore rules on `publisherProfiles` and
 * `marketplaceListings` through a role list of their own. Each is now a key
 * whose default is exactly those roles (the owner on the admin tier), so
 * nobody's access moved, and a custom role or a member's own permissions can
 * grant or refuse it.
 *
 * What is NOT a key: whether someone belongs to the workspace that published
 * a listing (`isPublisherMember`). Its members install it free on its own
 * sites (`ownsListingHere`; anywhere else they buy it like anyone), and
 * nobody in it may buy or review it. That is a fact about who published the
 * listing, so no grant can buy it and no refusal can take it away.
 *
 * Declared through `registerPluginPermissions`, as Sequences declares its own
 * workspace keys: a key of that registry rides the permission map the
 * console hands the marketplace's pages, which is what the seller sections
 * disable their controls by.
 */

/** The marketplace's publisher keys. */
export type MarketplacePublisherPermission =
  | 'marketplace.publisherProfile'
  | 'marketplace.manageListings'
  | 'marketplace.payouts'

export const MARKETPLACE_PUBLISHER_PROFILE_PERMISSION: MarketplacePublisherPermission = 'marketplace.publisherProfile'
export const MARKETPLACE_MANAGE_LISTINGS_PERMISSION: MarketplacePublisherPermission = 'marketplace.manageListings'
export const MARKETPLACE_PAYOUTS_PERMISSION: MarketplacePublisherPermission = 'marketplace.payouts'

/** The keys as the plugin declares them; owners and admins hold each by default. */
export const MARKETPLACE_PUBLISHER_PERMISSIONS: readonly PluginPermission[] = [
  {
    key: 'marketplace.publisherProfile',
    pluginId: 'marketplace',
    label: 'Edit the publisher profile',
    description:
      'Change the workspace’s public marketplace profile (its handle, name, bio, logo, support contact and links), and ask for the Verified publisher badge or withdraw the ask.',
    defaults: { admin: true, editor: false, viewer: false },
    groupLabel: 'Marketplace',
  },
  {
    key: 'marketplace.manageListings',
    pluginId: 'marketplace',
    label: 'Manage published listings',
    description:
      'Edit the listings the workspace has published (their words, pictures and category), make a plugin public or private, unpublish or republish a listing, and see each version’s review status.',
    defaults: { admin: true, editor: false, viewer: false },
    groupLabel: 'Marketplace',
  },
  {
    key: 'marketplace.payouts',
    pluginId: 'marketplace',
    label: 'Manage marketplace payouts',
    description:
      'Connect the payout account the workspace’s paid listings pay into, finish its setup, and open its payouts.',
    defaults: { admin: true, editor: false, viewer: false },
    groupLabel: 'Marketplace',
  },
]

/** The refusal a door answers without one: names the permission, never a role. */
export function marketplacePublisherPermissionRefusal(key: MarketplacePublisherPermission): string {
  const label = MARKETPLACE_PUBLISHER_PERMISSIONS.find((entry) => entry.key === key)?.label ?? key
  return `Your role does not include "${label}" — ask an organization admin`
}
