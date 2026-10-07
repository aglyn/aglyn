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

import type { PluginShippingAddress } from '@aglyn/aglyn/plugin-manager/plugin-shipping-rates'
import { Stack, TextField } from '@mui/material'

export interface AddressFieldsProps {
  value: PluginShippingAddress | undefined
  onChange: (address: PluginShippingAddress) => void
  /** Show the name and company lines; a ship-from address usually wants them. */
  withName?: boolean
}

/** A postal address as fields. Country is a two-letter code. */
export function AddressFields(props: AddressFieldsProps) {
  const { value, onChange, withName = true } = props
  const address: PluginShippingAddress = value ?? { country: 'US' }
  const set = (field: keyof PluginShippingAddress) => (event: { target: { value: string } }) =>
    onChange({ ...address, [field]: field === 'country' ? event.target.value.toUpperCase().slice(0, 2) : event.target.value })
  return (
    <Stack spacing={1.5}>
      {withName ? (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <TextField label="Name" value={address.name ?? ''} onChange={set('name')} sx={{ flex: 1 }} />
          <TextField label="Company" value={address.company ?? ''} onChange={set('company')} sx={{ flex: 1 }} />
        </Stack>
      ) : null}
      <TextField label="Street address" value={address.line1 ?? ''} onChange={set('line1')} />
      <TextField label="Apartment, suite (optional)" value={address.line2 ?? ''} onChange={set('line2')} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField label="City" value={address.city ?? ''} onChange={set('city')} sx={{ flex: 2 }} />
        <TextField label="State or region" value={address.state ?? ''} onChange={set('state')} sx={{ flex: 1 }} />
        <TextField label="Postal code" value={address.postalCode ?? ''} onChange={set('postalCode')} sx={{ flex: 1 }} />
        <TextField
          label="Country"
          value={address.country}
          onChange={set('country')}
          slotProps={{ htmlInput: { maxLength: 2 } }}
          helperText="Two letters, e.g. US"
          sx={{ flex: 1 }}
        />
      </Stack>
      <TextField label="Phone" value={address.phone ?? ''} onChange={set('phone')} />
    </Stack>
  )
}
