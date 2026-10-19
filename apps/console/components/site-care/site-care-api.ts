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

import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useCallback } from 'react'

/** What a call answered: the body, and whether it was refused. */
export interface SiteCareAnswer<T = Record<string, unknown>> {
  ok: boolean
  status: number
  body: T & { error?: string }
}

/**
 * One call to a Site Care route, signed in as the viewer (AGL-3959). A
 * refusal comes back as an answer rather than a toast, because a blocked
 * close is a state the panel draws ("Ask the owner first"), not an error;
 * a transport failure toasts and answers status 0.
 */
export function useSiteCareCall() {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  return useCallback(
    async <T = Record<string, unknown>>(
      path: string,
      init?: { method?: string; body?: Record<string, unknown> },
    ): Promise<SiteCareAnswer<T>> => {
      try {
        const response = await authorizedFetch(user, path, {
          method: init?.method ?? 'GET',
          ...(init?.body
            ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) }
            : {}),
        })
        const body = (await response.json().catch(() => ({}))) as T & { error?: string }
        return { ok: response.ok, status: response.status, body }
      } catch {
        enqueueSnackbar('An error has occurred', { variant: 'error' })
        return { ok: false, status: 0, body: {} as T & { error?: string } }
      }
    },
    [user, enqueueSnackbar],
  )
}
