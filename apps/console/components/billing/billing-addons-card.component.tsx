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
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded'
import {
  Alert,
  Box,
  Button,
  IconButton,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import useBranding from '../../hooks/use-branding'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'

/**
 * Human labels for `org.seatAddons` kinds — shared with the current-plan
 * card's add-on caption.
 */
export const ADDON_LABELS: Record<string, string> = {
  managers: 'manager seats',
  members: 'member seats',
  datasets: 'extra datasets',
  hosts: 'extra sites',
  posRegisters: 'POS registers',
  eventCalendar: 'Event Calendar',
}

interface AddonRow {
  kind: string
  label: string
  description: string
  /** Quantity toggle (0/1) rendered as a switch instead of a stepper. */
  toggle?: boolean
}

const addonRows = (brand: string): readonly AddonRow[] => [
  {
    kind: 'managers',
    label: 'Manager seats',
    description: 'Workspace manager seats beyond the ones your plan includes.',
  },
  {
    kind: 'members',
    label: 'Collaborator seats',
    description:
      'Per-site collaborator (teammate) seats beyond the included count.',
  },
  {
    kind: 'datasets',
    label: 'Extra datasets',
    description: 'Additional shared datasets across your workspace.',
  },
  {
    kind: 'hosts',
    label: 'Extra sites',
    description: 'Publish more sites than your plan includes.',
  },
  {
    kind: 'posRegisters',
    label: 'POS registers',
    description: 'Additional point-of-sale registers/locations.',
  },
  {
    kind: 'eventCalendar',
    label: 'Event Calendar',
    description:
      'The Event Calendar add-on for your whole workspace, supported ' +
      `directly by ${brand}.`,
    toggle: true,
  },
]

interface AddonsCatalogEntry {
  unitUsd: number | null
  max: number
  configured: boolean
  upgradeRequired: boolean
}

interface AddonsState {
  hasSubscription: boolean
  plan: string
  interval: 'month' | 'year'
  quantities: Record<string, number>
  catalog: Record<string, AddonsCatalogEntry>
}

export interface BillingAddonsCardProps {
  orgId?: string | null
  /** billing.manage: steppers enabled; view-only otherwise. */
  canManage: boolean
}

/**
 * Self-serve add-on management (AGL-529): quantities per add-on kind on
 * the org's subscription, applied through /api/billing/addons with a
 * proration preview + confirm before every change. Renders an upgrade
 * prompt for orgs without a live subscription — add-ons bill on it.
 */
export default function BillingAddonsCardComponent({
  orgId,
  canManage,
}: BillingAddonsCardProps) {
  const { data: user } = useUser()
  // Org-scoped billing copy names the org's RESOLVED product name (AGL-2319).
  const { branding } = useBranding()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const { confirm } = useConfirmationContext()
  const [state, setState] = useState<AddonsState | null>(null)
  const [drafts, setDrafts] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  /**
   * Three outcomes, not two (AGL-1380). `state === null` used to render
   * "Plan add-ons appear here once billing is configured" — a claim about
   * this org's billing setup, made identically whether Stripe really is
   * switched off on this deployment, the request failed, or nothing had
   * come back yet. A paying org whose add-ons request 500s was told its
   * billing does not exist, with no retry and no way to tell the difference.
   */
  const [loadState, setLoadState] = useState<
    'pending' | 'error' | 'unconfigured' | 'loaded'
  >('pending')
  /** Bumped by Retry to re-run the load effect. */
  const [retryNonce, setRetryNonce] = useState(0)

  /**
   * The request with its failure reason intact. `addonsRequest` below
   * collapses every failure to `null` because its callers only need "do not
   * proceed"; the loader needs to tell a 501 — billing is genuinely off on
   * this deployment, a fact we learned — from anything else, which is a fact
   * we failed to learn.
   */
  const sendAddonsRequest = useCallback(
    async (
      body: Record<string, unknown>,
    ): Promise<{
      ok: boolean
      payload?: any
      /** Only meaningful when `ok` is false. */
      reason?: 'unconfigured' | 'failed'
      // Flat rather than a discriminated union on purpose: `strictNullChecks`
      // is off repo-wide, and narrowing a union by a boolean discriminant
      // does not survive that (TS2339 on the false leg).
    }> => {
      const response = await authorizedFetch(user, '/api/billing/addons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, ...body }),
      })
      const payload = await response.json().catch(() => ({}))
      if (response.status === 501) {
        enqueueSnackbar(
          'Billing is not configured yet — Stripe keys are pending.',
          { variant: 'info', persist: false },
        )
        return { ok: false, reason: 'unconfigured' }
      }
      if (!response.ok) {
        enqueueSnackbar(payload?.error ?? 'Plan add-on request failed', {
          variant: 'warning',
          persist: false,
        })
        return { ok: false, reason: 'failed' }
      }
      return { ok: true, payload }
    },
    [user, orgId, enqueueSnackbar],
  )

  const addonsRequest = useCallback(
    async (body: Record<string, unknown>) => {
      const outcome = await sendAddonsRequest(body)
      return outcome.ok ? outcome.payload : null
    },
    [sendAddonsRequest],
  )

  useEffect(() => {
    if (!orgId || !user) return
    let cancelled = false
    setLoadState('pending')
    sendAddonsRequest({ action: 'get' })
      .then((outcome) => {
        if (cancelled) return
        if (outcome.ok) {
          setState(outcome.payload as AddonsState)
          setDrafts({})
          setLoadState('loaded')
          return
        }
        setLoadState(outcome.reason === 'unconfigured' ? 'unconfigured' : 'error')
      })
      // A rejected fetch — offline, a wedged route — never reached the
      // snackbar inside the request at all, so this is the only place it can
      // become something the card can render.
      .catch(() => {
        if (!cancelled) setLoadState('error')
      })
    return () => {
      cancelled = true
    }
  }, [orgId, user, sendAddonsRequest, retryNonce])

  const applyChange = useCallback(
    async (row: AddonRow, quantity: number) => {
      if (!state) return
      setBusy(true)
      try {
        // The loading overlay must drop BEFORE the confirm dialog opens —
        // it sits above the dialog and swallows the Confirm click
        // (AGL-535); handleUpgrade on the page dequeues the same way.
        const dequeuePreview = queueLoading()
        let preview: any
        try {
          preview = await addonsRequest({
            action: 'preview',
            kind: row.kind,
            quantity,
          })
        } finally {
          dequeuePreview()
        }
        if (!preview) return
        const unitUsd = state.catalog[row.kind]?.unitUsd ?? 0
        const monthlyUsd = quantity * (unitUsd ?? 0)
        // The true cost of this change: proration lines only (AGL-535) —
        // upcoming.amount_due is the whole next invoice, and nothing is
        // charged today with create_prorations.
        const prorationCents = Number(
          preview.prorationCents ?? preview.amountDueCents ?? 0,
        )
        const currency = String(preview.currency ?? 'usd').toUpperCase()
        const prorationUsd = (Math.abs(prorationCents) / 100).toFixed(2)
        const accepted = await confirm({
          title: `${row.label}: ${quantity}?`,
          description:
            (prorationCents >= 0
              ? `Prorated for the rest of this period: $${prorationUsd} ` +
                `${currency}, billed on your next invoice. Ongoing: `
              : `Unused time credits $${prorationUsd} ${currency} back ` +
                'on your next invoice. Ongoing: ') +
            (quantity === 0
              ? 'nothing — this add-on is removed.'
              : `$${monthlyUsd}/mo` +
                (state.interval === 'year'
                  ? ` (billed yearly with your plan)`
                  : '') +
                '.'),
          confirmationText: 'Confirm change',
        })
          .then(() => true)
          .catch(() => false)
        if (!accepted) return
        const dequeueSet = queueLoading()
        try {
          const applied = await addonsRequest({
            action: 'set',
            kind: row.kind,
            quantity,
          })
          if (applied?.quantities) {
            setState((previous) =>
              previous
                ? { ...previous, quantities: applied.quantities }
                : previous)
            setDrafts((previous) => {
              const next = { ...previous }
              delete next[row.kind]
              return next
            })
            /*
             * The purchase succeeded and the card was charged, but the
             * PENDING plan change's item list could not be refreshed — so
             * at the period end the schedule applies its stale list and
             * this add-on silently disappears while the customer keeps
             * being billed for the plan they scheduled.
             *
             * The route reports this deliberately ("loudly, because the
             * consequence is silent and deferred") and the card threw the
             * flag away, which made the loud report a server log nobody
             * reads. A success toast here is worse than no toast: it tells
             * the customer the one thing that is about to stop being true.
             *
             * `persist: true` because it is the only notice of a change
             * that lands weeks later, and there is a real action to take.
             */
            if (applied.scheduleRefreshFailed) {
              enqueueSnackbar(
                `${row.label} was purchased, but your scheduled plan ` +
                  'change did not pick it up — it will be dropped at the ' +
                  'end of this billing period. Contact support to keep it.',
                { variant: 'warning', persist: true },
              )
            } else {
              enqueueSnackbar(`${row.label} updated`, {
                variant: 'success',
                persist: false,
              })
            }
          }
        } finally {
          dequeueSet()
        }
      } finally {
        setBusy(false)
      }
    },
    [state, addonsRequest, confirm, queueLoading, enqueueSnackbar],
  )

  if (loadState === 'error') {
    // Not "billing is not configured" — that is a claim about this org that
    // we failed to check. Nothing below renders, so no quantity can be
    // acted on against a subscription we could not read (AGL-1380).
    return (
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
        {'We couldn’t load your plan add-ons. This says nothing about your ' +
          'billing — we could not reach it to find out. Nothing has changed.'}
      </Alert>
    )
  }

  if (loadState === 'unconfigured') {
    // Earned, not assumed: the route answered 501, so billing really is off
    // on this deployment.
    return (
      <Typography variant="body2" color="text.secondary">
        {'Plan add-ons appear here once billing is configured.'}
      </Typography>
    )
  }

  if (!state) {
    return (
      <Typography variant="body2" color="text.secondary">
        {'Checking your plan add-ons…'}
      </Typography>
    )
  }

  // NO SUBSCRIPTION: show the add-ons DISABLED with the reason, rather than
  // replacing them with a sentence (AGL-2405).
  //
  // Hiding them made the console contradict itself. The plan cards below
  // advertise "+$4/extra" team seats, and the collaborator toast says "buy
  // another in Billing → Add-ons to assign more" — and Add-ons then said
  // "pick a plan below first" to an org whose plan card reads "Current plan".
  // An admin cannot tell from that whether the feature is missing, broken, or
  // just unavailable to them.
  //
  // It is also not a rare state: an org whose plan came from a staff override
  // or a comped Enterprise contract has a plan and no self-serve subscription,
  // and that is supported rather than accidental. The catalogue is what the
  // plan grants; whether it can be BOUGHT here is a separate question, and the
  // card should answer both.
  const noSubscription = !state.hasSubscription

  return (
    <Stack spacing={2}>
      {noSubscription ? (
        <Alert severity="info">
          {'Add-ons bill onto an active plan subscription. This workspace does ' +
            `not have one — either its plan is managed by ${branding.productName}, ` +
            'or checkout ' +
            'has not been completed — so these are shown for reference and ' +
            'cannot be changed here. Contact support to adjust them.'}
        </Alert>
      ) : null}
      {addonRows(branding.productName).map((row) => {
        const entry = state.catalog[row.kind]
        const current = state.quantities[row.kind] ?? 0
        const draft = drafts[row.kind] ?? current
        const purchasable = Boolean(entry) &&
          !entry.upgradeRequired &&
          entry.configured &&
          // Belt as well as braces: the write route refuses without a
          // subscription anyway, so an enabled control here could only ever
          // produce a failed request.
          !noSubscription
        const changed = draft !== current
        return (
          <Stack
            key={row.kind}
            direction="row"
            spacing={2}
            sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}
          >
            <Box sx={{ flex: 1, minWidth: 220 }}>
              <Typography variant="subtitle2">
                {row.label}
                {entry?.unitUsd != null
                  ? ` — $${entry.unitUsd}/mo${row.toggle ? '' : ' each'}`
                  : ''}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {row.description}
              </Typography>
            </Box>
            {!purchasable ? (
              <Typography variant="caption" color="text.secondary">
                {entry?.upgradeRequired
                  ? 'Upgrade your plan to add these'
                  : noSubscription
                    ? 'Needs an active subscription'
                    : 'Not configured'}
              </Typography>
            ) : row.toggle ? (
              <Switch
                checked={draft >= 1}
                disabled={!canManage || busy}
                onChange={(event) =>
                  void applyChange(row, event.target.checked ? 1 : 0)}
              />
            ) : (
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <IconButton
                  size="small"
                  aria-label={`Remove one ${row.label}`}
                  disabled={!canManage || busy || draft <= 0}
                  onClick={() =>
                    setDrafts((previous) => ({
                      ...previous,
                      [row.kind]: Math.max(0, draft - 1),
                    }))}
                >
                  <RemoveRoundedIcon fontSize="inherit" />
                </IconButton>
                <Typography
                  variant="subtitle2"
                  sx={{ minWidth: 24, textAlign: 'center' }}
                >
                  {draft}
                </Typography>
                <IconButton
                  size="small"
                  aria-label={`Add one ${row.label}`}
                  disabled={!canManage || busy || draft >= entry.max}
                  onClick={() =>
                    setDrafts((previous) => ({
                      ...previous,
                      [row.kind]: Math.min(entry.max, draft + 1),
                    }))}
                >
                  <AddRoundedIcon fontSize="inherit" />
                </IconButton>
                {changed ? (
                  <Button
                    size="small"
                    variant="outlined"
                    color="primary"
                    disabled={!canManage || busy}
                    onClick={() => void applyChange(row, draft)}
                  >
                    {draft === 0 ? 'Remove' : 'Apply'}
                  </Button>
                ) : null}
              </Stack>
            )}
          </Stack>
        )
      })}
      <Typography variant="caption" color="text.secondary">
        {'Changes prorate onto your current billing period. Seat and ' +
          'dataset add-ons stop at your plan\'s hard cap — beyond it, ' +
          'upgrade the plan instead.'}
      </Typography>
    </Stack>
  )
}
