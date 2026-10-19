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

import {
  aiAddonName,
  isCustomPricedPlan,
  PLAN_ENTITLEMENTS,
  PLAN_PRICING,
  planSellsAiTiers,
  planSellsSiteCare,
  type AiTierId,
  type OrgPlan,
} from '@aglyn/aglyn'
import { useConfirmationContext, useLoading } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Link,
  ListItemText,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import useBranding from '../../hooks/use-branding'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { finishPendingCharge } from '../../utils/finish-pending-charge'

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
  aiAddon: aiAddonName(),
  siteCare: 'Site Care',
}

/**
 * The org-wide 0/1 kinds. One purchase covers the workspace, so a caption
 * that names them prints the label alone — "Event Calendar", never "1 Event
 * Calendar" — where the seat kinds print their count.
 */
export const TOGGLE_ADDON_KINDS: ReadonlySet<string> = new Set([
  'eventCalendar',
  'aiAddon',
  'siteCare',
])

/**
 * The Site Care row's two sentences (AGL-3954): what staff do for the owner,
 * and what the add-on never covers. The second line is there because the
 * likeliest misreading of "we make your changes" is "so my plan's limits no
 * longer apply" — a 26th page or a second site is still an upgrade.
 */
export const SITE_CARE_DESCRIPTION =
  'We make your site changes for you: hours, prices, photos, a staff ' +
  'member, a seasonal banner, a section on an existing page, up to about an ' +
  'hour of work a month, done within 2 business days. Bigger jobs are ' +
  'quoted first.'
export const SITE_CARE_EXCLUSIONS =
  'What it does not cover: plan limits, new pages or forms, redesigns, ' +
  'brand work, photography, ads.'

/**
 * Why Site Care cannot be bought on a plan that does not sell it, or null
 * where it is sold (AGL-3954). Free has no subscription to carry it, so the
 * reason points at the plan grid; Enterprise arranges it in the agreement.
 */
export function siteCareUnavailableReason(plan: OrgPlan | null): string | null {
  if (planSellsSiteCare(plan)) return null
  return plan === 'enterprise'
    ? 'Arranged in your Enterprise agreement rather than here.'
    : 'Site Care is added to a paid plan, and Free has no subscription to carry it.'
}

/**
 * The Aglyn AI row's sentence (AGL-2899, AGL-3965): every AI action draws on
 * one pool, the plan's included credits pay for it, and a tier adds credits
 * ON TOP of them. The included figure is the plan's
 * `assistCreditsPerMonth`, the band a tier is folded onto, so the row and
 * the meter agree.
 */
export function aiAddonDescription(plan: OrgPlan | null): string {
  const pool =
    'Questions, copy, generated pages, emails, campaigns and products all ' +
    'draw on one pool of AI credits.'
  const included = plan ? PLAN_ENTITLEMENTS[plan].assistCreditsPerMonth : 0
  return included > 0 && Number.isFinite(included)
    ? `${pool} Your plan includes ${included.toLocaleString()} a month; a ` +
        'tier adds its credits on top.'
    : `${pool} A tier adds its credits on top of what your plan includes.`
}

/**
 * How the Aglyn AI row is offered on a plan (AGL-2899, AGL-3965).
 *
 * - `included`: the plan's AI is in its agreement (Enterprise), so there is
 *   nothing to buy and no picker.
 * - `upgrade`: the plan sells no tier (Free), so the row points at the plan
 *   grid.
 * - `sold`: every paid self-serve plan — the tier picker.
 *
 * Read from the plan tables rather than from the catalog's `upgradeRequired`,
 * which is true for Free and Enterprise alike: one of those needs an upgrade
 * and the other already has the thing, and the row has to say which.
 */
export function aiAddonOffer(
  plan: OrgPlan | null,
): 'included' | 'upgrade' | 'sold' {
  if (!plan) return 'upgrade'
  if (planSellsAiTiers(plan)) return 'sold'
  return isCustomPricedPlan(plan) ? 'included' : 'upgrade'
}

/** One tier as the add-ons route lists it (AGL-3965). */
export interface AiTierOption {
  id: AiTierId
  label: string
  credits: number
  unitUsd: number
  configured: boolean
}

/**
 * The Aglyn AI tier picker (AGL-3965): each tier with its credits and price,
 * the one held marked, and an Apply that runs the same preview-then-confirm
 * every add-on change does. "No tier" removes it at the period end.
 */
