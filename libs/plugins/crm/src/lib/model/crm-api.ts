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

import type { ContactLifecycleStage } from '@aglyn/aglyn'
import {
  authorizedFetch,
  type MaybeTokenSource,
} from '@aglyn/shared-util-http/authorized-token'
import { crmApiUrl } from '../constants/api-routes'

/**
 * The console's client half of the CRM server routes (AGL-2605).
 *
 * A stage change goes through the server rather than a client-direct
 * Firestore write, and the reason is the event: `contactStageChanged` can
 * only be emitted by a server path that performed the write, so a record
 * page that wrote the facet itself would move the person and tell no
 * automation. This is the one function a stage control calls.
 */

/** What `crm/contact-stage` answers. */
export interface ContactStageResult {
  ok: true
  /** False when the contact was already in that stage — nothing moved. */
  changed: boolean
  lifecycleStage: ContactLifecycleStage
  /** The stage before the move, `''` when the contact had none. */
  previousStage: string
}

/**
 * Moves one contact to a lifecycle stage, as the signed-in user.
 *
 * Throws with the route's own message on a refusal, so a control can show
 * "Not a site admin or editor" rather than a generic failure; a network
 * failure throws as `fetch` would.
 */
export async function setContactStage(
  user: MaybeTokenSource,
  hostId: string,
  contactId: string,
  stage: ContactLifecycleStage,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<ContactStageResult> {
  const response = await authorizedFetch(
    user,
    crmApiUrl('contactStage'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostId, contactId, lifecycleStage: stage }),
    },
    options.fetchImpl ? { fetchImpl: options.fetchImpl } : {},
  )
  const payload = (await response.json().catch(() => ({}))) as
    | ContactStageResult
    | { error?: string }
  if (!response.ok) {
    throw new Error(
      (payload as { error?: string }).error ?? 'The stage could not be changed',
    )
  }
  return payload as ContactStageResult
}
