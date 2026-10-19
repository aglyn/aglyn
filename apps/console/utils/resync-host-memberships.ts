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
'use client'

import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'

/** The mirrored host fields the console changes by hand. */
export interface MirroredHostFields {
  /** `displayName`. */
  displayName?: string
  /** `seo.favicon`; `''` clears it, as the Remove button does. */
  favicon?: string
}

/**
 * Write a site's name or favicon through the server, which re-fans it into
 * every member's `users/{uid}/hostMemberships` row in the same request
 * (AGL-844, AGL-1071, AGL-3972).
 *
 * Those rows are what every site list and switcher reads, and only the Admin
 * SDK writes them. These fields used to be written straight from the browser
 * and followed by a fire-and-forget re-fan ping chained on the write's
 * acknowledgement. Under the multi-tab cache that acknowledgement can take a
 * minute (AGL-3806), so a page left in that minute, or a ping that failed,
 * kept every list on the old name or icon for good — nothing later heals a
 * row whose site and members do not change.
 *
 * Awaited, and it throws when the server refuses, so the caller can say the
 * save did not happen rather than report one that only half landed.
 */
export async function saveMirroredHostFields(
  hostId: string,
  user: { getIdToken?: () => Promise<string> } | null | undefined,
  fields: MirroredHostFields,
): Promise<void> {
  const response = await authorizedFetch(user, '/api/hosts/sync-memberships', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostId, ...fields }),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error ?? `Save failed (${response.status})`)
  }
}

export default saveMirroredHostFields
