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

import { CardDisplay, useConfirmationContext, useLoading } from '@aglyn/shared-ui-jsx'
import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Chip,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { aiAddonName } from '@aglyn/aglyn'
import {
  ASSIST_OVERAGE_CAP_CONTROL_LABEL,
  ASSIST_OVERAGE_CAP_MAX_USD,
  ASSIST_OVERAGE_CAP_MIN_USD,
} from '@aglyn/aglyn/app-utils/assist-credits'

/** The `get` payload of `/api/billing/assist-overage`. */
interface AssistOverageState {
  /** Whether the org asked to be stopped at its band. Absent by default. */
  hardCap: boolean
  /** The org's ceiling on this month's overage in USD, or `null` for none. */
  capUsd: number | null
  /** The plan's included credits a month, or `null` where it sells none. */
  bandCredits: number | null
  /** The per-1,000 rate credits past the band bill at, or `null`. */
  overageRateUsdPer1k: number | null
  /** True when there is a band AND a rate to sell past it at. */
  sellsOverage: boolean
  /** The switch's label, served so the refusal and the switch share it. */
  label: string
  /** The ceiling's label, served for the same reason. */
  capLabel: string
  /** The range the route accepts for the ceiling. */
  minCapUsd: number
  maxCapUsd: number
}

export interface BillingAssistOverageCardProps {
  orgId?: string | null
  /** billing.manage: the switch acts; view-only otherwise. */
  canManage: boolean
}

/**
 * The org's own controls on AI assist spend: the hard cap at the band
 * (AGL-2653) and the dollar ceiling on overage (AGL-2898).
 *
 * ## What this card is
 *
 * Credits past a plan's included assist band are SOLD by default, at the
 * plan's per-1,000 rate, the way storage past its band bills by default. This
 * card offers the two controls a customer has over that: a switch that makes
 * the band a wall, so the assistant refuses there and nothing past it is ever
 * billed; and, with the switch off, a monthly ceiling in dollars on the
 * overage the org will buy before the assistant stops. Both are optional and
 * unset unless chosen — the storage cap's siblings, for the same reason a
 * ceiling on metered spend is the END USER's control, offered rather than
 * imposed.
 *
 * ## Why a switch AND a number
 *
 * The switch answers "sell past the band at all?" and needs no figure: the
 * band is the plan's, and a second band here would drift from it. The
 * ceiling answers "and if so, how much?", which is a figure only the customer
 * can name — it is a bound on THEIR invoice, not a quantity the plan sold.
 * The ceiling is offered only while the switch is off, because past a wall
 * there is no overage to bound.
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
/**
 * The card as the Billing → Usage page's plugin band mounts it (AGL-2939):
 * the overage controls under the heading and help the page used to draw
 * around them.
 */
export default function BillingAssistOverageCard(props: BillingAssistOverageCardProps) {
  return (
    <div id="assist-overage">
      <CardDisplay
        header={'AI credits overage'}
        subheader={
          'Extra AI credits past your included band are billed on your ' +
          'monthly invoice. Stop at the band, or stop once the overage ' +
          'reaches an amount you choose.'
        }
        help={pluginDocsHelp('billing', {
          anchor: '#assist-overage',
          excerpt:
            'On a paid plan the assistant keeps answering past your ' +
            'included credits and the extra is billed at your plan\'s ' +
            'per-1,000 rate, unless you switch on the stop at the included band.',
        })}
        contentGutterX
        contentGutterY
      >
        <BillingAssistOverageControls {...props} />
      </CardDisplay>
    </div>
  )
}

