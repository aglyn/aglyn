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

import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useMemo } from 'react'
import { ZAPIER_HOOKS_ROUTE } from '../constants'
import type { ZapierHookView } from '../model/hook-events'

/** What the card's route answers (`server/console-hooks.ts`). */
export interface ZapierCardState {
  configured: boolean
  appUrl: string | null
  canManage: boolean
  hooks: ZapierHookView[]
}

/**
 * The card's one way to its route (AGL-3643): the member's own token, the
 * route's sentence thrown on a refusal. A spec hands the card its own.
 */
export interface ZapierApi {
  list(): Promise<ZapierCardState>
  disconnect(hookId: string): Promise<void>
}

export function useZapierApi(hostId: string): ZapierApi {
  const { data: user } = useUser()
  return useMemo(() => {
    const read = async <T,>(response: Response): Promise<T> => {
      const answer = (await response.json().catch(() => ({}))) as T & { error?: string }
      if (!response.ok) throw new Error(answer?.error ?? 'Something went wrong. Try again.')
      return answer
    }
    return {
      list: async () =>
        read<ZapierCardState>(
          await authorizedFetch(user, `/api/${ZAPIER_HOOKS_ROUTE}?${new URLSearchParams({ hostId }).toString()}`, {
            method: 'GET',
          }),
        ),
      disconnect: async (hookId) => {
        await read(
          await authorizedFetch(user, `/api/${ZAPIER_HOOKS_ROUTE}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hostId, hookId }),
          }),
        )
      },
    }
  }, [hostId, user])
}
