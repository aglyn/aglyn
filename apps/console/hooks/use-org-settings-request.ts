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

import { useCallback } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useOrgScope } from './use-org-scope'

/**
 * One authenticated POST to `/api/orgs/settings`, for every settings section.
 *
 * The sections were panels on one page and shared this closure by being in the
 * same function body. As routes they are separate modules, and the alternative
 * to a hook is four copies of "attach the ID token, send the orgId, unwrap the
 * error" — four chances to forget the token, and four different error strings
 * for the same failure.
 *
 * The `orgId` is added here rather than by each caller for the same reason:
 * every action on this route is scoped to the current organization, and a
 * caller that omitted it would post an action with no subject.
 */
export function useOrgSettingsRequest() {
  const { data: user } = useUser()
  const { currentOrg } = useOrgScope()
  return useCallback(
    async (body: Record<string, unknown>) => {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/orgs/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ orgId: currentOrg?.$id, ...body }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.error ?? 'Request failed')
      }
      return response.json()
    },
    [user, currentOrg?.$id],
  )
}

export default useOrgSettingsRequest
