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

import { useLoading } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Button, Stack, TextField } from '@mui/material'
import { useEffect, useState } from 'react'
import BillingProfileGateComponent from './billing-profile-gate.component'
import type { BillingProfile } from './use-billing-profile'

export interface BillingEmailCardProps {
  profile: BillingProfile
  /** billing.manage: the field saves; read-only otherwise. */
  canManage: boolean
}

/**
 * Where invoices are sent.
 *
 * This is the Stripe customer's `email`, and it is deliberately NOT the org's
 * `contact.email`. The two look interchangeable and are not: the contact
 * address is the org's public-facing one — it appears on the marketplace
 * profile and in the admin console — while this is the inbox that receives
 * receipts, invoices and, most importantly, the dunning notices that arrive
 * when a card fails. Merging them would mean an org could not send its
 * finance team the invoices without also publishing that address, which is
 * exactly the wrong trade for the one email a lapsed subscription depends on.
 *
 * Stripe is the store of record. Nothing is mirrored into Firestore, because
 * a second copy of a single field only creates a way for the two to disagree
 * about the address Stripe will actually mail.
 */
export default function BillingEmailCardComponent({
  profile,
  canManage,
}: BillingEmailCardProps) {
  const { state, loadState, reload, request } = profile
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)

  const serverEmail = state?.customer?.email ?? ''
  useEffect(() => {
    // Re-seed from the server whenever the profile reloads. Guarded on the
    // SERVER value rather than run once on mount, so a save elsewhere that
    // refreshes the profile does not leave this field showing the old address.
    setEmail(serverEmail)
  }, [serverEmail])

  const save = async () => {
    setBusy(true)
    const dequeue = queueLoading()
    try {
      const outcome = await request({ action: 'set-billing-email', email })
      if (outcome.ok) {
        enqueueSnackbar('Billing email saved.', {
          variant: 'success',
          persist: false,
        })
      }
    } finally {
      dequeue()
      setBusy(false)
    }
  }

  return (
    <BillingProfileGateComponent
      loadState={loadState}
      state={state}
      onRetry={reload}
      subject="billing email"
    >
      {() => (
        <Stack spacing={2}>
          {/*
            Editable with or without a subscription. Choosing where invoices go
            is account setup, not a privilege a purchase unlocks — and the
            person filling it in before they subscribe is the one about to. The
            Stripe customer these save against is created on demand by the
            route, on the first save; a page view creates nothing.
          */}
          <TextField
            label="Billing email"
            type="email"
            size="small"
            fullWidth
            value={email}
            disabled={!canManage || busy}
            onChange={(event) => setEmail(event.target.value)}
            slotProps={{ htmlInput: { 'aria-label': 'Billing email' } }}
          />
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              size="small"
              disabled={!canManage || busy || email.trim() === serverEmail}
              onClick={save}
            >
              {'Save'}
            </Button>
          </Stack>
        </Stack>
      )}
    </BillingProfileGateComponent>
  )
}
