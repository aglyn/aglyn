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
import type { ContactUpdateFields, ContactUpdateOutcome } from '../model/contact-update'
import type { CrmBulkAnswer } from '../model/crm-bulk-writes'

/**
 * THE CONSOLE'S DOOR TO `crm/contact-update` (AGL-2804).
 *
 * Every surface that edits a contact's facet saves through here rather than
 * writing the document — the record page's profile, custom fields, files and
 * campaign filing, the company page's link, and the contacts bar — because
 * the rules leave a client nothing in a facet but letting a holder go.
 *
 * Built on `useCrmApi`, so beneath the organization hub's mount the request
 * names the org and the route writes each contact through its own primary
 * holder, and under a site it writes the site's.
 *
 * A request refused WHOLE — no session, no permission, a plan without the CRM
 * — throws with the route's sentence.
 * `updateMany` hands a per-contact answer back in the bulk runners' shape;
 * `updateOne` throws that one contact's refusal, which is what a single
 * record's Save shows.
 */
export function useContactUpdate(hostId: string | null) {
  const callCrm = useCrmApi(hostId)

  const updateMany = useCallback(
    async (
      contactIds: readonly string[],
      set: ContactUpdateFields,
    ): Promise<CrmBulkAnswer[]> => {
      const { response, payload } = await callCrm('contact-update', {
        contactIds: [...contactIds],
        set,
      })
      if (!response.ok) {
        const error = payload['error']
        throw new Error(
          typeof error === 'string' && error
            ? error
            : `The contact could not be saved (${response.status}).`,
        )
      }
      const results: ContactUpdateOutcome[] = Array.isArray(payload['results'])
        ? payload['results']
        : []
      return results.map((outcome) => ({
        id: outcome.contactId,
        ok: outcome.ok,
        ...('error' in outcome ? { error: outcome.error } : {}),
      }))
    },
    [callCrm],
  )

  const updateOne = useCallback(
    async (contactId: string, set: ContactUpdateFields): Promise<void> => {
      const [answer] = await updateMany([contactId], set)
      if (!answer?.ok) {
        throw new Error(answer?.error || 'The contact could not be saved.')
      }
    },
    [updateMany],
  )

  return useMemo(() => ({ updateMany, updateOne }), [updateMany, updateOne])
}

export default useContactUpdate
