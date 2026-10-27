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

import { resolveSiteTimeZone } from '@aglyn/aglyn/app-utils/collection-entry-date'
import { zonedDayKey } from '@aglyn/shared-util-timestamp/zoned-time'
import { getOrgForHost } from '@aglyn/tenant-data-admin'

/**
 * The store's calendar (AGL-4043): its time zone (the site's, else the
 * workspace's, else UTC, as `resolveSiteTimeZone` decides for every day the
 * store counts) and today's day key on it. What a use date a buyer picks is
 * checked against, so "today" is the store's today wherever the buyer is.
 *
 * `org` and `host` are used when the caller already holds them; otherwise
 * they are read.
 */
export async function readStoreDay(
  hostRef: FirebaseFirestore.DocumentReference,
  options: {
    org?: Record<string, unknown> | null
    host?: Record<string, unknown> | null
    nowMs?: number
  } = {},
): Promise<{ timeZone: string; todayKey: string }> {
  const [host, org] = await Promise.all([
    options.host !== undefined
      ? options.host
      : hostRef.get().then((snapshot) => (snapshot.data() ?? null) as Record<string, unknown> | null),
    options.org !== undefined
      ? options.org
      : getOrgForHost(hostRef.id).then((owner) => (owner?.org ?? null) as Record<string, unknown> | null),
  ])
  const timeZone = resolveSiteTimeZone(org as { timeZone?: string } | null, host as { timeZone?: string } | null)
  return { timeZone, todayKey: zonedDayKey(options.nowMs ?? Date.now(), timeZone) }
}
