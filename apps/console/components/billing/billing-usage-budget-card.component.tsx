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
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'

/** The `get` payload of `/api/billing/usage-budget`. */
interface UsageBudgetState {
  budgetSet: boolean
  amountUsd: number | null
  thresholdPcts: number[]
  month: string
  spend: {
    meteredUsd: number
    assistUsd: number
    totalUsd: number
    assistBilled: boolean
    /** FALSE when no rollup exists for this month yet. */
    meteredFresh: boolean
  }
  defaultThresholdPcts: number[]
  minAmountUsd: number
  maxAmountUsd: number
  minThresholdPct: number
  maxThresholdPct: number
  maxThresholds: number
}

export interface BillingUsageBudgetCardProps {
  orgId?: string | null
  /** billing.manage: the controls act; view-only otherwise. */
  canManage: boolean
}

/**
 * The customer's MONTHLY USAGE BUDGET (AGL-1528) — a Google Cloud billing
 * budget, in the console.
 *
 * ## Why this card exists at all
 *
 * Zach, 2026-08-18, verbatim: "*Always make sure features are available in
 * the console and not just that the capability exists... if there are any
 * features that are the capability exists but they are not implemented in the
 * UI of the console or where appropriate then we need to add them now.*"
 *
 * The cron can evaluate a budget with no card at all. It would then be
 * alerting against a number no customer could ever have chosen — a feature
 * that exists in the sense that nobody can use it.
 *
 * ## A budget is not a cap, and the copy has to keep saying so
 *
 * Crossing a budget sends a notification and an email. Nothing stops, nothing
 * is refused, no upload fails. The hard cap is the separate card above, and
 * conflating the two is expensive in both directions: a customer who believes
 * a budget stops things will set one and be surprised twice (once by the bill
 * and once by discovering the control did nothing they expected), and a
 * budget that ever DID stop things is the failure mode AGL-1529 rejected on
 * arrival — a spend ceiling that takes a site down to save $2.
 *
 * ## Why the spend figure may be absent rather than zero
 *
 * `report-usage` writes `billedCents` daily. Early in a month, or for a
 * brand-new org, that document does not exist yet — and rendering "$0.00
 * spent" would be a claim rather than an absence. `meteredFresh` is the
 * server's own answer to which one it is, and this card renders the two
 * differently. Three outcomes, not two (the AGL-1380 rule).
 */
