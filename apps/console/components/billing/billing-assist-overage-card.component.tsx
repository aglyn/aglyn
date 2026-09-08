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
  FormControlLabel,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'

/** The `get` payload of `/api/billing/assist-overage`. */
interface AssistOverageState {
  /** Whether the org asked to be stopped at its band. Absent by default. */
  hardCap: boolean
  /** The plan's included credits a month, or `null` where it sells none. */
  bandCredits: number | null
  /** The per-1,000 rate credits past the band bill at, or `null`. */
  overageRateUsdPer1k: number | null
  /** True when there is a band AND a rate to sell past it at. */
  sellsOverage: boolean
  /** The switch's label, served so the refusal and the switch share it. */
  label: string
}

export interface BillingAssistOverageCardProps {
  orgId?: string | null
  /** billing.manage: the switch acts; view-only otherwise. */
  canManage: boolean
}

/**
 * The org's own hard cap on AI assist (AGL-2653).
 *
 * ## What this card is
 *
 * Credits past a plan's included assist band are SOLD by default, at the
 * plan's per-1,000 rate, the way storage past its band bills by default. This
 * card offers the one control a customer has over that: a switch that makes
 * the band a wall instead, so the assistant refuses there and nothing past it
 * is ever billed. It is optional and off unless chosen — the storage cap's
 * sibling, for the same reason a ceiling on metered spend is the END USER's
 * control, offered rather than imposed.
 *
 * ## Why it is a switch and not a number
 *
 * Storage takes a dollar figure because its band is one site's allowance and
 * the org may want to be stopped somewhere above it. Assist has one band per
 * org and the question is only whether to sell past it; a figure here would
 * be a second band to drift from the first.
 *
 * ## Why the switch is edited here and enforced there
 *
 * The route owns every refusal: a plan that sells no overage, a value that
 * is not a boolean, a missing permission. This card sends the boolean and
 * renders the route's own answer rather than pre-validating against constants
 * that would then be a second source of truth. The rate it quotes arrives on
 * the same payload, so what the card says the overage costs is what the
 * invoice bills.
 *
 * ## Why turning it OFF is confirmed and turning it ON is not
 *
 * Off is the direction that can raise a bill, so it asks; on never raises
 * one, so it is a plain click. Off is also always available, on any plan and
 * from any state — an org that wants the sale back must not have to argue
 * with a precondition.
 */