export function BillingAssistOverageControls({
  orgId,
  canManage,
}: BillingAssistOverageCardProps) {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const { confirm } = useConfirmationContext()
  const [state, setState] = useState<AssistOverageState | null>(null)
  const [busy, setBusy] = useState(false)
  /** The ceiling field, as typed; the route validates, this only carries. */
  const [capInput, setCapInput] = useState('')
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
        '/api/ai/billing/overage',
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
        // The ceiling half of the payload is read strictly, the way the
        // resolver reads the stored field: anything that is not a finite
        // number is NO ceiling, never a ceiling of `undefined` that renders
        // as "$NaN". The label and bounds fall back to the same constants the
        // route serves them from.
        const capUsd =
          typeof next.capUsd === 'number' && Number.isFinite(next.capUsd)
            ? next.capUsd
            : null
        setState({
          ...next,
          capUsd,
          capLabel:
            typeof next.capLabel === 'string' && next.capLabel
              ? next.capLabel
              : ASSIST_OVERAGE_CAP_CONTROL_LABEL,
          minCapUsd: Number.isFinite(Number(next.minCapUsd))
            ? Number(next.minCapUsd)
            : ASSIST_OVERAGE_CAP_MIN_USD,
          maxCapUsd: Number.isFinite(Number(next.maxCapUsd))
            ? Number(next.maxCapUsd)
            : ASSIST_OVERAGE_CAP_MAX_USD,
        })
        setCapInput(capUsd === null ? '' : String(capUsd))
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

  /**
   * Set or clear the ceiling. Neither direction asks first: setting one
   * only ever lowers a bill, and clearing one returns the org to the
   * open-ended overage the switch already told it about. The route owns the
   * range check, so a figure it refuses comes back as its own sentence.
   */
  const setCap = useCallback(
    async (capUsd: number | null) => {
      setBusy(true)
      const dequeue = queueLoading()
      try {
        const outcome = await sendRequest({ action: 'setCap', capUsd })
        if (!outcome.ok) return
        enqueueSnackbar(
          capUsd === null
            ? 'AI assist overage ceiling removed. Extra credits keep billing ' +
                'at your plan’s rate with no monthly stop.'
            : `AI assist will stop once this month’s overage reaches ` +
                `$${capUsd.toFixed(2)}.`,
          { variant: 'success', persist: false },
        )
        setRetryNonce((nonce) => nonce + 1)
      } catch {
        enqueueSnackbar('Could not update your AI assist ceiling', {
          variant: 'warning',
          persist: false,
        })
      } finally {
        dequeue()
        setBusy(false)
      }
    },
    [queueLoading, sendRequest, enqueueSnackbar],
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

  const {
    hardCap,
    capUsd,
    bandCredits,
    overageRateUsdPer1k,
    sellsOverage,
    label,
    capLabel,
    minCapUsd,
    maxCapUsd,
  } = state
  const band = bandCredits == null ? null : Math.round(bandCredits)
  const rate = overageRateUsdPer1k == null ? null : overageRateUsdPer1k.toFixed(2)
  // The ceiling is a bound on overage, and overage exists only while the
  // switch is off on a plan that sells past its band. It stays reachable to
  // CLEAR whenever one is set, so an org that turned the switch on afterwards
  // is not left carrying a figure it cannot remove.
  const offersCeiling = sellsOverage && !hardCap
  const showsCeiling = offersCeiling || capUsd !== null

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
                : capUsd !== null
                  ? `Stops at $${capUsd.toFixed(2)} of overage`
                  : 'No stop — extra credits bill'
          }
          size="small"
          color={hardCap || capUsd !== null ? 'primary' : 'default'}
        />
        {band !== null ? (
          <Chip label={`${band.toLocaleString()} credits/mo included`} size="small" />
        ) : null}
      </Stack>

      {nothingToStop && band === null ? (
        // Free: no band, and nothing is ever billed for AI, so neither
        // stop applies — the switch has no band to stop at and the ceiling
        // has no overage to bound.
        <Alert severity="info">
          Your plan includes no AI credits and is never charged for any, so
          there is no band to stop at, no overage to put a dollar ceiling on,
          and nothing to configure here. Upgrade above, or add{' '}
          {aiAddonName()} on a paid plan, to get a band.
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

          {showsCeiling ? (
            <Stack spacing={1}>
              <Typography variant="body2" color="text.secondary">
                {offersCeiling
                  ? capUsd === null
                    ? 'Or keep going, but only so far: set a monthly ceiling ' +
                      'on the extra credits you will pay for. The assistant ' +
                      'stops for the rest of the month once this month’s ' +
                      'overage reaches it. Optional, and separate from the ' +
                      'switch above.'
                    : `The assistant stops for the rest of the month once ` +
                      `this month’s overage reaches $${capUsd.toFixed(2)}. ` +
                      `Raise, lower or remove the ceiling at any time.`
                  : `A ceiling of $${(capUsd ?? 0).toFixed(2)} is set, but ` +
                    `with the assistant stopping at the included band there ` +
                    `is no overage for it to bound. You can safely remove it.`}
              </Typography>
              <Stack
                direction="row"
                spacing={2}
                sx={{ alignItems: 'flex-start', flexWrap: 'wrap', rowGap: 2 }}
              >
                {offersCeiling ? (
                  <>
                    <TextField
                      label={capLabel}
                      type="number"
                      size="small"
                      value={capInput}
                      disabled={!canManage || busy}
                      onChange={(event) => setCapInput(event.target.value)}
                      slotProps={{
                        htmlInput: { min: minCapUsd, max: maxCapUsd, step: 1 },
                      }}
                      helperText={`In USD, between $${minCapUsd} and $${maxCapUsd.toLocaleString()}.`}
                    />
                    <Button
                      variant="outlined"
                      disabled={!canManage || busy || capInput.trim() === ''}
                      onClick={() => void setCap(Number(capInput))}
                    >
                      {capUsd === null ? 'Set a monthly ceiling' : 'Save ceiling'}
                    </Button>
                  </>
                ) : null}
                {capUsd !== null ? (
                  <Button
                    variant="text"
                    color="warning"
                    disabled={!canManage || busy}
                    onClick={() => void setCap(null)}
                  >
                    Remove ceiling
                  </Button>
                ) : null}
              </Stack>
            </Stack>
          ) : null}
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
