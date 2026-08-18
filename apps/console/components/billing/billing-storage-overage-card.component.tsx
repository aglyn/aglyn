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

import { useConfirmationContext, useLoading } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Chip,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'

/** The `get` payload of `/api/billing/storage-overage`. */
interface StorageOverageState {
  /** Whether the customer has chosen a monthly cap. Absent by default. */
  capSet: boolean
  /** The cap in force, or `null` when uncapped. */
  monthlyCapUsd: number | null
  /** Whether the plan meters infra overage at all. */
  metered: boolean
  defaultCapUsd: number
  maxCapUsd: number
  includedStoragePerSiteMb: number
  /** One metered GB-month, markup included — the rate the invoice uses. */
  pricePerGbUsd: number
}

export interface BillingStorageOverageCardProps {
  orgId?: string | null
  /** billing.manage: the controls act; view-only otherwise. */
  canManage: boolean
}

/**
 * The customer's optional monthly storage cap (AGL-1957, for AGL-1886;
 * inverted 2026-08-18).
 *
 * ## What this card is now
 *
 * Zach, 2026-08-18, verbatim: *"it should be a control by the end user, to
 * prevent overage or usage alerts rather, we just want to minimize churn"*.
 *
 * So this card offers a cap and nothing is gated behind it. Storage past a
 * metered plan's included band **bills by default**; `usage-alerts` warns at
 * 80% and again at the band so the invoice is never the first anyone hears of
 * it. A customer who would rather be stopped than billed sets a number here,
 * and then — and only then — uploads are refused, citing their own limit.
 *
 * ## What it used to be, and why that was wrong
 *
 * It used to be a consent switch: `mediaStorageGate` refused every metered
 * org past its band until a manager clicked "Turn on metered storage". That
 * failed closed on the whole customer base — AGL-1957 found the route had no
 * caller at all, so no org could give the consent, so no org could store past
 * its band, so Aglyn collected nothing for capacity it would happily sell.
 *
 * The trade it made was churn for churn: it avoided bill shock by making the
 * product stop working. Alerts plus an optional cap avoid both.
 *
 * ## Why the cap is edited here and enforced there
 *
 * The route owns every refusal: a cap outside $1–$5000, a plan that never
 * bills for storage, a missing permission. This card sends the number and
 * renders the route's own answer, rather than pre-validating against
 * constants that would then be a second source of truth. The one client-side
 * check is `type="number"`, which is a keyboard affordance, not enforcement.
 *
 * ## Why clearing the cap is never gated
 *
 * `clearCap` is available on every plan and at every usage level. A customer
 * who capped themselves and now needs the files in must not have to argue
 * with a precondition to take the brakes off — so the "remove" control
 * renders whenever a cap exists, including on a plan that stopped metering.
 */
