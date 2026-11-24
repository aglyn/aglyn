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
import { Alert, AlertTitle, Box, Button, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  STRIPE_TAX_REGISTRATIONS_DASHBOARD_URL,
  STRIPE_TAX_SETTINGS_DASHBOARD_URL,
  STRIPE_TAX_STEP_TEXT,
  type StoreTaxReadiness,
  type StripeTaxSetupStep,
} from '../../model/commerce-tax-readiness'

export type StoreTaxReadinessState = 'loading' | 'ready' | 'error'

export interface StoreTaxReadinessRead {
  state: StoreTaxReadinessState
  /** The route's answer; null until it has answered once. */
  data: StoreTaxReadiness | null
  /** Asks again, past the route's short cache ("Check again"). */
  recheck(): void
  /** A recheck is on its way. */
  checking: boolean
}

/**
 * The store's sales tax readiness (AGL-4245), from
 * `GET /api/commerce/tax-readiness`. `key` re-asks when it changes: the
 * Taxes card passes the saved mode, so saving a choice reads the store again
 * (which is also what clears the owner's refusal alert on the server).
 */
export function useStoreTaxReadiness(
  hostId: string | undefined,
  key?: unknown,
): StoreTaxReadinessRead {
  const { data: user } = useUser()
  // Keyed on the uid, not the user object: a refreshed token is a new object.
  const userRef = useRef(user)
  userRef.current = user
  const uid = user?.uid
  const [state, setState] = useState<StoreTaxReadinessState>('loading')
  const [data, setData] = useState<StoreTaxReadiness | null>(null)
  const [nonce, setNonce] = useState(0)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    const current = userRef.current
    if (!uid || !current || !hostId) return
    let cancelled = false
    const fresh = nonce > 0 ? '&fresh=1' : ''
    void (async () => {
      try {
        const response = await authorizedFetch(
          current,
          `/api/commerce/tax-readiness?hostId=${encodeURIComponent(hostId)}${fresh}`,
        )
        if (cancelled) return
        if (!response.ok) {
          setState('error')
          return
        }
        const payload = (await response.json()) as StoreTaxReadiness
        if (cancelled) return
        setData(payload && typeof payload === 'object' ? payload : null)
        setState('ready')
      } catch {
        if (!cancelled) setState('error')
      } finally {
        if (!cancelled) setChecking(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [uid, hostId, nonce, key])

  const recheck = useCallback(() => {
    setChecking(true)
    setNonce((value) => value + 1)
  }, [])

  return { state, data, recheck, checking }
}

/** The tax options the card offers, by the label its select shows. */
export type TaxModeChoice = 'manual' | 'stripe' | 'none'

/** "Turned away on 24 Nov", or null without a date. */
export function refusedOnText(refusedAtMs: number | null | undefined): string | null {
  if (!refusedAtMs || !Number.isFinite(refusedAtMs)) return null
  const day = new Date(refusedAtMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `A shopper was turned away at checkout on ${day}.`
}

const stepsFor = (missing: readonly StripeTaxSetupStep[]): StripeTaxSetupStep[] =>
  missing.length ? [...missing] : ['head-office']

export interface StripeTaxReadinessPanelProps {
  readiness: StoreTaxReadinessRead
  /** The mode saved on the store; null when none was ever saved. */
  savedMode: string | null | undefined
  /** Picks another tax option on the card (the owner still saves it). */
  onChooseMode(mode: TaxModeChoice): void
}

/**
 * What the Taxes card shows under "Stripe Tax (automatic)" (AGL-4245), in
 * place of the old "Activate Stripe Tax in your Stripe dashboard first."
 *
 * Only a store on its own Stripe account has a Stripe Tax of its own to set
 * up. For one that has not finished it, the panel says what checkout does
 * because of it, lists exactly what Stripe says is left, opens the right
 * Stripe Dashboard page, re-reads on "Check again", and offers the options
 * that work today. Shown before Stripe Tax is saved too, so the owner knows
 * before they choose it.
 */
export function StripeTaxReadinessPanel(props: StripeTaxReadinessPanelProps) {
  const { readiness, savedMode, onChooseMode } = props
  const answer = readiness.data
  const checkAgain = (
    <Button size="small" variant="outlined" onClick={readiness.recheck} disabled={readiness.checking}>
      {readiness.checking ? 'Checking…' : 'Check again'}
    </Button>
  )
  if (!answer) {
    if (readiness.state === 'error') {
      return (
        <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
          <Typography variant="body2" color="text.secondary">
            {'Stripe Tax works out the tax for each buyer’s location at checkout. ' +
              'We couldn’t check its setup just now.'}
          </Typography>
          {checkAgain}
        </Stack>
      )
    }
    return (
      <Typography variant="body2" color="text.secondary">
        {'Stripe Tax works out the tax for each buyer’s location at checkout.'}
      </Typography>
    )
  }
  if (!answer.direct || !answer.stripeTax) {
    return (
      <Typography variant="body2" color="text.secondary">
        {'Stripe Tax works out the tax for each buyer’s location at checkout.'}
      </Typography>
    )
  }
  const stripeTax = answer.stripeTax
  if (stripeTax.active) {
    return (
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary" role="status">
          {'Stripe Tax is on in your Stripe account. It works out the tax for each buyer’s location at checkout.'}
        </Typography>
        {stripeTax.hasRegistration === false ? (
          <Alert
            severity="info"
            action={
              <Button
                color="inherit"
                size="small"
                component="a"
                href={STRIPE_TAX_REGISTRATIONS_DASHBOARD_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                {'Add a place'}
              </Button>
            }
          >
            {'Stripe Tax adds no tax until you add at least one place you collect tax.'}
          </Alert>
        ) : null}
      </Stack>
    )
  }

  const saved = savedMode === 'stripe'
  const steps = stepsFor(stripeTax.missing)
  const needsSettings = steps.some((step) => step !== 'registration')
  const refused = saved ? refusedOnText(answer.refusedAtMs) : null
  return (
    <Alert severity="warning" role="alert">
      <AlertTitle>
        {saved
          ? 'Shoppers can’t check out until Stripe Tax is on'
          : 'Stripe Tax isn’t on in your Stripe account yet'}
      </AlertTitle>
      <Stack spacing={1.25}>
        <Typography variant="body2">
          {!stripeTax.readable
            ? 'We couldn’t check Stripe Tax in your Stripe account just now. Until it reads as on, checkout stays off.'
            : saved
              ? 'Checkout is off while Stripe Tax is unfinished, so no order is sold without tax. What’s left in Stripe:'
              : 'If you save Stripe Tax now, shoppers can’t check out until it is on. What’s left in Stripe:'}
        </Typography>
        {stripeTax.readable ? (
          <Box component="ol" sx={{ m: 0, pl: 3 }}>
            {steps.map((step) => (
              <li key={step}>
                <Typography variant="body2">{STRIPE_TAX_STEP_TEXT[step]}</Typography>
              </li>
            ))}
          </Box>
        ) : null}
        {refused ? <Typography variant="body2">{refused}</Typography> : null}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { xs: 'flex-start', sm: 'center' } }}>
          {needsSettings || !stripeTax.readable ? (
            <Button
              size="small"
              variant="contained"
              color="inherit"
              component="a"
              href={STRIPE_TAX_SETTINGS_DASHBOARD_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              {'Open Stripe Tax settings'}
            </Button>
          ) : null}
          {steps.includes('registration') ? (
            <Button
              size="small"
              variant={needsSettings ? 'outlined' : 'contained'}
              color="inherit"
              component="a"
              href={STRIPE_TAX_REGISTRATIONS_DASHBOARD_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              {'Open tax registrations'}
            </Button>
          ) : null}
          {checkAgain}
        </Stack>
        <Typography variant="body2">
          {saved
            ? 'To take orders now, choose another option and save. You can switch back once Stripe Tax is on.'
            : 'You can turn it on first and come back, or use another option that works today.'}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          <Button size="small" color="inherit" onClick={() => onChooseMode('manual')}>
            {'Use manual rates'}
          </Button>
          <Button size="small" color="inherit" onClick={() => onChooseMode('none')}>
            {'Don’t collect sales tax'}
          </Button>
        </Stack>
      </Stack>
    </Alert>
  )
}
StripeTaxReadinessPanel.displayName = 'StripeTaxReadinessPanel'

export default StripeTaxReadinessPanel