export default function BillingAssistOverageCardComponent({
  orgId,
  canManage,
}: BillingAssistOverageCardProps) {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const { confirm } = useConfirmationContext()
  const [state, setState] = useState<AssistOverageState | null>(null)
  const [busy, setBusy] = useState(false)
  /**
   * Three outcomes, not two (the AGL-1380 rule). "The assistant keeps going
   * past your band" is a claim about this org's billing settings; rendering
   * it because a request FAILED would tell an org that asked to be stopped
   * that it had not.
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
      const response = await authorizedFetch(
        user,
        '/api/billing/assist-overage',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orgId, ...body }),
        },
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        // The route's own sentence, verbatim: its 409 explains why a plan
        // with no rate has nothing to switch, which is more specific than
        // anything this card could invent.
        enqueueSnackbar(payload?.error ?? 'AI assist setting request failed', {
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
        const next = outcome.payload as AssistOverageState
        // A card that cannot name the price must not quote one. The rate
        // appears in the sentence beside the switch whenever overage is
        // sold, and a defaulted 0 would tell a person about to leave the
        // switch off that the extra costs "$0.00 per 1,000". A payload that
        // says overage is sold but cannot say at what is a LOAD FAILURE.
        if (
          typeof next?.hardCap !== 'boolean' ||
          typeof next?.sellsOverage !== 'boolean' ||
          (next.sellsOverage &&
            (!Number.isFinite(Number(next.overageRateUsdPer1k)) ||
              !Number.isFinite(Number(next.bandCredits))))
        ) {
          return void setLoadState('error')
        }
        setState(next)
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

  const setHardCap = useCallback(
    async (hardCap: boolean) => {
      const rate = state?.overageRateUsdPer1k
      if (!hardCap) {
        // The loading overlay must drop BEFORE the confirm dialog opens — it
        // sits above the dialog and swallows the Confirm click (AGL-535). So
        // the confirm runs first and `queueLoading` only wraps the write.
        const accepted = await confirm({
          title: 'Keep AI assist going past your included credits?',
          description:
            'The assistant will keep answering once your included credits ' +
            'are used, and the extra credits will be billed on your monthly ' +
            `invoice${
              rate != null ? ` at $${rate.toFixed(2)} per 1,000` : ''
            }. You can turn the stop back on at any time.`,
          confirmationText: 'Keep going',
        })
          .then(() => true)
          .catch(() => false)
        if (!accepted) return
      }

      setBusy(true)
      const dequeue = queueLoading()
      try {
        const outcome = await sendRequest({ action: 'setHardCap', hardCap })
        if (!outcome.ok) return
        enqueueSnackbar(
          hardCap
            ? 'AI assist will stop at your included credits. Nothing past ' +
                'the band is billed.'
            : 'AI assist keeps going past your included credits' +
                (rate != null
                  ? `, billed at $${rate.toFixed(2)} per 1,000.`
                  : '.'),
          { variant: 'success', persist: false },
        )
        setRetryNonce((nonce) => nonce + 1)
      } catch {
        enqueueSnackbar('Could not update your AI assist setting', {
          variant: 'warning',
          persist: false,
        })
      } finally {
        dequeue()
        setBusy(false)
      }
    },
    [state, confirm, queueLoading, sendRequest, enqueueSnackbar],
  )

  if (loadState === 'pending') {
    return (
      <Typography variant="body2" color="text.secondary">
        Loading your AI assist settings…
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
        We couldn’t load your AI assist settings. Nothing has changed.
      </Alert>
    )
  }

  const { hardCap, bandCredits, overageRateUsdPer1k, sellsOverage, label } =
    state
  const band = bandCredits == null ? null : Math.round(bandCredits)
  const rate = overageRateUsdPer1k == null ? null : overageRateUsdPer1k.toFixed(2)

  // A plan that sells no overage has nothing for the switch to stop, so
  // there is nothing to configure. Say that plainly rather than rendering a
  // switch the route would refuse with a 409 — but keep the switch reachable
  // for an org that turned it on and then moved to a plan that sells none,
  // so it can turn it off.
  const nothingToStop = !sellsOverage && !hardCap

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Chip
          label={
            hardCap
              ? 'Stops at the included band'
              : nothingToStop
                ? band === null
                  ? 'No AI assist credits'
                  : 'Included credits only'
                : 'No stop — extra credits bill'
          }
          size="small"
          color={hardCap ? 'primary' : 'default'}
        />
        {band !== null ? (
          <Chip label={`${band.toLocaleString()} credits/mo included`} size="small" />
        ) : null}
      </Stack>

      {nothingToStop && band === null ? (
        <Alert severity="info">
          Your plan includes no AI assist credits, so there is no band to stop
          at and nothing to configure here. Upgrade above to add AI assist.
        </Alert>
      ) : nothingToStop ? (
        // Enterprise: a band, and no rate to sell past it at. The assistant
        // stops at the band on its own and nothing is ever billed for it.
        <Alert severity="info">
          Your plan includes <strong>{band?.toLocaleString()}</strong> AI assist
          credits a month and sells none past them: the assistant stops at the
          included band and you are <strong>never charged</strong> for AI
          assist, so there is nothing to switch.
        </Alert>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary">
            {sellsOverage
              ? `Your plan includes ${band?.toLocaleString()} AI assist credits ` +
                `a month. Past that, the assistant keeps answering and the ` +
                `extra credits are billed at $${rate} per 1,000 on your ` +
                `monthly invoice.`
              : `Your plan no longer sells AI assist credits past its band, ` +
                `so this switch is not doing anything. You can safely turn ` +
                `it off.`}
          </Typography>
          {sellsOverage ? (
            <Typography variant="body2" color="text.secondary">
              If you would rather the assistant stopped at the included band,
              turn this on. This is optional — most people leave it off.
            </Typography>
          ) : null}
          <Stack spacing={0.5}>
            <FormControlLabel
              control={
                <Switch
                  checked={hardCap}
                  disabled={!canManage || busy || (!hardCap && !sellsOverage)}
                  onChange={(event) => void setHardCap(event.target.checked)}
                />
              }
              label={label}
            />
            <Typography variant="caption" color="text.secondary">
              {hardCap
                ? `On: the assistant stops once your included credits are ` +
                  `used, and you are never billed for AI assist.` +
                  (sellsOverage
                    ? ` Turn it off to keep going at $${rate} per 1,000 credits.`
                    : '')
                : `Off: extra credits past the included band are billed at ` +
                  `$${rate} per 1,000.`}
            </Typography>
          </Stack>
        </>
      )}

      {!canManage ? (
        <Typography variant="caption" color="text.secondary">
          You need the Manage billing permission to change this.
        </Typography>
      ) : null}
    </Stack>
  )
}
