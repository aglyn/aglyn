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

import * as Aglyn from '@aglyn/aglyn'
import { mdiCurrencyUsd } from '@aglyn/shared-data-mdi'
import Box from '@mui/material/Box'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import { forwardRef } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'
import { useShopperCurrency } from './shopper-currency'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'currency-selector'

export interface CurrencySelectorProps {
  /** Shown above the select; none by default, for a compact header. */
  label?: string
  /** Each currency's name after its code and sign ("New Zealand dollar"). */
  showName?: boolean
}

/** The sign a currency prints with, narrow: `$` for every dollar, `€`, `£`. */
function currencySign(code: string): string {
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' })
        .formatToParts(0)
        .find((part) => part.type === 'currency')?.value ?? ''
    )
  } catch {
    return ''
  }
}

/** One currency as the selector lists it: `NZD $ · New Zealand dollar`. */
export function currencyOptionLabel(code: string, name?: string): string {
  const sign = currencySign(code)
  const head = sign && sign !== code ? `${code} ${sign}` : code
  return name ? `${head} · ${name}` : head
}

/**
 * Currency selector (AGL-4248): the shopper picks which of the store's
 * currencies prices show and checkout charges in, remembered on this device.
 * Renders nothing on a store that sells in one currency, or until the store
 * says what it sells in; on the canvas it shows a sample to design with.
 */
const CurrencySelector = forwardRef<HTMLDivElement, CurrencySelectorProps>((props, ref) => {
  const { label, showName = true, ...rest } = props
  // Node styles ride the renderer-merged sx; recompose (stack.ts pattern).
  const nodeSx = Array.isArray(props['sx']) ? props['sx'] : [props['sx']]
  const { hostId } = Aglyn.useSite()
  const shopper = useShopperCurrency()

  const codes = hostId ? shopper.currencies.map((entry) => entry.code) : ['USD', 'EUR', 'GBP']
  if (hostId && (!shopper.ready || codes.length < 2)) return null

  return (
    <Box ref={ref} {...rest} sx={[{ display: 'inline-flex', minWidth: 120 }, ...nodeSx]}>
      <TextField
        select
        size="small"
        label={label || undefined}
        value={hostId ? shopper.code : 'USD'}
        disabled={!hostId}
        onChange={(event) => shopper.setCurrency(String(event.target.value))}
        slotProps={{ htmlInput: { 'aria-label': label || 'Currency' } }}
        fullWidth
      >
        {codes.map((code) => (
          <MenuItem key={code} value={code}>
            {currencyOptionLabel(code, showName ? shopper.currencyName(code) : undefined)}
          </MenuItem>
        ))}
      </TextField>
    </Box>
  )
})
CurrencySelector.displayName = 'AglynCurrencySelector'

export const schema: Aglyn.ComponentSchema<CurrencySelectorProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Currency selector',
  description:
    'Lets shoppers pick the currency prices show in, from the currencies the store sells in. ' +
    'Hidden when the store sells in one currency.',
  category: Aglyn.ComponentCategory.COMMERCE,
  icon: { path: mdiCurrencyUsd.path, sx: { color: '#2e7d32' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'label',
      label: 'Label',
      description: 'Shown above the list. Leave empty for a compact header.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'showName',
      label: 'Show currency names',
      description: 'List "NZD $ · New Zealand dollar" rather than "NZD $".',
      component: Aglyn.FieldComponentType.CHECKBOX,
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Currency selector',
    pluginId: BUNDLE_ID,
    description: 'Shoppers pick the currency prices show in',
    category: Aglyn.ComponentCategory.COMMERCE,
    icon: { path: mdiCurrencyUsd.path, sx: { color: '#2e7d32' } },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: { showName: true },
    },
  },
]

export default CurrencySelector
