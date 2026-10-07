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

import { MenuItem, Stack, TextField, Typography } from '@mui/material'
import { isValidGtin } from '../model/gtin'

/** What shopping channels ask of a product, as the commerce editor holds it. */
export interface ProductChannelValues {
  brand: string
  gtin: string
  mpn: string
  condition: '' | 'new' | 'refurbished' | 'used'
  googleProductCategory: string
}

/**
 * The props the commerce plugin's `productEditor` zone hands a widget,
 * restated to what this one reads.
 */
export interface ProductChannelFieldsProps {
  hostId: string
  product: { id: string | null; type: string; channel?: ProductChannelValues }
  proposeValues: (values: { channel?: Partial<ProductChannelValues> }, key: string) => void
}

const PROPOSAL_KEY = 'sales-channels-fields'

/** Digits only, at most 14: what a barcode field accepts as it is typed. */
const barcodeDigits = (value: string) => value.replace(/[^0-9]/g, '').slice(0, 14)

/**
 * A PRODUCT'S SHOPPING-CHANNEL FACTS (AGL-3637), in the product editor: its
 * brand, barcode (GTIN), part number (MPN), condition and Google category.
 * Staged in the editor like typing; Save product stores them. A product with
 * several configurations keeps a barcode per variant in the variant's own
 * barcode field, so the GTIN here is for a product with one. Not shown for a
 * service, which shopping channels do not list.
 */
export function ProductChannelFields(props: ProductChannelFieldsProps) {
  const { product, proposeValues } = props
  if (product.type === 'service') return null
  const values = product.channel
  const propose = (patch: Partial<ProductChannelValues>) => proposeValues({ channel: patch }, PROPOSAL_KEY)
  const gtin = values?.gtin ?? ''
  const gtinError = gtin.length > 0 && !isValidGtin(gtin)
  return (
    <Stack spacing={1.5} data-testid="product-channel-fields">
      <Typography variant="subtitle2">{'Shopping channels'}</Typography>
      <Typography variant="body2" color="text.secondary">
        {'What Google, Meta, TikTok, Pinterest, Snapchat and Microsoft show with this product. Blank fields use the store’s defaults.'}
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField
          label="Brand"
          value={values?.brand ?? ''}
          onChange={(event) => propose({ brand: event.target.value.slice(0, 70) })}
          sx={{ flex: 1 }}
        />
        <TextField
          select
          label="Condition"
          value={values?.condition ?? ''}
          onChange={(event) => propose({ condition: event.target.value as ProductChannelValues['condition'] })}
          sx={{ flex: 1 }}
        >
          <MenuItem value="">{'Store default'}</MenuItem>
          <MenuItem value="new">{'New'}</MenuItem>
          <MenuItem value="refurbished">{'Refurbished'}</MenuItem>
          <MenuItem value="used">{'Used'}</MenuItem>
        </TextField>
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField
          label="Barcode (GTIN)"
          value={gtin}
          error={gtinError}
          helperText={
            gtinError
              ? 'Check the number: its last digit does not match. Channels refuse a wrong one.'
              : 'UPC, EAN, ISBN or JAN. Variants keep their own in each variant’s barcode.'
          }
          slotProps={{ htmlInput: { inputMode: 'numeric' } }}
          onChange={(event) => propose({ gtin: barcodeDigits(event.target.value) })}
          sx={{ flex: 1 }}
        />
        <TextField
          label="Part number (MPN)"
          value={values?.mpn ?? ''}
          helperText="The manufacturer’s number, for products with no barcode."
          onChange={(event) => propose({ mpn: event.target.value.slice(0, 70) })}
          sx={{ flex: 1 }}
        />
      </Stack>
      <TextField
        label="Google product category"
        value={values?.googleProductCategory ?? ''}
        helperText="An id like 2271 or a path like Apparel & Accessories > Clothing > Dresses."
        onChange={(event) => propose({ googleProductCategory: event.target.value.slice(0, 750) })}
      />
    </Stack>
  )
}
ProductChannelFields.displayName = 'ProductChannelFields'

export default ProductChannelFields
