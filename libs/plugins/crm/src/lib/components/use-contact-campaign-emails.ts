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

import type { ContactCampaignEmail } from '@aglyn/aglyn'
import { useEffect, useState } from 'react'
import { useCrmApi } from './use-crm-api'

/** What the timeline knows about a contact's campaign mail. */
export interface ContactCampaignEmailsState {
  emails: ContactCampaignEmail[]
  status: 'loading' | 'success' | 'error'
  /**
   * The server could authorize the read and then could not read the log.
   * Distinct from `error` because the answer is trustworthy in every other
   * respect and the timeline should say "unknown" for this one history
   * rather than for the page.
   */
  lookupFailed: boolean
}

const EMPTY: ContactCampaignEmailsState = {
  emails: [],
  status: 'loading',
  lookupFailed: false,
}

/**
 * The campaign mail one contact was sent (AGL-2616), through
 * `crm/contact-email-history`.
 *
 * ONE request per record open, and on mount rather than behind a button,
 * because the record page is the ask: the reader opened one person, and
 * this history is part of what "one person" means on a CRM. The cost is
 * bounded by that person's own mail — the server reads down their message
 * subcollection, capped — and never by how much the customer has sent, so
 * it does not grow with the size of the account the way a scan would.
 *
 * Keyed on the api callback, which `useCrmApi` memoizes on the site, and on
 * the contact id — never on the user object, which is a new object on most
 * renders and would re-bill the page on every paint.
 */
export function useContactCampaignEmails(
  hostId: string,
  contactId: string,
): ContactCampaignEmailsState {
  const api = useCrmApi(hostId)
  const [state, setState] = useState<ContactCampaignEmailsState>(EMPTY)

  useEffect(() => {
    let cancelled = false
    setState(EMPTY)
    if (!contactId) return undefined
    api('contact-email-history', { contactId })
      .then(({ response, payload }) => {
        if (cancelled) return
        if (!response.ok) {
          setState({ emails: [], status: 'error', lookupFailed: false })
          return
        }
        setState({
          emails: Array.isArray(payload.emails)
            ? (payload.emails as ContactCampaignEmail[])
            : [],
          status: 'success',
          lookupFailed: payload.lookupFailed === true,
        })
      })
      .catch(() => {
        if (!cancelled) {
          setState({ emails: [], status: 'error', lookupFailed: false })
        }
      })
    return () => {
      cancelled = true
    }
  }, [api, contactId])

  return state
}

export default useContactCampaignEmails