function AiTierPicker(props: {
  label: string
  tiers: readonly AiTierOption[]
  current: AiTierId | null
  disabled: boolean
  onApply: (tier: AiTierId | null) => void
}) {
  const { label, tiers, current, disabled, onApply } = props
  const [draft, setDraft] = useState<AiTierId | 'none'>(current ?? 'none')
  useEffect(() => setDraft(current ?? 'none'), [current])
  const changed = draft !== (current ?? 'none')
  return (
    <Stack
      useFlexGap
      direction="row"
      spacing={1}
      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
    >
      <TextField
        select
        size="small"
        label={`${label} tier`}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value as AiTierId | 'none')}
        sx={{ minWidth: 260 }}
      >
        <MenuItem value="none">
          <ListItemText
            primary="No tier"
            secondary="Your plan's included credits only"
          />
          {current === null ? <Chip size="small" label="Current" sx={{ ml: 1 }} /> : null}
        </MenuItem>
        {tiers.map((tier) => (
          <MenuItem key={tier.id} value={tier.id} disabled={!tier.configured}>
            <ListItemText
              primary={`${tier.label} — $${tier.unitUsd}/mo`}
              secondary={
                `+${tier.credits.toLocaleString()} credits a month` +
                (tier.configured ? '' : ' (not configured yet)')
              }
            />
            {tier.id === current ? (
              <Chip size="small" color="primary" label="Current" sx={{ ml: 1 }} />
            ) : null}
          </MenuItem>
        ))}
      </TextField>
      {changed ? (
        <Button
          size="small"
          variant="outlined"
          color="primary"
          disabled={disabled}
          onClick={() => onApply(draft === 'none' ? null : draft)}
        >
          {draft === 'none' ? 'Remove' : 'Apply'}
        </Button>
      ) : null}
    </Stack>
  )
}

/** The route's plan string as an `OrgPlan`, or null for anything else. */
function knownPlan(plan: string | undefined): OrgPlan | null {
  return plan && plan in PLAN_PRICING ? (plan as OrgPlan) : null
}

interface AddonRow {
  kind: string
  label: string
  description: string
  /** A second line under the description: what the add-on leaves out. */
  exclusions?: string
  /** Quantity toggle (0/1) rendered as a switch instead of a stepper. */
  toggle?: boolean
  /**
   * Price the row as the yearly charge on an annual subscription ("$588/yr")
   * rather than the monthly figure, for a flat add-on whose yearly price is
   * a number the customer is quoted elsewhere.
   */
  yearlyPrice?: boolean
}

const addonRows = (
  brand: string,
  plan: OrgPlan | null,
): readonly AddonRow[] => [
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
  {
    kind: 'aiAddon',
    label: aiAddonName(brand),
    description: aiAddonDescription(plan),
    toggle: true,
  },
  {
    kind: 'siteCare',
    label: 'Site Care',
    description: SITE_CARE_DESCRIPTION,
    exclusions: SITE_CARE_EXCLUSIONS,
    toggle: true,
    yearlyPrice: true,
  },
]

