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

import {
  authorizedFetch,
  type TokenSource,
} from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useCallback, useRef } from 'react'

/** The routes `registerCrmConsoleApi` registers under `/api/crm/`. */
export type CrmApiRoute = 'contacts-create' | 'contact-email-history'

/** What one call to the CRM API answered with. */
export interface CrmApiResult {
  response: Response
  payload: Record<string, any>
}

/**
 * ONE AUTHORIZED POST TO THE CRM's SERVER HALF (AGL-2596).
 *
 * The route is a fixed member of {@link CrmApiRoute} rather than a string
 * the caller composes, so a component cannot post the console's credentials
 * anywhere this plugin does not own. The site id rides in the body because
 * that is where the dispatcher's per-site gate reads it from.
 *
 * The user is read through a ref, for the reason the campaign API hook
 * gives: the user object is a new object on most renders, and a callback
 * that changed identity with it would re-fire every effect that depends on
 * it. The token is fetched at call time either way — `authorizedFetch`
 * resolves it under a deadline and answers a 401 of its own rather than
 * sending the request unauthenticated, so a signed-out caller is told so
 * through the same `response.ok` branch every other refusal takes.
 */
export function useCrmApi(
  /**
   * The site the request is made for. `null` at the organization level
   * until a site is picked (AGL-2630) — a call made then is refused by the
   * route, which is why every caller holds its button until one is known.
   */
  hostId: string | null,
) {
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  return useCallback(
    async (
      route: CrmApiRoute,
      payload: Record<string, unknown>,
    ): Promise<CrmApiResult> => {
      const response = await authorizedFetch(
        userRef.current as TokenSource | null | undefined,
        `/api/crm/${route}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostId, ...payload }),
        },
      )
      const json = await response.json().catch(() => ({}))
      return { response, payload: json as Record<string, any> }
    },
    [hostId],
  )
}

export default useCrmApi
