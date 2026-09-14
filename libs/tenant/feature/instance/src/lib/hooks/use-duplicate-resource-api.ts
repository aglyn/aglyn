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

import type { DuplicableHostResourceKind } from '@aglyn/aglyn/app-utils/duplicate-resource'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useCallback } from 'react'
import { useUser } from './firebase/firebase-services'

export interface DuplicateHostResourceOptions {
  hostId: string
  kind: DuplicableHostResourceKind
  sourceId: string
  /** The name the copy takes; blank means `Copy of <source>`. */
  name?: string
  /**
   * Minted once per dialog, so a double click or a retry after a dropped
   * response makes one copy and answers with it.
   */
  attemptKey: string
}

export interface DuplicatedHostResource {
  id: string
  /** The copy's first version, for the kinds that open by version. */
  versionId: string | null
  name: string
}

/**
 * Asks the resources door to copy a site resource whole, as a draft
 * (AGL-2936). The same route the create hook posts to, with
 * `action: 'duplicate'`; the server reads the source, so nothing about it
 * crosses the wire but its id.
 */
export function useDuplicateResourceApi(): (
  options: DuplicateHostResourceOptions,
) => Promise<DuplicatedHostResource> {
  const { data: user } = useUser()
  return useCallback(
    async ({ hostId, kind, sourceId, name, attemptKey }) => {
      const response = await authorizedFetch(user, '/api/hosts/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostId,
          resource: kind,
          action: 'duplicate',
          sourceId,
          ...(name ? { name } : {}),
          attemptKey,
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(result?.error ?? 'Duplicate failed')
      }
      return {
        id: String(result.id),
        versionId: result.versionId ? String(result.versionId) : null,
        name: String(result.name ?? name ?? ''),
      }
    },
    [user],
  )
}

export default useDuplicateResourceApi
