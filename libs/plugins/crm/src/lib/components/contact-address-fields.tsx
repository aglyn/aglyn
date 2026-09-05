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

import type { AglynPostalAddress } from '@aglyn/aglyn'
import { Grid, TextField } from '@mui/material'

/** A postal address as a form holds it: every field a string, none absent. */
export interface AddressDraft {
  line1: string
  line2: string
  city: string
  state: string
  postalCode: string
  country: string
}

export const EMPTY_ADDRESS: AddressDraft = {
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
  country: '',
}

/** The stored address, or none, as a draft the fields can edit. */
export function addressDraftFrom(
  address: AglynPostalAddress | null | undefined,
): AddressDraft {
  return {
    line1: address?.line1 ?? '',
    line2: address?.line2 ?? '',
    city: address?.city ?? '',
    state: address?.state ?? '',
    postalCode: address?.postalCode ?? '',
    country: address?.country ?? '',
  }
}

export interface ContactAddressFieldsProps {
  value: AddressDraft
  onChange: (next: AddressDraft) => void
  disabled?: boolean
}

/**
 * The six fields of `AglynPostalAddress`, as one block (AGL-2596).
 *
 * Shared by the create drawer and the record page so a person's address is
 * typed the same way in both, and normalized by `normalizeAddress` at the
 * one place each of them writes — which is what drops a blank address
 * rather than storing six empty strings, and upper-cases the country so
 * the stored value is the alpha-2 code every validator expects.
 */
export function ContactAddressFields(props: ContactAddressFieldsProps) {
  const { value, onChange, disabled } = props
  const field =
    (key: keyof AddressDraft) =>
    (event: { target: { value: string } }) =>
      onChange({ ...value, [key]: event.target.value })
  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12 }}>
        <TextField
          size="small"
          label="Address line 1"
          value={value.line1}
          onChange={field('line1')}
          disabled={disabled}
          fullWidth
        />
      </Grid>
      <Grid size={{ xs: 12 }}>
        <TextField
          size="small"
          label="Address line 2"
          value={value.line2}
          onChange={field('line2')}
          disabled={disabled}
          fullWidth
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField
          size="small"
          label="City"
          value={value.city}
          onChange={field('city')}
          disabled={disabled}
          fullWidth
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField
          size="small"
          label="State or region"
          value={value.state}
          onChange={field('state')}
          disabled={disabled}
          fullWidth
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField
          size="small"
          label="Postal code"
          value={value.postalCode}
          onChange={field('postalCode')}
          disabled={disabled}
          fullWidth
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField
          size="small"
          label="Country"
          value={value.country}
          onChange={field('country')}
          disabled={disabled}
          helperText="Two-letter code, like US or GB"
          slotProps={{ htmlInput: { maxLength: 2 } }}
          fullWidth
        />
      </Grid>
    </Grid>
  )
}

export default ContactAddressFields
