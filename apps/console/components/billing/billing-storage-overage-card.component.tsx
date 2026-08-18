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
  acknowledged: boolean
  monthlyCeilingUsd: number
  /** Whether the plan meters infra overage at all. */
  metered: boolean
  defaultCeilingUsd: number
  maxCeilingUsd: number
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
 * Turn on metered storage, and set the monthly bound (AGL-1957, for AGL-1886).
 *
 * ## What was actually broken
 *
 * AGL-1886 built a soft cap with an acknowledged opt-in, and wired the gate
 * into all four media ingress paths: past the included allowance,
 * `mediaStorageGate` refuses with `overage_optin_required` and a message that
 * says *"turn it on in Billing to keep uploading"*. **There was nothing in
 * Billing to turn on.** `/api/billing/storage-overage` — the only writer of
 * `org.storageOverage`, and the only way to give that consent — had zero
 * callers in the repo.
 *
 * So the soft cap could never be exercised by anybody. Every metered org was
 * held at the hard cap AGL-1886 was opened to escape, and was told to go
 * somewhere that did not exist. This card is that somewhere.
 *
 * The reassuring half of the finding, and it is worth stating because it is
 * the property Zach's condition asked for: nobody was ever billed for storage
 * they had not agreed to. The gate fails CLOSED, so the missing surface cost
 * revenue and sent customers into a dead end — it did not produce a surprise
 * bill. Had the gate defaulted the other way, the same missing surface would
 * have been silent billing.
 *
 * ## Why the ceiling is edited here and enforced there
 *
 * The route owns every refusal: a ceiling outside $1–$5000, a plan that does
 * not meter, a missing permission. This card sends the number and renders the
 * route's own answer, rather than pre-validating against constants that would
 * then be a second source of truth for what a legal ceiling is. The one
 * client-side check is `type="number"` on the field, which is a keyboard
 * affordance and not an enforcement.
 *
 * ## Why turning it off is never gated
 *
 * `revoke` is available on every plan and at every usage level, including to
 * an org already over its allowance and to a plan that stopped metering.
 * Withdrawing consent must never be harder than giving it, or an org that
 * changed its mind would be stuck accruing — so the "off" control renders
 * whenever an acknowledgement exists, even in the states where the "on"
 * control does not.
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
        // Seed the field from what is in force: the acknowledged ceiling, or
        // the default the route would apply if none is sent.
        setCeilingInput(
          String(
            next.acknowledged && next.monthlyCeilingUsd > 0
              ? next.monthlyCeilingUsd
              : next.defaultCeilingUsd,
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

  const acknowledge = useCallback(async () => {
    setBusy(true)
    const dequeue = queueLoading()
    try {
      const outcome = await sendRequest({
        action: 'acknowledge',
        monthlyCeilingUsd: Number(ceilingInput),
      })
      if (!outcome.ok) return
      enqueueSnackbar(
        `Metered storage is on, capped at $${Number(
          outcome.payload?.monthlyCeilingUsd ?? 0,
        ).toFixed(2)} a month.`,
        { variant: 'success', persist: false },
      )
      setRetryNonce((nonce) => nonce + 1)
    } catch {
      enqueueSnackbar('Could not update your storage limit', {
        variant: 'warning',
        persist: false,
      })
    } finally {
      dequeue()
      setBusy(false)
    }
  }, [ceilingInput, queueLoading, sendRequest, enqueueSnackbar])

  const revoke = useCallback(async () => {
    // The loading overlay must drop BEFORE the confirm dialog opens — it sits
    // above the dialog and swallows the Confirm click (AGL-535). So the
    // confirm runs first and `queueLoading` only wraps the write.
    const accepted = await confirm({
      title: 'Turn off metered storage?',
      description:
        'New uploads past your included storage will be refused again, and ' +
        'you will not be billed for storage overage. Nothing is deleted — ' +
        'files you have already stored stay exactly where they are, and you ' +
        'can turn this back on at any time.',
      confirmationText: 'Turn it off',
    })
      .then(() => true)
      .catch(() => false)
    if (!accepted) return

    setBusy(true)
    const dequeue = queueLoading()
    try {
      const outcome = await sendRequest({ action: 'revoke' })
      if (!outcome.ok) return
      enqueueSnackbar(
        'Metered storage is off. Uploads past your included storage will be ' +
          'refused.',
        { variant: 'success', persist: false },
      )
      setRetryNonce((nonce) => nonce + 1)
    } catch {
      enqueueSnackbar('Could not turn off metered storage', {
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
    acknowledged,
    metered,
    monthlyCeilingUsd,
    maxCeilingUsd,
    includedStoragePerSiteMb,
    pricePerGbUsd,
  } = state

  // A plan with a fixed band has no metered line for consent to attach to, so
  // there is nothing to turn on. Say that plainly rather than rendering a
  // control the route would refuse with a 409 — but keep the "off" switch
  // below reachable for an org that acknowledged and then moved plans.
  const nothingToTurnOn = !metered && !acknowledged

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Chip
          label={acknowledged ? 'Metered storage on' : 'Metered storage off'}
          size="small"
          color={acknowledged ? 'primary' : 'default'}
        />
        {acknowledged ? (
          <Chip
            label={`$${monthlyCeilingUsd.toFixed(2)}/mo limit`}
            size="small"
          />
        ) : null}
      </Stack>

      {nothingToTurnOn ? (
        <Alert severity="info">
          Your plan gives each site a fixed{' '}
          {Math.round(includedStoragePerSiteMb)} MB of storage, so there is
          nothing to meter and nothing to turn on. Uploads stop at that limit
          and you are never charged for storage. Upgrade above to store more.
        </Alert>
      ) : !acknowledged ? (
        <>
          <Typography variant="body2" color="text.secondary">
            Each site includes {Math.round(includedStoragePerSiteMb)} MB. Past
            that, uploads are <strong>refused</strong> unless you turn on
            metered storage — it costs about ${pricePerGbUsd.toFixed(3)} per GB
            a month, and you will never be billed more than the limit you set
            here.
          </Typography>
          <Stack
            direction="row"
            spacing={2}
            sx={{ alignItems: 'flex-start', flexWrap: 'wrap', rowGap: 2 }}
          >
            <TextField
              label="Monthly limit (USD)"
              type="number"
              size="small"
              value={ceilingInput}
              disabled={!canManage || busy}
              onChange={(event) => setCeilingInput(event.target.value)}
              slotProps={{ htmlInput: { min: 1, max: maxCeilingUsd, step: 1 } }}
              helperText={`Between $1 and $${maxCeilingUsd}. We stop accepting uploads at this amount.`}
            />
            <Button
              variant="contained"
              disabled={!canManage || busy}
              onClick={acknowledge}
            >
              Turn on metered storage
            </Button>
          </Stack>
        </>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary">
            {metered
              ? `Uploads past your included ${Math.round(
                  includedStoragePerSiteMb,
                )} MB per site are accepted and billed at about $${pricePerGbUsd.toFixed(
                  3,
                )} per GB a month, up to $${monthlyCeilingUsd.toFixed(
                  2,
                )} a month. Past that, uploads are refused — you are never billed above this limit.`
              : `Your plan no longer meters storage, so this setting is not ` +
                `charging you anything. You can safely turn it off.`}
          </Typography>
          <Stack
            direction="row"
            spacing={2}
            sx={{ alignItems: 'flex-start', flexWrap: 'wrap', rowGap: 2 }}
          >
            {metered ? (
              <>
                <TextField
                  label="Monthly limit (USD)"
                  type="number"
                  size="small"
                  value={ceilingInput}
                  disabled={!canManage || busy}
                  onChange={(event) => setCeilingInput(event.target.value)}
                  slotProps={{ htmlInput: { min: 1, max: maxCeilingUsd, step: 1 } }}
                  helperText={`Between $1 and $${maxCeilingUsd}.`}
                />
                <Button
                  variant="outlined"
                  disabled={!canManage || busy}
                  onClick={acknowledge}
                >
                  Save limit
                </Button>
              </>
            ) : null}
            <Button
              variant="text"
              color="warning"
              disabled={!canManage || busy}
              onClick={revoke}
            >
              Turn off metered storage
            </Button>
          </Stack>
        </>
      )}

      {!canManage ? (
        <Typography variant="caption" color="text.secondary">
          You need the Manage billing permission to change your storage limit.
        </Typography>
      ) : null}
    </Stack>
  )
}
