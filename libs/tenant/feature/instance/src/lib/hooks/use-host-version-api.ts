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

/** Parents that carry besigner version history (AGL-1369). */
export type HostVersionParentKind = 'screen' | 'layout' | 'component'

/**
 * Options for {@link useHostVersionApi}. Either `data` (a version written from
 * scratch — the seed a new screen/layout/component needs to be editable) or
 * `sourceVersionId` (snapshot an existing version; the route copies the stored
 * document server-side, so the node map never crosses the wire).
 */
export interface CreateHostVersionOptions {
  hostId: string
  kind: HostVersionParentKind
  parentId: string
  /** Pre-generated id, when the caller must reference it immediately. */
  id?: string
  data?: Record<string, unknown>
  sourceVersionId?: string
}

/**
 * Creates a besigner version document through the console API (AGL-1369).
 *
 * Firestore rules deny client-side `create` under
 * `hosts/{h}/{screens|layouts|components}/{id}/versions`, so this is the only
 * creation path. SAVING a version stays client-direct — a save is a merge-set
 * onto the document already open, which is an update, and it must keep working
 * on every plan.
 *
 * The route decides whether the create is free or paid by counting what is
 * already there: the first version of a resource is allowed on any plan (a
 * resource with no version cannot be opened), and retaining a second requires
 * `versioning` (Pro+). Callers do not declare which case they are in.
 *
 * Throws with the server's message on denial, for the caller's snackbar.
 */
export function useHostVersionApi(): (
  options: CreateHostVersionOptions,
) => Promise<{ id: string }> {
  const { data: user } = useUser()
  return useCallback(
    async ({ hostId, kind, parentId, id, data, sourceVersionId }) => {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/hosts/versions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          hostId,
          kind,
          parentId,
          ...(id ? { id } : {}),
          ...(data ? { data } : {}),
          ...(sourceVersionId ? { sourceVersionId } : {}),
        }),
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

export default useHostVersionApi
