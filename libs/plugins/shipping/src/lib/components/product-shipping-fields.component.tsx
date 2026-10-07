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

import { Stack, TextField, Typography } from '@mui/material'
import { useShippingAvailability } from './shipping-api'

/** What a product ships as, as the commerce editor holds it. */
export interface ProductShippingValues {
  lengthCm: number | null
  widthCm: number | null
  heightCm: number | null
  hsCode: string
  originCountry: string
}

/**
 * The props the commerce plugin's `productEditor` zone hands a widget,
 * restated to what this one reads.
 */
export interface ProductShippingFieldsProps {
  hostId: string
  product: { id: string | null; type: string; shipping?: ProductShippingValues }
  proposeValues: (values: { shipping?: Partial<ProductShippingValues> }, key: string) => void
}

const PROPOSAL_KEY = 'shipping-fields'

/**
 * A PRODUCT'S PARCEL AND CUSTOMS FACTS (AGL-3612), in the product editor:
 * its packed size, its tariff code and where it was made. Staged in the
 * editor like typing; Save product stores them. Weight stays with each
 * variant, where the editor already keeps it. Only for a physical product,
 * and only where labels exist.
 */
export function ProductShippingFields(props: ProductShippingFieldsProps) {
  const { hostId, product, proposeValues } = props
  const availability = useShippingAvailability(hostId)
  if (!availability.available || product.type !== 'physical') return null
  const values = product.shipping
  const numeric = (field: 'lengthCm' | 'widthCm' | 'heightCm') => (event: { target: { value: string } }) => {
    const parsed = Number(event.target.value)
    proposeValues(
      { shipping: { [field]: event.target.value === '' || !(parsed > 0) ? null : Math.min(parsed, 300) } },
      PROPOSAL_KEY,
    )
  }
  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle2">{'Shipping'}</Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        {(['lengthCm', 'widthCm', 'heightCm'] as const).map((side) => (
          <TextField
            key={side}
            type="number"
            label={side === 'lengthCm' ? 'Packed length (cm)' : side === 'widthCm' ? 'Packed width (cm)' : 'Packed height (cm)'}
            value={values?.[side] ?? ''}
            onChange={numeric(side)}
            sx={{ flex: 1 }}
          />
        ))}
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField
          label="HS tariff code"
          value={values?.hsCode ?? ''}
          onChange={(event) =>
            proposeValues({ shipping: { hsCode: event.target.value.replace(/[^0-9.]/g, '').slice(0, 14) } }, PROPOSAL_KEY)
          }
          helperText="For customs, on parcels that cross a border."
          sx={{ flex: 1 }}
        />
        <TextField
          label="Country of origin"
          value={values?.originCountry ?? ''}
          onChange={(event) =>
            proposeValues(
              { shipping: { originCountry: event.target.value.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2) } },
              PROPOSAL_KEY,
            )
          }
          helperText="Where it was made, two letters (e.g. US)."
          sx={{ flex: 1 }}
        />
      </Stack>
    </Stack>
  )
}
ProductShippingFields.displayName = 'ProductShippingFields'

export default ProductShippingFields
