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
  aiAddonName,
  defaultAiTierForPlan,
  isAiTierId,
  listAiTierAddons,
  type AiTierAddonOption,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import { ListItemText, MenuItem, TextField } from '@mui/material'

export interface AiTierSelectProps {
  plan: OrgPlan
  /** The tier chosen; null shows the plan's default tier as chosen. */
  value: AiTierId | null | undefined
  onChange: (tier: AiTierId) => void
  /** Prices per month or per year, as the cadence beside it bills. */
  interval?: 'month' | 'year'
  disabled?: boolean
  /** The brand the add-on is named by; the platform's by default. */
  brand?: string
}

/**
 * The Aglyn AI tier beside a bundle's Aglyn AI switch (AGL-4025): every tier
 * the plan sells, smallest first, each with its price and the credits it
 * adds, all read from `AI_TIERS`. The staff bundle fields choose the tier a
 * link and a proposal carry; the Billing quote lets the owner change it
 * before paying. Nothing renders on a plan that sells no tier.
 *
 * Figma: "Aglyn Console (web)" (gSzLG5uHiuBFJ5AK1Mr6KE), frames 5:2 (the
 * staff card), 6:90 (the open menu) and 6:110 (the Billing quote's add-ons).
 */
export function AiTierSelect(props: AiTierSelectProps) {
  const { plan, value, onChange, interval = 'month', disabled, brand } = props
  const tiers = listAiTierAddons(plan)
  if (!tiers.length) return null
  const chosen = isAiTierId(value) ? value : defaultAiTierForPlan(plan)
  const price = (option: AiTierAddonOption) =>
    interval === 'year' ? `$${option.yearlyUsd}/yr` : `$${option.monthlyUsd}/mo`
  return (
    <TextField
      select
      size="small"
      label={`${aiAddonName(brand)} tier`}
      value={chosen ?? ''}
      disabled={disabled}
      onChange={(event) => {
        if (isAiTierId(event.target.value)) onChange(event.target.value)
      }}
      slotProps={{
        select: {
          // One line in the field; the menu carries each tier's credits.
          renderValue: (selected) => {
            const option = tiers.find((tier) => tier.tier === selected)
            return option ? `${option.label} — ${price(option)}` : ''
          },
        },
      }}
      sx={{ minWidth: (theme) => theme.spacing(25) }}
    >
      {tiers.map((option) => (
        <MenuItem key={option.tier} value={option.tier}>
          <ListItemText
            primary={`${option.label} — ${price(option)}`}
            secondary={`+${option.credits.toLocaleString()} credits a month`}
          />
        </MenuItem>
      ))}
    </TextField>
  )
}

export default AiTierSelect
