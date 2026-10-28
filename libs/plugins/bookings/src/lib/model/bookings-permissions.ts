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

import type { HostAccessRole } from '@aglyn/aglyn/foundation/definitions/organization.types'
import type { PluginOrgPermissionDeclaration } from '@aglyn/aglyn/plugin-manager/plugin-entitlements'

/*
 * BOOKINGS' KEYS (AGL-4047).
 *
 * Taking a booking's payment at the desk and refunding a booking were decided
 * by the member's role ON THE SITE: an Admin or an Editor took payments in
 * person, and only an Admin refunded. Those are now keys whose preset is that
 * site role (`presetFromSiteRole`), so every member keeps exactly the access
 * they had, and a custom role, a member's own permissions or a site's toggle
 * can grant or refuse either one.
 */

/** Bookings' keys whose preset is the site role. */
export type BookingsSitePermission = 'bookings.payments' | 'bookings.refunds'

/** Who took a booking's payment in person before it was a key: the site's Admin and Editor. */
export const BOOKING_PAYMENTS_SITE_ROLE_PRESET: Readonly<Record<HostAccessRole, boolean>> = {
  admin: true,
  editor: true,
  author: false,
  viewer: false,
}

/** Who refunded a booking before it was a key: the site's Admin. */
export const BOOKING_REFUNDS_SITE_ROLE_PRESET: Readonly<Record<HostAccessRole, boolean>> = {
  admin: true,
  editor: false,
  author: false,
  viewer: false,
}

/** The bookings keys as the plugin declares them into the org permission catalog (AGL-4047). */
export const BOOKINGS_SITE_PERMISSIONS: readonly PluginOrgPermissionDeclaration[] = [
  {
    key: 'bookings.payments',
    label: 'Take booking payments in person',
    description:
      'Take a booking’s payment at the desk on a card reader. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...BOOKING_PAYMENTS_SITE_ROLE_PRESET },
    group: 'bookings',
    groupLabel: 'Bookings',
    presetFromSiteRole: true,
  },
  {
    key: 'bookings.refunds',
    label: 'Refund bookings',
    description: 'Refund a paid booking, in full or in part. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: false, viewer: false },
    hostRoleDefaults: { ...BOOKING_REFUNDS_SITE_ROLE_PRESET },
    group: 'bookings',
    groupLabel: 'Bookings',
    presetFromSiteRole: true,
  },
]

/** The refusal a door answers when a bookings key is not held: names the permission, never a role. */
export function bookingsSitePermissionRefusal(key: BookingsSitePermission): string {
  const label = BOOKINGS_SITE_PERMISSIONS.find((entry) => entry.key === key)?.label ?? key
  return `Your role does not include "${label}" — ask an organization admin`
}
