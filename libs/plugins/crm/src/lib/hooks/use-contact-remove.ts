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

import { useCallback, useMemo } from 'react'
import { useCrmApi } from '../components/use-crm-api'
import type { ContactRemoveOutcome } from '../model/contact-remove'
import type { CrmBulkAnswer } from '../model/crm-bulk-writes'

/**
 * THE CONSOLE'S DOOR TO `crm/contact-remove` (AGL-3338).
 *
 * The record page's Delete and the contacts bar's Remove let contacts go
 * through here rather than writing the document: the route decides detach
 * or delete against the stored consent map, keeps every refusal, and the
 * rules refuse a client the write.
 *
 * A request refused WHOLE — no session, no permission — throws with the
 * route's sentence. `removeMany` answers per contact in the bulk runners'
 * shape; `removeOne` throws that contact's refusal and otherwise says
 * whether the document was deleted or only this site's half of it.
 */
export function useContactRemove(hostId: string | null) {
  const callCrm = useCrmApi(hostId)

  const removeOutcomes = useCallback(
    async (contactIds: readonly string[]): Promise<ContactRemoveOutcome[]> => {
      const { response, payload } = await callCrm('contact-remove', {
        contactIds: [...contactIds],
      })
      if (!response.ok) {
        const error = payload['error']
        throw new Error(
          typeof error === 'string' && error
            ? error
            : `The contact could not be removed (${response.status}).`,
        )
      }
      return Array.isArray(payload['results']) ? payload['results'] : []
    },
    [callCrm],
  )

  const removeMany = useCallback(
    async (contactIds: readonly string[]): Promise<CrmBulkAnswer[]> =>
      (await removeOutcomes(contactIds)).map((outcome) => ({
        id: outcome.contactId,
        ok: outcome.ok,
        ...('error' in outcome ? { error: outcome.error } : {}),
      })),
    [removeOutcomes],
  )

  const removeOne = useCallback(
    async (contactId: string): Promise<'deleted' | 'detached'> => {
      const [outcome] = await removeOutcomes([contactId])
      if (!outcome?.ok) {
        throw new Error(
          (outcome && 'error' in outcome && outcome.error) || 'The contact could not be removed.',
        )
      }
      return outcome.removed
    },
    [removeOutcomes],
  )

  return useMemo(() => ({ removeMany, removeOne }), [removeMany, removeOne])
}

export default useContactRemove