/** The row title's price suffix: " — $49/mo", " — $588/yr", " — $4/mo each". */
function rowPriceSuffix(
  row: AddonRow,
  unitUsd: number | null | undefined,
  interval: 'month' | 'year',
): string {
  if (unitUsd == null) return ''
  if (row.yearlyPrice && interval === 'year') return ` — $${unitUsd * 12}/yr`
  return ` — $${unitUsd}/mo${row.toggle ? '' : ' each'}`
}

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
  /** The Aglyn AI tier the subscription carries (AGL-3965). */
  aiTier?: AiTierId | null
  /** Every tier the plan sells; empty where it sells none. */
  aiTiers?: readonly AiTierOption[]
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
    async (row: AddonRow, quantity: number, tier?: AiTierId) => {
      if (!state) return
      const tierOption = tier
        ? (state.aiTiers ?? []).find((option) => option.id === tier)
        : undefined
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
            ...(tier ? { tier } : {}),
          })
        } finally {
          dequeuePreview()
        }
        if (!preview) return
        const unitUsd = tierOption?.unitUsd ?? state.catalog[row.kind]?.unitUsd ?? 0
        const monthlyUsd = quantity * (unitUsd ?? 0)
        // The true cost of this change: proration lines only (AGL-535) —
        // upcoming.amount_due is the whole next invoice, and nothing is
        // charged today with create_prorations.
        const prorationCents = Number(
          preview.prorationCents ?? preview.amountDueCents ?? 0,
        )
        const currency = String(preview.currency ?? 'usd').toUpperCase()
        const prorationUsd = (Math.abs(prorationCents) / 100).toFixed(2)
        // What actually leaves the account today, tax included — not the
        // pre-tax proration. Added capacity is invoiced immediately, so this
        // confirm is the last thing before a card is charged and the figure on
        // it has to be the figure taken. A REMOVAL still raises no charge:
        // there is nothing to collect, and the unused time returns as credit.
        const chargedNowCents = Number(preview.chargedNowCents ?? 0)
        const chargedNowUsd = (Math.abs(chargedNowCents) / 100).toFixed(2)
        const taxIncluded = Number(preview.taxCents ?? 0) > 0
        const taxCaveat =
          preview.taxComplete === false
            ? ', plus sales tax — Stripe could not finish calculating tax for ' +
              'your billing address, so your invoice may be higher'
            : taxIncluded
              ? ' including tax'
              : ''
        // A reduction is stated as what it is: nothing today, and the capacity
        // keeps working until the period the customer already paid for ends.
        // Saying "credits back" here would promise a refund that is not coming
        // — the change costs nothing in either direction.
        const effectiveOn = preview.effectiveAt
          ? new Date(String(preview.effectiveAt)).toLocaleDateString()
          : null
        const accepted = await confirm({
          title: tierOption
            ? `${row.label} ${tierOption.label}?`
            : `${row.label}: ${quantity}?`,
          description:
            (preview.defersToPeriodEnd
              ? `Nothing is charged and nothing is refunded. You keep this ` +
                `capacity for the rest of the period you have paid for` +
                (effectiveOn ? `, and it ends on ${effectiveOn}` : '') +
                '. From then: '
              : `$${chargedNowUsd} ${currency}${taxCaveat} will be charged to ` +
                `your card now, prorated for the rest of this period. Ongoing: `) +
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
            ...(tier ? { tier } : {}),
          })
          // The charge did not go through on the spot (AGL-3358): the bank
          // wants the customer to confirm it, or the card was declined.
          // Stripe holds the new quantity until the invoice is paid, so the
          // card keeps showing what the workspace has now. A confirmed
          // challenge pays it; the reload picks up what Stripe then applies.
          if (applied?.paymentPending) {
            const finished = await finishPendingCharge(
              applied,
              'the change takes effect',
            )
            if (!finished.confirmed) {
              enqueueSnackbar(finished.message, {
                variant: 'warning',
                persist: false,
              })
              return
            }
            setRetryNonce((nonce) => nonce + 1)
            enqueueSnackbar(`Payment confirmed. ${row.label} updated.`, {
              variant: 'success',
              persist: false,
            })
            return
          }
          if (applied?.quantities) {
            setState((previous) =>
              previous
                ? {
                    ...previous,
                    quantities: applied.quantities,
                    ...(applied.aiTier !== undefined ? { aiTier: applied.aiTier } : {}),
                  }
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
  const plan = knownPlan(state.plan)

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
      {addonRows(branding.productName, plan).map((row) => {
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
        // The AI add-on row on a plan that cannot buy it says WHICH way it
        // cannot — Enterprise already has it, Free upgrades to a plan that
        // sells it — where the catalog marks both `upgradeRequired`.
        const aiOffer = row.kind === 'aiAddon' ? aiAddonOffer(plan) : 'sold'
        // Site Care on a plan that does not sell it keeps its switch, shown
        // off and disabled, with the reason beside it: a prerequisite is
        // shown, never hidden.
        const siteCareBlocked =
          row.kind === 'siteCare' ? siteCareUnavailableReason(plan) : null
        return (
          <Stack
            useFlexGap
            key={row.kind}
            direction="row"
            spacing={2}
            sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}
          >
            <Box sx={{ flex: 1, minWidth: 220 }}>
              <Typography variant="subtitle2">
                {row.label}
                {/* The AI row prices each tier in its picker instead. */}
                {row.kind === 'aiAddon'
                  ? ''
                  : rowPriceSuffix(row, entry?.unitUsd, state.interval)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {row.description}
              </Typography>
              {row.exclusions ? (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', mt: 0.5 }}
                >
                  {row.exclusions}
                </Typography>
              ) : null}
            </Box>
            {siteCareBlocked ? (
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', maxWidth: 360 }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary">
                    {siteCareBlocked}
                  </Typography>
                  {plan === 'enterprise' ? null : (
                    <Link
                      href="#plans"
                      variant="caption"
                      color="primary"
                      underline="hover"
                      sx={{ display: 'block' }}
                    >
                      {'Choose a paid plan'}
                    </Link>
                  )}
                </Box>
                <Switch
                  checked={false}
                  disabled
                  slotProps={{ input: { 'aria-label': row.label } }}
                />
              </Stack>
            ) : aiOffer === 'included' ? (
              <Typography variant="caption" color="text.secondary">
                {'Included in your plan'}
              </Typography>
            ) : aiOffer === 'upgrade' ? (
              <Link
                href="#plans"
                variant="caption"
                color="primary"
                underline="hover"
              >
                {`Upgrade your plan to add ${aiAddonName(branding.productName)}`}
              </Link>
            ) : !purchasable ? (
              <Typography variant="caption" color="text.secondary">
                {entry?.upgradeRequired
                  ? 'Upgrade your plan to add these'
                  : noSubscription
                    ? 'Needs an active subscription'
                    : 'Not configured'}
              </Typography>
            ) : row.kind === 'aiAddon' ? (
              <AiTierPicker
                label={row.label}
                tiers={state.aiTiers ?? []}
                current={current >= 1 ? (state.aiTier ?? null) : null}
                disabled={!canManage || busy}
                onApply={(tier) =>
                  void (tier ? applyChange(row, 1, tier) : applyChange(row, 0))}
              />
            ) : row.toggle ? (
              <Switch
                checked={draft >= 1}
                disabled={!canManage || busy}
                onChange={(event) =>
                  void applyChange(row, event.target.checked ? 1 : 0)}
                slotProps={{ input: { 'aria-label': row.label } }}
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
