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

import { dropPluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'

/*
 * A SITE'S PAGES HEAR WHEN A CONNECTION'S RECORD CHANGES (AGL-4195).
 *
 * The published page reads a site's records through the tenant's render
 * cache (`site-records-platform.ts`), tagged like the rest of the site's
 * data and kept an hour, so a record that changes must say so: a deleted one
 * (disconnect, uninstall, a grant gone mid-sync) must leave the page at once,
 * and a sync that wrote new values should show them. A sync that wrote what
 * was already there says nothing, so an hourly sync does not regenerate every
 * page of the site every hour.
 *
 * Best effort and never throws: the write it follows has already happened.
 */

const shape = (data: Record<string, unknown> | null | undefined) =>
  data ? JSON.stringify([data['version'] ?? null, data['fields'] ?? null, data['items'] ?? null]) : null

/** Whether a record's shown content differs between two reads (`syncedAtMs` is not content). */
export function connectionRecordChanged(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): boolean {
  return shape(before) !== shape(after)
}

/** Tells a site's pages that one of its connection records changed or went. */
export async function announceConnectionRecordChange(hostId: string, reason: string): Promise<void> {
  try {
    await dropPluginSiteCache({ hostIds: [hostId], reason })
  } catch (error) {
    console.error('[marketplace] a site was not told its connection record changed', error)
  }
}
