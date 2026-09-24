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
import { useUser } from '@aglyn/tenant-feature-instance'
import { useCallback, useRef } from 'react'
import { ORG_AUTOMATION_API_ROUTES } from '../model/org-automations'

/**
 * ONE AUTHORIZED POST TO AN ORG AUTOMATION DOOR (AGL-3302).
 *
 * Every write the org hub and the site panel make goes through a server
 * route — the collection is closed to client writes — so each is the same
 * request against one of the two doors. The route decides who may; this
 * resolves with its answer, and throws the route's own words when it refuses,
 * for the caller's snackbar.
 *
 * The user is read through a ref so the callback keeps one identity while the
 * session object changes beneath it; the token is fetched at call time either
 * way. The path is chosen from the two the plugin serves, never taken from a
 * caller, so a component cannot point the console's credentials elsewhere.
 */
export function useOrgAutomationsApi(): (
  door: keyof typeof ORG_AUTOMATION_API_ROUTES,
  body: Record<string, unknown>,
) => Promise<Record<string, any>> {
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  return useCallback(async (door, body) => {
    const response = await authorizedFetch(
      userRef.current as never,
      `/api/${ORG_AUTOMATION_API_ROUTES[door]}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    )
    const payload = (await response.json().catch(() => ({}))) as Record<
      string,
      any
    >
    if (!response.ok) {
      throw new Error(
        String(payload?.['error'] ?? 'The request could not be completed'),
      )
    }
    return payload
  }, [])
}
