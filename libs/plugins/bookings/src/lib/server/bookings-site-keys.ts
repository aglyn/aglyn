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

import { hostStampedSitePermission } from '@aglyn/aglyn/app-utils/host-permissions'
import type { HostAccessRole } from '@aglyn/aglyn/foundation/definitions/organization.types'
import { BOOKINGS_SITE_PERMISSIONS, type BookingsSitePermission } from '../model/bookings-permissions'

const BOOKINGS_SITE_PRESETS: Readonly<Record<string, Readonly<Partial<Record<HostAccessRole, boolean>>>>> =
  Object.fromEntries(BOOKINGS_SITE_PERMISSIONS.map((entry) => [entry.key, entry.hostRoleDefaults ?? {}]))

/**
 * Does this member hold one of bookings' keys on this site, as the rules
 * would read a site key (AGL-4047): the site's `memberPermissions` stamp,
 * else the preset of their `memberRoles` entry. `hostDoc` is the host
 * snapshot or its data, which every door here reads already.
 */
export function holdsBookingsSiteKey(
  hostDoc: { get(field: string): unknown } | { memberPermissions?: unknown; memberRoles?: unknown } | null | undefined,
  uid: string,
  key: BookingsSitePermission,
): boolean {
  if (!hostDoc || !uid) return false
  const read = (field: string): unknown =>
    typeof (hostDoc as { get?: unknown }).get === 'function'
      ? (hostDoc as { get(field: string): unknown }).get(field)
      : (hostDoc as Record<string, unknown>)[field]
  return hostStampedSitePermission(
    { memberPermissions: read('memberPermissions'), memberRoles: read('memberRoles') },
    uid,
    key,
    BOOKINGS_SITE_PRESETS[key] ?? {},
  )
}
