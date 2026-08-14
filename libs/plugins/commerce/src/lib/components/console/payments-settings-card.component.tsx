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

import { trackEvent } from '@aglyn/aglyn/app-utils/analytics-events'
import * as Aglyn from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Alert, Button, Chip, Stack, Typography } from '@mui/material'
import { doc } from 'firebase/firestore'
import { useCallback, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { useFirestoreDoc } from '@aglyn/tenant-feature-instance'
import { useOrgPlan } from '@aglyn/tenant-feature-instance'

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
  const { org, ready: planReady } = useOrgPlan(hostId)
  /** Bumped by Retry to re-subscribe the profile listen (AGL-1380). */
  const [retryNonce, setRetryNonce] = useState(0)
  const uid = (user as any)?.uid as string | undefined
  const { data: profile, status: profileStatus } = useFirestoreDoc<any>(
    // Held at null rather than addressed as `profiles/-pending-` — that
    // sentinel issued a guaranteed-denied read on every pre-auth mount, and
    // a denial lands in `status: 'error'`, which now means something.
    () => (uid ? doc(firestore, 'profiles', uid) : null),
    [firestore, uid, retryNonce],
  )
  const isOwner = Boolean(
    org?.ownerUid && (user as any)?.uid === org.ownerUid,
  )
  /**
   * Three outcomes, not two (AGL-1380). An absent profile doc is the value
   * BEFORE an answer as much as it is the value of a merchant who never
   * connected Stripe, so "Not set up" off a falsy `stripeChargesEnabled` is a
   * claim about this org's payment setup made without having heard back. It
   * is wrong in the direction that provokes action: the same falsy value
   * turns the button into "Set up payments", which sends a merchant who is
   * already taking money into Stripe onboarding.
   */
  const stripeState: 'pending' | 'error' | 'loaded' =
    !uid || profileStatus === 'loading'
      ? 'pending'
      : profileStatus === 'error'
        ? 'error'
        : 'loaded'
  const chargesEnabled =
    stripeState === 'loaded' && Boolean(profile?.stripeChargesEnabled)
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
        // "% who connect Stripe" — a GTM plan §6 activation metric
        // (AGL-1561). Gated on the TRANSITION, not the state: this handler
        // is a re-entrant create-or-resume, so it answers `chargesEnabled:
        // true` on every subsequent visit to a connected account, and a bare
        // event here would count one merchant once per click forever.
        // `chargesEnabled` is the state read from the profile BEFORE this
        // request, so the event fires only when onboarding actually completed.
        if (!chargesEnabled) trackEvent('stripe_connected', {})
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
  }, [user, hostId, chargesEnabled, enqueueSnackbar])

  return (
    <CardDisplay header={'Payments'} contentGutterX contentGutterY>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="body2" sx={{ flex: 1 }}>
            {'Stripe account'}
          </Typography>
          {/*
            No chip at all on error: both labels it could carry — "Charges
            enabled" and "Not set up" — assert something we failed to find
            out. Whatever Stripe is doing right now it carries on doing.
          */}
          {stripeState === 'error' ? null : (
            <Chip
              size="small"
              label={
                stripeState === 'pending'
                  ? 'Checking…'
                  : chargesEnabled
                    ? 'Charges enabled'
                    : 'Not set up'
              }
              color={
                stripeState === 'pending'
                  ? 'default'
                  : chargesEnabled
                    ? 'success'
                    : 'warning'
              }
              variant="outlined"
            />
          )}
        </Stack>
        {stripeState === 'error' ? (
          <Alert
            severity="error"
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => setRetryNonce((n) => n + 1)}
              >
                {'Retry'}
              </Button>
            }
          >
            {'We couldn’t load your payment setup. This says nothing about ' +
              'whether payments are on — we could not reach the setting to ' +
              'find out. Nothing has changed.'}
          </Alert>
        ) : null}
        {/*
          Every line below reads the plan, and an org doc still in flight
          resolves to the FREE tier (AGL-1064) — which would flash "Selling
          requires a paid plan" and the wrong fee percentages at a paying
          seller, then correct itself. Say nothing until it is known.
        */}
        {!planReady ? (
          <Typography variant="body2" color="text.secondary">
            {'Checking your plan…'}
          </Typography>
        ) : (
          <>
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
                <Typography
                  component="span"
                  variant="caption"
                  color="text.secondary"
                >
                  {' — higher plans reduce fees to 0%'}
                </Typography>
              ) : null}
            </Typography>
          </>
        )}
        {/*
          The button's own label is a claim — "Set up payments" tells the
          owner they have none. Withheld until the answer is in, for the same
          reason as the chip (AGL-1380); on error the Retry above is the only
          action offered, because acting on a setup we could not read is how
          a connected merchant gets sent back through onboarding.
        */}
        {!planReady || stripeState !== 'loaded' ? null : isOwner ? (
          <Button
            size="small"
            variant={chargesEnabled ? 'text' : 'contained'}
            color="primary"
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
