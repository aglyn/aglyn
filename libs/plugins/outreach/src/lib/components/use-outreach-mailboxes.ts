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

import { useFirestore } from '@aglyn/tenant-feature-instance'
import { collection, onSnapshot } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { OUTREACH_COLLECTIONS, type OutreachMailbox } from '../model/outreach.types'

export type OutreachMailboxesResult =
  | { status: 'loading'; mailboxes: OutreachMailbox[] }
  | { status: 'ready'; mailboxes: OutreachMailbox[] }
  | { status: 'error'; mailboxes: OutreachMailbox[] }

/**
 * The organization's connected mailboxes, live (AGL-2978).
 *
 * Read straight from `orgs/{orgId}/outreachMailboxes`: the rules let an
 * org-wide member holding `outreach.use` on an entitled organization read
 * them, and every write goes through a route, so what this shows is what the
 * routes wrote — a pause, a settings save, or the sending runtime marking a
 * mailbox reconnect-required — the moment it lands. Credentials live
 * elsewhere and no client can read them.
 */
export function useOutreachMailboxes(orgId: string | null): OutreachMailboxesResult {
  const firestore = useFirestore()
  const [result, setResult] = useState<OutreachMailboxesResult>({ status: 'loading', mailboxes: [] })

  useEffect(() => {
    setResult({ status: 'loading', mailboxes: [] })
    if (!orgId) return undefined
    return onSnapshot(
      collection(firestore, 'orgs', orgId, OUTREACH_COLLECTIONS.mailboxes),
      (snapshot) => {
        const mailboxes = snapshot.docs
          .map((entry) => ({ ...(entry.data() as OutreachMailbox), id: entry.id }))
          .sort((a, b) => (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0))
        setResult({ status: 'ready', mailboxes })
      },
      (error) => {
        console.error('[outreach] mailboxes could not be read', error)
        setResult({ status: 'error', mailboxes: [] })
      },
    )
  }, [firestore, orgId])

  return result
}
