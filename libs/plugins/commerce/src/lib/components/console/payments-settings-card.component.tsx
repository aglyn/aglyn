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

import * as Aglyn from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Alert, Button, Chip, Stack, Typography } from '@mui/material'
import { doc } from 'firebase/firestore'
import { useCallback, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { useFirestoreDoc } from '@aglyn/tenant-feature-instance'
import { useHostOrgId } from '@aglyn/tenant-feature-instance'

export interface PaymentsSettingsCardProps {
  hostId: string
}

/**
 * Merchant payments card (AGL-284): Stripe Connect Express onboarding
 * status for the org owner + the plan's transaction-fee ladder so the
 * "upgrade to kill fees" motion (AGL-278) is visible where it matters.
 */
export function PaymentsSettingsCard(props: PaymentsSettingsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [busy, setBusy] = useState(false)
  const orgId = useHostOrgId(hostId)
  const { data: org } = useFirestoreDoc<any>(
    () => doc(firestore, 'orgs', orgId ?? '-pending-'),
    [firestore, orgId],
  )
  const { data: profile } = useFirestoreDoc<any>(
    () => doc(firestore, 'profiles', (user as any)?.uid ?? '-pending-'),
    [firestore, (user as any)?.uid],
  )
  const isOwner = Boolean(
    org?.ownerUid && (user as any)?.uid === org.ownerUid,
  )
  const chargesEnabled = Boolean(profile?.stripeChargesEnabled)
  const physicalPct = Aglyn.resolveTransactionFeePct(org, 'physical')
  const digitalPct = Aglyn.resolveTransactionFeePct(org, 'digital')
  const commerceEnabled = Aglyn.checkEntitlement(org, 'commerce')

  const handleConnect = useCallback(async () => {
    setBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/commerce/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ hostId }),
      })
      const payload = await response.json()
      if (response.status === 501) {
        return void enqueueSnackbar(
          'Payments are not configured on this deployment',
          { variant: 'info', persist: false },
        )
      }
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'Payment setup failed', {
          variant: 'error',
          allowDuplicate: true,
        })
      }
      if (payload.chargesEnabled) {
        return void enqueueSnackbar('Payments are enabled', {
          variant: 'success',
          persist: false,
        })
      }
      if (payload.url) window.location.assign(payload.url)
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }, [user, hostId, enqueueSnackbar])

  return (
    <CardDisplay header={'Payments'} contentGutterX contentGutterY>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="body2" sx={{ flex: 1 }}>
            {'Stripe account'}
          </Typography>
          <Chip
            size="small"
            label={chargesEnabled ? 'Charges enabled' : 'Not set up'}
            color={chargesEnabled ? 'success' : 'warning'}
            variant="outlined"
          />
        </Stack>
        {!commerceEnabled ? (
          <Alert severity="info">
            {'Selling requires a paid plan — upgrade on the billing page.'}
          </Alert>
        ) : null}
        <Typography variant="body2" color="text.secondary">
          {'Buyers pay on your own Stripe account; Aglyn collects a ' +
            'platform fee per sale based on your plan:'}
        </Typography>
        <Typography variant="body2">
          {`Physical products: ${physicalPct}% · Digital products: ${digitalPct}%`}
          {physicalPct > 0 || digitalPct > 0 ? (
            <Typography component="span" variant="caption" color="text.secondary">
              {' — higher plans reduce fees to 0%'}
            </Typography>
          ) : null}
        </Typography>
        {isOwner ? (
          <Button
            size="small"
            variant={chargesEnabled ? 'text' : 'contained'}
            color="secondary"
            disabled={busy}
            onClick={handleConnect}
            sx={{ alignSelf: 'flex-start' }}
          >
            {chargesEnabled
              ? 'Refresh status'
              : busy
                ? 'Opening Stripe…'
                : 'Set up payments'}
          </Button>
        ) : (
          <Typography variant="caption" color="text.secondary">
            {'Only the organization owner can set up payments.'}
          </Typography>
        )}
      </Stack>
    </CardDisplay>
  )
}
PaymentsSettingsCard.displayName = 'PaymentsSettingsCard'

export default PaymentsSettingsCard
