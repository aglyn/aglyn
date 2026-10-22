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

import type { AiTierId, OrgPlan } from '@aglyn/aglyn'
import {
  ADDON_KINDS,
  addonMaxForPlan,
  addonUnitUsd,
  BUNDLE_COUPON_MAX,
  bundleAddonLabel,
  bundleAiTier,
  firstPlanSellingAddon,
  fitBundleAddonsToPlan,
  normalizeBundleCoupon,
  parseBundleAddons,
  planSellsAddon,
  TOGGLE_ADDON_KIND_LIST,
  type AddonKind,
  type BundleAddons,
} from '@aglyn/aglyn/app-utils/bundle-intent'
import type { ClientBuildIntent } from '@aglyn/aglyn/app-utils/client-build'
import { PLAN_LABELS } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { UPGRADE_PROPOSAL_PLANS } from '@aglyn/aglyn/app-utils/upgrade-proposal'
import {
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { AiTierSelect } from './billing/ai-tier-select.component'

/** What staff choose for a bundle (AGL-3955, AGL-3956). */
export interface BundleDraft {
  plan: OrgPlan
  addons: BundleAddons
  interval: 'month' | 'year'
  coupon: string
  /**
   * The Aglyn AI tier chosen beside the AI switch (AGL-4025); absent, the
   * plan's default tier (`bundleAiTier`), which the picker shows as chosen.
   */
  aiTier?: AiTierId | null
}

/**
 * Where every staff bundle starts: Starter with Site Care, yearly — the
 * "Managed" bundle sold at events and door to door.
 */
export const DEFAULT_BUNDLE_DRAFT: BundleDraft = {
  plan: 'starter',
  addons: { siteCare: 1 },
  interval: 'year',
  coupon: '',
}

/**
 * The draft as the routes take it: add-ons fitted, an empty coupon left out,
 * and the Aglyn AI tier the picker shows whenever the AI add-on is on
 * (AGL-4025), so the link is written with `ai:<tier>` and the proposal
 * stores the tier staff saw.
 */
export function bundleDraftBody(draft: BundleDraft): {
  plan: OrgPlan
  addons: BundleAddons
  interval: 'month' | 'year'
  coupon?: string
  aiTier?: AiTierId
} {
  const coupon = draft.coupon.trim()
  const addons = fitBundleAddonsToPlan(draft.addons, draft.plan).addons
  const aiTier = bundleAiTier(addons, draft.plan, draft.aiTier)
  return {
    plan: draft.plan,
    addons,
    interval: draft.interval,
    ...(coupon ? { coupon } : {}),
    ...(aiTier ? { aiTier } : {}),
  }
}

/**
 * The draft a build for a client left for its hand-off (AGL-3958): the plan,
 * add-ons, cadence and coupon it agreed with the owner, so the dialog opens on
 * those rather than on the event default. Add-ons the plan does not sell are
 * left off, as the picker would; a coupon that is not a code is left empty.
 */
export function bundleDraftFromClientBuildIntent(intent: ClientBuildIntent): BundleDraft {
  return {
    plan: intent.plan,
    addons: fitBundleAddonsToPlan(parseBundleAddons(intent.addons).addons, intent.plan).addons,
    interval: intent.interval,
    coupon: normalizeBundleCoupon(intent.coupon) ?? '',
  }
}

function priceLabel(kind: AddonKind, plan: OrgPlan, aiTier?: AiTierId | null): string {
  const unit = addonUnitUsd(kind, plan, aiTier)
  if (unit == null) return ''
  const each = (TOGGLE_ADDON_KIND_LIST as readonly string[]).includes(kind) ? '' : ' each'
  return `$${unit}/mo${each}`
}

export interface StaffBundleFieldsProps {
  value: BundleDraft
  onChange: (next: BundleDraft) => void
  disabled?: boolean
}

/**
 * The bundle picker staff fill in on the hand-off dialog, the Ask to upgrade
 * dialog and the bundle link card: the plan, every add-on that plan sells
 * (Site Care, Aglyn AI, the Event Calendar, extra sites and seats, POS
 * registers), the Aglyn AI tier beside its switch (AGL-4025), the cadence,
 * and an optional coupon. An add-on a bigger plan sells is listed too,
 * disabled with the plan it needs (POS registers on Starter), rather than
 * left off. A coupon is applied only — codes are minted on the staff
 * Coupons page.
 *
 * Designed in the Figma file "Aglyn Console (web)" (gSzLG5uHiuBFJ5AK1Mr6KE),
 * page "Staff · Organization page", frame 5:2 (the bundle link card).
 */
export function StaffBundleFields({ value, onChange, disabled }: StaffBundleFieldsProps) {
  const set = (patch: Partial<BundleDraft>) => onChange({ ...value, ...patch })
  // The plan an add-on needs when the chosen one does not sell it: the
  // smallest bigger plan that does, or null when none does.
  const biggerPlans = UPGRADE_PROPOSAL_PLANS.slice(UPGRADE_PROPOSAL_PLANS.indexOf(value.plan) + 1)
  const needs = (kind: AddonKind): OrgPlan | null =>
    planSellsAddon(kind, value.plan) ? null : firstPlanSellingAddon(kind, biggerPlans)
  const needsLabel = (kind: AddonKind): string | null => {
    const plan = needs(kind)
    return plan ? `Needs ${PLAN_LABELS[plan]} or higher` : null
  }
  const listed = ADDON_KINDS.filter((kind) => planSellsAddon(kind, value.plan) || needs(kind))
  const toggles = listed.filter((kind) => (TOGGLE_ADDON_KIND_LIST as readonly string[]).includes(kind))
  const counted = listed.filter((kind) => !(TOGGLE_ADDON_KIND_LIST as readonly string[]).includes(kind))
  const setQuantity = (kind: AddonKind, quantity: number) => {
    const addons = { ...value.addons }
    if (quantity > 0) addons[kind] = Math.min(quantity, addonMaxForPlan(kind, value.plan))
    else delete addons[kind]
    set({ addons })
  }

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField
          select
          size="small"
          label="Plan"
          value={value.plan}
          disabled={disabled}
          onChange={(event) => {
            const plan = event.target.value as OrgPlan
            set({ plan, addons: fitBundleAddonsToPlan(value.addons, plan).addons })
          }}
          sx={{ minWidth: 160 }}
        >
          {UPGRADE_PROPOSAL_PLANS.map((option) => (
            <MenuItem key={option} value={option}>
              {PLAN_LABELS[option]}
            </MenuItem>
          ))}
        </TextField>
        <ToggleButtonGroup
          exclusive
          size="small"
          color="primary"
          value={value.interval}
          disabled={disabled}
          onChange={(_event, interval) => (interval ? set({ interval }) : undefined)}
          aria-label="Billing cadence"
        >
          <ToggleButton value="year">{'Yearly'}</ToggleButton>
          <ToggleButton value="month">{'Monthly'}</ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      <Stack spacing={0.5}>
        <Typography variant="overline" color="text.secondary">
          {'Add-ons'}
        </Typography>
        {toggles.map((kind) => {
          const on = (value.addons[kind] ?? 0) > 0
          const unsold = needsLabel(kind)
          // With Aglyn AI on, its tier picker beside the switch names the
          // tier and its price, so the switch says only what it adds.
          const tierPicked = kind === 'aiAddon' && on
          const toggle = (
            <FormControlLabel
              key={kind}
              disabled={disabled || !!unsold}
              control={
                <Switch
                  size="small"
                  checked={on}
                  onChange={(event) => setQuantity(kind, event.target.checked ? 1 : 0)}
                />
              }
              label={
                <Typography variant="body2">
                  {bundleAddonLabel(kind)}
                  {tierPicked ? null : (
                    <Typography component="span" variant="body2" color="text.secondary">
                      {` · ${unsold ?? priceLabel(kind, value.plan, kind === 'aiAddon' ? value.aiTier : null)}`}
                    </Typography>
                  )}
                </Typography>
              }
            />
          )
          return tierPicked ? (
            <Stack
              key={kind}
              direction="row"
              useFlexGap
              spacing={1.5}
              sx={{ alignItems: 'center', flexWrap: 'wrap', py: 0.5 }}
            >
              {toggle}
              <AiTierSelect
                plan={value.plan}
                value={bundleAiTier(value.addons, value.plan, value.aiTier)}
                onChange={(aiTier) => set({ aiTier })}
                disabled={disabled}
              />
            </Stack>
          ) : (
            toggle
          )
        })}
        {counted.length ? (
          <Stack direction="row" useFlexGap spacing={1.5} sx={{ flexWrap: 'wrap', pt: 1 }}>
            {counted.map((kind) => {
              const unsold = needsLabel(kind)
              return (
                <TextField
                  key={kind}
                  size="small"
                  type="number"
                  label={bundleAddonLabel(kind)}
                  helperText={unsold ?? priceLabel(kind, value.plan)}
                  value={unsold ? 0 : (value.addons[kind] ?? 0)}
                  disabled={disabled || !!unsold}
                  onChange={(event) =>
                    setQuantity(kind, Math.max(0, Math.floor(Number(event.target.value) || 0)))
                  }
                  slotProps={{
                    htmlInput: { min: 0, max: addonMaxForPlan(kind, value.plan), step: 1 },
                  }}
                  sx={{ width: (theme) => theme.spacing(18.75) }}
                />
              )
            })}
          </Stack>
        ) : null}
      </Stack>

      <TextField
        size="small"
        label="Coupon code (optional)"
        value={value.coupon}
        disabled={disabled}
        onChange={(event) =>
          set({ coupon: event.target.value.replace(/\s+/g, '').slice(0, BUNDLE_COUPON_MAX) })
        }
        helperText="A code from the staff Coupons page, applied at checkout."
      />
    </Stack>
  )
}

export default StaffBundleFields
