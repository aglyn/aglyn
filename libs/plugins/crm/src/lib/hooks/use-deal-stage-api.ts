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
/**
 * What a call names: the deal, and — at the organization level (AGL-2630),
 * where the surface has no site of its own — the site the deal was made on,
 * which is the site the route resolves the org from and emits the stage
 * event for. Under a site the mounted site wins, as it always has.
 */
export interface DealStageRef {
  $id: string
  hostId?: string
}

export function useDealStageApi(hostId: string | null) {
  const { data: user } = useUser()

  const call = useCallback(
    async (
      deal: DealStageRef,
      body: DealStageRequest,
    ): Promise<DealStageResponse> => {
      const site = hostId ?? deal.hostId
      if (!site) {
        throw new Error('This deal names no site, so its stage cannot be moved.')
      }
      const response = await authorizedFetch(user, '/api/crm/deal-stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId: site, ...body }),
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
      moveToStage: (deal: DealStageRef, stageId: string) =>
        call(deal, { dealId: deal.$id, stageId }),
      markWon: (deal: DealStageRef) => call(deal, { dealId: deal.$id, status: 'won' }),
      markLost: (deal: DealStageRef, lostReason?: string) =>
        call(deal, { dealId: deal.$id, status: 'lost', lostReason }),
    }),
    [call],
  )
}

export type DealStageApi = ReturnType<typeof useDealStageApi>
