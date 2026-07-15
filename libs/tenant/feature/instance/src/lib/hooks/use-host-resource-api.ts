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

import { useCallback } from 'react'
import { useUser } from './firebase/firebase-services'

/**
 * Quota-governed host resource kinds served by `POST /api/hosts/resources`
 * (AGL-473). Firestore rules deny client-side `create` on these
 * collections, so creation MUST go through the API — it enforces the
 * per-plan quota (and entitlement, where the feature is paid) with the
 * Admin SDK. Updates and deletes stay client-direct.
 */
export type HostResourceKind =
  | 'screen'
  | 'layout'
  | 'variable'
  | 'function'
  | 'workflow'
  | 'service'
  | 'redirect'
  | 'location'
  | 'product'
  | 'reusableComponent'

/**
 * Creates a quota-governed host resource through the console API
 * (AGL-473). `data` must be JSON-plain — no Firestore Timestamps; the
 * route stamps `createdAt`/`updatedAt` server-side when absent. Pass `id`
 * when the caller pre-generates the id (e.g. to write a first `versions`
 * doc under it). Throws with the server's message on denial (quota,
 * entitlement, role), for the caller's snackbar.
 */
export function useHostResourceApi(): (options: {
  hostId: string
  resource: HostResourceKind
  data: Record<string, unknown>
  id?: string
}) => Promise<{ id: string }> {
  const { data: user } = useUser()
  return useCallback(
    async ({ hostId, resource, data, id }) => {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/hosts/resources', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ hostId, resource, data, ...(id ? { id } : {}) }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(result?.error ?? 'Create failed')
      }
      return { id: String(result.id) }
    },
    [user],
  )
}
