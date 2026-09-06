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
import { useCallback, useMemo } from 'react'

/** What `POST /api/crm/deal-stage` accepts, minus the `hostId` this hook adds. */
export type DealStageRequest =
  | { dealId: string; stageId: string }
  | { dealId: string; status: 'won' }
  | { dealId: string; status: 'lost'; lostReason?: string }

/** What the route answers on success. */
export interface DealStageResponse {
  ok: true
  dealId: string
  stageId: string
  status: 'open' | 'won' | 'lost'
  previousStageId: string
  /** The host event that was emitted, or `null` for a move to the same stage. */
  event: 'dealStageChanged' | 'dealWon' | 'dealLost' | null
}

/**
 * The ONE door a stage change goes through (AGL-2598).
 *
 * A deal's stage, its won and its lost are not written by the browser even
 * though the rules would let them be: the console can create and edit a deal
 * client-direct, but a move is the moment an automation wants to hear about
 * — "notify the owner when a deal is won", "file a task when one goes to
 * negotiation" — and a workflow can only hear an event the server emits.
 * Every surface that moves a deal (the board's drag, a card's menu, the
 * detail page's stepper and its Won and Lost buttons) calls this, so there
 * is no stage change that fires no event.
 *
 * Errors are thrown with the route's own message, which is written for the
 * person reading it, so a caller shows `error.message` and nothing else.
 */
export function useDealStageApi(hostId: string) {
  const { data: user } = useUser()

  const call = useCallback(
    async (body: DealStageRequest): Promise<DealStageResponse> => {
      const response = await authorizedFetch(user, '/api/crm/deal-stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId, ...body }),
      })
      const payload = (await response.json().catch(() => ({}))) as
        | DealStageResponse
        | { error?: string }
      if (!response.ok || !('ok' in payload)) {
        throw new Error(
          (payload as { error?: string }).error ||
            'The deal could not be moved. Try again.',
        )
      }
      return payload
    },
    [user, hostId],
  )

  return useMemo(
    () => ({
      moveToStage: (dealId: string, stageId: string) =>
        call({ dealId, stageId }),
      markWon: (dealId: string) => call({ dealId, status: 'won' }),
      markLost: (dealId: string, lostReason?: string) =>
        call({ dealId, status: 'lost', lostReason }),
    }),
    [call],
  )
}

export type DealStageApi = ReturnType<typeof useDealStageApi>
