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
import {
  ceilingedWindow,
  collectionCeiling,
  useFirestore,
  useFirestoreCollection,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { Button } from '@mui/material'
import { collection } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import QuoteEditorDialog, { type QuoteEditorStart } from './quote-editor-dialog.component'

/*==========================================
 * START A QUOTE FROM SOMEWHERE ELSE (AGL-4098).
 *
 * Two widgets in other plugins' zones, each a button that opens the quote
 * editor already filled in:
 *
 *  - on an open submission in the Inbox (`inboxSubmissionActions`), for a
 *    quote request: the editor asks this plugin's route for the request's
 *    prefill (`start-from-request`), which reads the request through the
 *    forms plugin's facts for the member asking;
 *  - in a contact's header in the CRM (`crmRecordActions`): the person as the
 *    page shows them is the quote's customer.
 *
 * Either way the quote is the editor's ordinary new quote, saved by the
 * ordinary create under "Create and edit quotes"; the route refuses a member
 * without it, in words naming the permission.
 *=========================================*/

/** The products the editor's picker offers, as the Quotes card reads them. */
const PRODUCT_WINDOW = 200

/** The Inbox zone's props, restated: this plugin may not import the Inbox. */
export interface QuoteStartFromRequestProps {
  hostId: string
  submissionId: string
  requestKind: string | null
  formName: string
}

/** The CRM zone's props, restated: this plugin may not import the CRM. */
export interface QuoteStartFromContactProps {
  hostId: string | null
  orgId: string | undefined
  kind: 'contact' | 'lead'
  recordId: string
  name: string
  email: string | null
  phone: string
  company: string
}

/** The editor over the store's products, read only while it is open. */
function QuoteStartDialog(props: { hostId: string; start: QuoteEditorStart; onClose: () => void }) {
  const { hostId, start, onClose } = props
  const firestore = useFirestore()
  const { data: productDocs } = useFirestoreCollection<Record<string, any>>(
    () => collectionCeiling(collection(firestore, 'hosts', hostId, 'products'), PRODUCT_WINDOW),
    [firestore, hostId],
    { idField: '$id' },
  )
  const products = useMemo(
    () =>
      ceilingedWindow<Record<string, any>>(productDocs ?? undefined, PRODUCT_WINDOW).rows.filter(
        (product) => !product['deletedAt'],
      ),
    [productDocs],
  )
  // The route decided the member may make quotes when it answered the start.
  return (
    <QuoteEditorDialog hostId={hostId} quote={null} products={products} canEdit canSend={false} start={start} onClose={onClose} />
  )
}

/** "Start a quote" on an open quote request in the Inbox. */
export function QuoteStartFromRequest(props: QuoteStartFromRequestProps) {
  const { hostId, submissionId, requestKind } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [busy, setBusy] = useState(false)
  const [start, setStart] = useState<QuoteEditorStart | null>(null)

  const open = useCallback(async () => {
    setBusy(true)
    try {
      const response = await authorizedFetch(user, '/api/commerce/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start-from-request', hostId, submissionId }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'The quote could not be started', {
          variant: 'error',
          allowDuplicate: true,
        })
      }
      setStart({
        from: { kind: 'submission', id: submissionId },
        prefill: payload.prefill,
        request: payload.request,
        files: payload.files ?? [],
        threaded: payload.threaded === true,
      })
    } catch {
      enqueueSnackbar('The quote could not be started', { variant: 'error', allowDuplicate: true })
    } finally {
      setBusy(false)
    }
  }, [user, hostId, submissionId, enqueueSnackbar])

  // Only a quote request has a quote to start.
  if (requestKind !== 'quote' || !hostId) return null
  return (
    <>
      <Button variant="outlined" disabled={busy || !user} onClick={() => void open()}>
        {busy ? 'Starting…' : 'Start a quote'}
      </Button>
      {start ? <QuoteStartDialog hostId={hostId} start={start} onClose={() => setStart(null)} /> : null}
    </>
  )
}
QuoteStartFromRequest.displayName = 'QuoteStartFromRequest'

/** "Start a quote" in a contact's header in the CRM. */
export function QuoteStartFromContact(props: QuoteStartFromContactProps) {
  const { hostId, kind, recordId, name, email, phone, company } = props
  const [start, setStart] = useState<QuoteEditorStart | null>(null)
  // A quote is a site's: at the organization level with no site, there is none to start.
  if (!hostId) return null
  return (
    <>
      <Button
        size="small"
        variant="outlined"
        onClick={() =>
          setStart({
            from: null,
            prefill: {
              customer: {
                record: { kind, id: recordId },
                ...(name ? { name } : {}),
                ...(email ? { email } : {}),
                ...(phone ? { phone } : {}),
                ...(company ? { company } : {}),
              },
              lines: [],
              notes: '',
            },
          })
        }
      >
        {'Start a quote'}
      </Button>
      {start ? <QuoteStartDialog hostId={hostId} start={start} onClose={() => setStart(null)} /> : null}
    </>
  )
}
QuoteStartFromContact.displayName = 'QuoteStartFromContact'

export default QuoteStartFromRequest