export default function BillingStorageOverageCardComponent({
  orgId,
  canManage,
}: BillingStorageOverageCardProps) {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const { confirm } = useConfirmationContext()
  const [state, setState] = useState<StorageOverageState | null>(null)
  const [ceilingInput, setCeilingInput] = useState('')
  const [busy, setBusy] = useState(false)
  /**
   * Three outcomes, not two (the AGL-1380 rule). "Metered storage is off" is a
   * claim about this org's billing consent; rendering it because a request
   * FAILED would tell an org that opted in that it had not.
   */
  const [loadState, setLoadState] = useState<'pending' | 'error' | 'loaded'>(
    'pending',
  )
  /** Bumped by Retry, and after every write, to re-run the load effect. */
  const [retryNonce, setRetryNonce] = useState(0)

  const sendRequest = useCallback(
    async (
      body: Record<string, unknown>,
    ): Promise<{ ok: boolean; payload?: any }> => {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/billing/storage-overage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ orgId, ...body }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        // The route's own sentence, verbatim. Its 400 names the legal range
        // and its 409 explains why an unmetered plan has nothing to turn on —
        // both more specific than anything this card could invent.
        enqueueSnackbar(payload?.error ?? 'Storage limit request failed', {
          variant: 'warning',
          persist: false,
        })
        return { ok: false, payload }
      }
      return { ok: true, payload }
    },
    [user, orgId, enqueueSnackbar],
  )

  useEffect(() => {
    if (!orgId || !user) return
    let cancelled = false
    setLoadState('pending')
    sendRequest({ action: 'get' })
      .then((outcome) => {
        if (cancelled) return
        if (!outcome.ok) return void setLoadState('error')
        const next = outcome.payload as StorageOverageState
        setState(next)
        // Seed the field from what is in force: the cap they set, or the
        // default the route would apply if none is sent.
        setCeilingInput(
          String(
            next.capSet && next.monthlyCapUsd != null && next.monthlyCapUsd > 0
              ? next.monthlyCapUsd
              : next.defaultCapUsd,
          ),
        )
        setLoadState('loaded')
      })
      // A rejected fetch — offline, a wedged route — never reached the
      // snackbar inside the request, so this is the only place it can become
      // something the card renders.
      .catch(() => {
        if (!cancelled) setLoadState('error')
      })
    return () => {
      cancelled = true
    }
  }, [orgId, user, sendRequest, retryNonce])

  const setCap = useCallback(async () => {
    setBusy(true)
    const dequeue = queueLoading()
    try {
      const outcome = await sendRequest({
        action: 'setCap',
        capUsd: Number(ceilingInput),
      })
      if (!outcome.ok) return
      enqueueSnackbar(
        `Storage cap set. Uploads stop once overage reaches $${Number(
          outcome.payload?.monthlyCapUsd ?? 0,
        ).toFixed(2)} a month.`,
        { variant: 'success', persist: false },
      )
      setRetryNonce((nonce) => nonce + 1)
    } catch {
      enqueueSnackbar('Could not update your storage cap', {
        variant: 'warning',
        persist: false,
      })
    } finally {
      dequeue()
      setBusy(false)
    }
  }, [ceilingInput, queueLoading, sendRequest, enqueueSnackbar])

  const clearCap = useCallback(async () => {
    // The loading overlay must drop BEFORE the confirm dialog opens — it sits
    // above the dialog and swallows the Confirm click (AGL-535). So the
    // confirm runs first and `queueLoading` only wraps the write.
    //
    // Confirmed rather than instant because removing the cap is the direction
    // that can raise a bill. Setting one never is, so it is a plain click.
    const accepted = await confirm({
      title: 'Remove your storage cap?',
      description:
        'Uploads past your included storage will keep working and the extra ' +
        'storage will be billed on your monthly invoice, with no ceiling. ' +
        'You will still be alerted as you approach and cross your included ' +
        'allowance, and you can set a cap again at any time.',
      confirmationText: 'Remove the cap',
    })
      .then(() => true)
      .catch(() => false)
    if (!accepted) return

    setBusy(true)
    const dequeue = queueLoading()
    try {
      const outcome = await sendRequest({ action: 'clearCap' })
      if (!outcome.ok) return
      enqueueSnackbar(
        'Storage cap removed. Extra storage is billed on your monthly invoice.',
        { variant: 'success', persist: false },
      )
      setRetryNonce((nonce) => nonce + 1)
    } catch {
      enqueueSnackbar('Could not remove your storage cap', {
        variant: 'warning',
        persist: false,
      })
    } finally {
      dequeue()
      setBusy(false)
    }
  }, [confirm, queueLoading, sendRequest, enqueueSnackbar])

  if (loadState === 'pending') {
    return (
      <Typography variant="body2" color="text.secondary">
        Loading your storage settings…
      </Typography>
    )
  }

  if (loadState === 'error' || !state) {
    return (
      <Alert
        severity="warning"
        action={
          <Button
            size="small"
            color="inherit"
            onClick={() => setRetryNonce((nonce) => nonce + 1)}
          >
            Retry
          </Button>
        }
      >
        We couldn’t load your storage settings. Nothing has changed.
      </Alert>
    )
  }

  const {
    capSet,
    metered,
    monthlyCapUsd,
    maxCapUsd,
    includedStoragePerSiteMb,
    pricePerGbUsd,
  } = state

  // A plan that never bills for storage has no overage for a cap to bound, so
  // there is nothing to configure. Say that plainly rather than rendering a
  // control the route would refuse with a 409 — but keep the "remove" control
  // below reachable for an org that capped itself and then moved plans.
  const nothingToCap = !metered && !capSet

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Chip
          label={capSet ? 'Monthly cap set' : 'No cap — extra storage bills'}
          size="small"
          color={capSet ? 'primary' : 'default'}
        />
        {capSet && monthlyCapUsd != null ? (
          <Chip label={`$${monthlyCapUsd.toFixed(2)}/mo cap`} size="small" />
        ) : null}
      </Stack>

      {nothingToCap ? (
        <Alert severity="info">
          Your plan gives each site a fixed{' '}
          {Math.round(includedStoragePerSiteMb)} MB of storage. Uploads stop at
          that limit and you are <strong>never charged</strong> for storage, so
          there is no overage to cap. Upgrade above to store more.
        </Alert>
      ) : !capSet ? (
        <>
          <Typography variant="body2" color="text.secondary">
            Each site includes {Math.round(includedStoragePerSiteMb)} MB. Past
            that, uploads <strong>keep working</strong> and the extra storage
            is billed at about ${pricePerGbUsd.toFixed(3)} per GB a month. We
            alert you as you approach your included storage and again when you
            cross it, so nothing arrives as a surprise.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            If you would rather uploads stopped than be billed, set a monthly
            cap. This is optional — most people leave it off.
          </Typography>
          <Stack
            direction="row"
            spacing={2}
            sx={{ alignItems: 'flex-start', flexWrap: 'wrap', rowGap: 2 }}
          >
            <TextField
              label="Monthly cap (USD)"
              type="number"
              size="small"
              value={ceilingInput}
              disabled={!canManage || busy}
              onChange={(event) => setCeilingInput(event.target.value)}
              slotProps={{ htmlInput: { min: 1, max: maxCapUsd, step: 1 } }}
              helperText={`Between $1 and $${maxCapUsd}. We stop accepting uploads once your storage overage reaches this amount.`}
            />
            <Button
              variant="outlined"
              disabled={!canManage || busy}
              onClick={setCap}
            >
              Set a monthly cap
            </Button>
          </Stack>
        </>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary">
            {metered
              ? `Uploads past your included ${Math.round(
                  includedStoragePerSiteMb,
                )} MB per site are billed at about $${pricePerGbUsd.toFixed(
                  3,
                )} per GB a month — until your storage overage reaches $${(
                  monthlyCapUsd ?? 0
                ).toFixed(
                  2,
                )} a month, where you asked us to stop accepting uploads.`
              : `Your plan no longer bills for storage, so this cap is not ` +
                `doing anything. You can safely remove it.`}
          </Typography>
          <Stack
            direction="row"
            spacing={2}
            sx={{ alignItems: 'flex-start', flexWrap: 'wrap', rowGap: 2 }}
          >
            {metered ? (
              <>
                <TextField
                  label="Monthly cap (USD)"
                  type="number"
                  size="small"
                  value={ceilingInput}
                  disabled={!canManage || busy}
                  onChange={(event) => setCeilingInput(event.target.value)}
                  slotProps={{ htmlInput: { min: 1, max: maxCapUsd, step: 1 } }}
                  helperText={`Between $1 and $${maxCapUsd}.`}
                />
                <Button
                  variant="outlined"
                  disabled={!canManage || busy}
                  onClick={setCap}
                >
                  Save cap
                </Button>
              </>
            ) : null}
            <Button
              variant="text"
              color="warning"
              disabled={!canManage || busy}
              onClick={clearCap}
            >
              Remove cap
            </Button>
          </Stack>
        </>
      )}

      {!canManage ? (
        <Typography variant="caption" color="text.secondary">
          You need the Manage billing permission to change your storage cap.
        </Typography>
      ) : null}
    </Stack>
  )
}