export default function BillingUsageBudgetCardComponent({
  orgId,
  canManage,
}: BillingUsageBudgetCardProps) {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const { confirm } = useConfirmationContext()
  const [state, setState] = useState<UsageBudgetState | null>(null)
  const [amountInput, setAmountInput] = useState('')
  const [thresholdInput, setThresholdInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadState, setLoadState] = useState<'pending' | 'error' | 'loaded'>(
    'pending',
  )
  const [retryNonce, setRetryNonce] = useState(0)

  const sendRequest = useCallback(
    async (
      body: Record<string, unknown>,
    ): Promise<{ ok: boolean; payload?: any }> => {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/billing/usage-budget', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ orgId, ...body }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        // The route's own sentence, verbatim — its 400 names the legal range
        // more precisely than anything this card could invent.
        enqueueSnackbar(payload?.error ?? 'Usage budget request failed', {
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
        const next = outcome.payload as UsageBudgetState
        setState(next)
        setAmountInput(
          next.budgetSet && next.amountUsd != null ? String(next.amountUsd) : '',
        )
        setThresholdInput(
          (next.budgetSet ? next.thresholdPcts : next.defaultThresholdPcts).join(
            ', ',
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

  const saveBudget = useCallback(async () => {
    setBusy(true)
    const dequeue = queueLoading()
    try {
      const outcome = await sendRequest({
        action: 'setBudget',
        amountUsd: Number(amountInput),
        // Split client-side purely so the field can be a comma list; the
        // route normalizes, bounds and de-duplicates whatever arrives, so
        // this is a parser and never a validator.
        thresholdPcts: thresholdInput
          .split(',')
          .map((part) => Number(part.trim()))
          .filter((pct) => Number.isFinite(pct)),
      })
      if (!outcome.ok) return
      enqueueSnackbar(
        `Budget set. We'll alert you at ${(
          outcome.payload?.thresholdPcts ?? []
        ).join('%, ')}% of $${Number(outcome.payload?.amountUsd ?? 0).toFixed(
          0,
        )}.`,
        { variant: 'success', persist: false },
      )
      setRetryNonce((nonce) => nonce + 1)
    } catch {
      enqueueSnackbar('Could not update your usage budget', {
        variant: 'warning',
        persist: false,
      })
    } finally {
      dequeue()
      setBusy(false)
    }
  }, [
    amountInput,
    thresholdInput,
    queueLoading,
    sendRequest,
    enqueueSnackbar,
  ])

  const clearBudget = useCallback(async () => {
    // The loading overlay must drop BEFORE the confirm dialog opens — it sits
    // above the dialog and swallows the Confirm click (AGL-535).
    const accepted = await confirm({
      title: 'Remove your usage budget?',
      description:
        'You will stop getting the budget alerts. Your usage and your bill ' +
        'are unaffected — a budget never limited anything — and you will ' +
        'still be warned as you approach your plan’s included allowances.',
      confirmationText: 'Remove the budget',
    })
      .then(() => true)
      .catch(() => false)
    if (!accepted) return

    setBusy(true)
    const dequeue = queueLoading()
    try {
      const outcome = await sendRequest({ action: 'clearBudget' })
      if (!outcome.ok) return
      enqueueSnackbar('Usage budget removed.', {
        variant: 'success',
        persist: false,
      })
      setRetryNonce((nonce) => nonce + 1)
    } catch {
      enqueueSnackbar('Could not remove your usage budget', {
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
        Loading your usage budget…
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
        We couldn’t load your usage budget. Nothing has changed.
      </Alert>
    )
  }

  const { budgetSet, amountUsd, thresholdPcts, spend, maxAmountUsd } = state
  const usedPct =
    budgetSet && amountUsd
      ? Math.min(100, Math.round((spend.totalUsd / amountUsd) * 100))
      : 0

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Chip
          label={budgetSet ? 'Budget set' : 'No budget set'}
          size="small"
          color={budgetSet ? 'primary' : 'default'}
        />
        {budgetSet && amountUsd != null ? (
          <Chip label={`$${amountUsd.toFixed(0)}/mo`} size="small" />
        ) : null}
        {budgetSet ? (
          <Chip
            label={`Alerts at ${thresholdPcts.join('%, ')}%`}
            size="small"
            variant="outlined"
          />
        ) : null}
      </Stack>

      {/*
        THIS MONTH, whether or not a budget exists — the number is the point,
        and an org deciding what budget to set needs to see what it spends.
      */}
      {spend.meteredFresh ? (
        <Stack spacing={0.5}>
          <Typography variant="body2">
            <strong>${spend.totalUsd.toFixed(2)}</strong> of metered usage so
            far in {state.month}
            {spend.assistBilled
              ? ` — $${spend.meteredUsd.toFixed(
                  2,
                )} usage, $${spend.assistUsd.toFixed(2)} Assist`
              : ''}
            {budgetSet && amountUsd != null
              ? ` of your $${amountUsd.toFixed(0)} budget`
              : ''}
            .
          </Typography>
          {budgetSet ? (
            <LinearProgress
              variant="determinate"
              value={usedPct}
              sx={{ height: 8, borderRadius: 1 }}
            />
          ) : null}
        </Stack>
      ) : (
        // ABSENT, not zero. `report-usage` writes the figure daily; before
        // the first run of a month there is nothing to read, and "$0.00
        // spent" would be a claim rather than an absence.
        <Typography variant="body2" color="text.secondary">
          We haven’t totalled {state.month} yet — usage is added up once a day.
          Your budget still applies from the moment you set it.
        </Typography>
      )}

      <Typography variant="body2" color="text.secondary">
        A budget is a <strong>heads-up, not a limit</strong>. We email your
        owners and admins, and post in the console, as your metered usage
        passes each percentage of the amount you choose. Nothing stops and no
        upload is refused — if you want usage to actually stop, set a storage
        cap above.
      </Typography>

      <Stack
        direction="row"
        spacing={2}
        sx={{ alignItems: 'flex-start', flexWrap: 'wrap', rowGap: 2 }}
      >
        <TextField
          label="Monthly budget (USD)"
          type="number"
          size="small"
          value={amountInput}
          disabled={!canManage || busy}
          onChange={(event) => setAmountInput(event.target.value)}
          slotProps={{
            htmlInput: { min: state.minAmountUsd, max: maxAmountUsd, step: 1 },
          }}
          helperText={`Between $${state.minAmountUsd} and $${maxAmountUsd.toLocaleString(
            'en-US',
          )}.`}
        />
        <TextField
          label="Alert me at (%)"
          size="small"
          value={thresholdInput}
          disabled={!canManage || busy}
          onChange={(event) => setThresholdInput(event.target.value)}
          helperText={`Up to ${state.maxThresholds} percentages, ${state.minThresholdPct}–${state.maxThresholdPct}. Default ${state.defaultThresholdPcts.join(', ')}.`}
        />
        <Button
          variant="outlined"
          disabled={!canManage || busy}
          onClick={saveBudget}
        >
          {budgetSet ? 'Save budget' : 'Set a budget'}
        </Button>
        {budgetSet ? (
          <Button
            variant="text"
            color="warning"
            disabled={!canManage || busy}
            onClick={clearBudget}
          >
            Remove budget
          </Button>
        ) : null}
      </Stack>

      {!canManage ? (
        <Typography variant="caption" color="text.secondary">
          You need the Manage billing permission to change your usage budget.
        </Typography>
      ) : null}
    </Stack>
  )
}
