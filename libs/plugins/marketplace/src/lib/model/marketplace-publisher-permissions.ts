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
 * Saving the publisher profile and managing the listings the workspace has
 * published asked whether the member's workspace role was owner or admin: the
 * save routes through `canActAsPublisher`, and the Firestore rules on
 * `publisherProfiles` and `marketplaceListings` through a role list of their
 * own. Each is now a key whose default is exactly those roles (the owner on
 * the admin tier), so nobody's access moved, and a custom role or a member's
 * own permissions can grant or refuse it.
 *
 * Declared through `registerPluginPermissions`, as Sequences declares its own
 * workspace keys: a key of that registry rides the permission map the
 * console hands the marketplace's pages, which is what the seller sections
 * disable their controls by.
 */

/** The marketplace's publisher keys. */
export type MarketplacePublisherPermission = 'marketplace.publisherProfile' | 'marketplace.manageListings'

export const MARKETPLACE_PUBLISHER_PROFILE_PERMISSION: MarketplacePublisherPermission = 'marketplace.publisherProfile'
export const MARKETPLACE_MANAGE_LISTINGS_PERMISSION: MarketplacePublisherPermission = 'marketplace.manageListings'

/** The keys as the plugin declares them; owners and admins hold both by default. */
export const MARKETPLACE_PUBLISHER_PERMISSIONS: readonly PluginPermission[] = [
  {
    key: 'marketplace.publisherProfile',
    pluginId: 'marketplace',
    label: 'Edit the publisher profile',
    description:
      'Change the workspace’s public marketplace profile: its handle, name, bio, logo, support contact and links.',
    defaults: { admin: true, editor: false, viewer: false },
    groupLabel: 'Marketplace',
  },
  {
    key: 'marketplace.manageListings',
    pluginId: 'marketplace',
    label: 'Manage published listings',
    description:
      'Edit the listings the workspace has published (their words, pictures and category), make a plugin public or private, and unpublish or republish a listing.',
    defaults: { admin: true, editor: false, viewer: false },
    groupLabel: 'Marketplace',
  },
]

/** The refusal a door answers without one: names the permission, never a role. */
export function marketplacePublisherPermissionRefusal(key: MarketplacePublisherPermission): string {
  const label = MARKETPLACE_PUBLISHER_PERMISSIONS.find((entry) => entry.key === key)?.label ?? key
  return `Your role does not include "${label}" — ask an organization admin`
}
