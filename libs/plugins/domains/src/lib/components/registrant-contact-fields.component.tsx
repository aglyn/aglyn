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
  COUNTRY_OPTIONS,
  countryOption,
  type CountryOption,
} from '@aglyn/aglyn/app-utils/country-options'
import { Autocomplete, Stack, TextField } from '@mui/material'
import type { RegistrantContact } from '../model/registration'

/*
 * WHO A DOMAIN IS REGISTERED TO, as a form (AGL-3962, AGL-4040): the
 * fields ICANN's registrant contact takes, shared by buying a name, moving
 * one here, and editing the contact of one already held.
 */

export interface ContactFormValue {
  firstName: string
  lastName: string
  companyName: string
  email: string
  phone: string
  address1: string
  address2: string
  city: string
  state: string
  zip: string
  country: string
}

export const CONTACT_FIELD_LABELS: Record<string, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  phone: 'Phone',
  address1: 'Street address',
  city: 'City',
  state: 'State or region',
  zip: 'Postal code',
  country: 'Country',
}

/** A form value from what is known: a stored contact, or a name and email. */
export function contactFormValue(known: Partial<RegistrantContact> = {}): ContactFormValue {
  return {
    firstName: known.firstName ?? '',
    lastName: known.lastName ?? '',
    companyName: known.companyName ?? '',
    email: known.email ?? '',
    phone: known.phone ?? '',
    address1: known.address1 ?? '',
    address2: known.address2 ?? '',
    city: known.city ?? '',
    state: known.state ?? '',
    zip: known.zip ?? '',
    country: known.country ?? 'US',
  }
}

/** "Check these details: Email, Phone." for a route's `fields`. */
export function badFieldsSentence(fields: readonly string[]): string {
  return `Check these details: ${fields.map((field) => CONTACT_FIELD_LABELS[field] ?? field).join(', ')}.`
}

export interface RegistrantContactFieldsProps {
  value: ContactFormValue
  onChange: (next: ContactFormValue) => void
  badFields: readonly string[]
  disabled?: boolean
  /** Shown under the email field. */
  emailHelp?: string
}

export function RegistrantContactFields(props: RegistrantContactFieldsProps) {
  const { value, onChange, badFields, disabled, emailHelp } = props
  const field = (name: keyof ContactFormValue, required = true) => ({
    value: value[name],
    onChange: (event: { target: { value: string } }) => onChange({ ...value, [name]: event.target.value }),
    required,
    error: badFields.includes(name),
    disabled,
    size: 'small' as const,
  })
  const country: CountryOption | null = countryOption(value.country) ?? null
  return (
    <Stack spacing={1.5}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField label="First name" {...field('firstName')} sx={{ flex: 1 }} />
        <TextField label="Last name" {...field('lastName')} sx={{ flex: 1 }} />
      </Stack>
      <TextField label="Business name (optional)" {...field('companyName', false)} />
      <TextField label="Email" type="email" {...field('email')} helperText={emailHelp} />
      <TextField label="Phone" type="tel" {...field('phone')} />
      <TextField label="Street address" {...field('address1')} />
      <TextField label="Apartment, suite (optional)" {...field('address2', false)} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField label="City" {...field('city')} sx={{ flex: 2 }} />
        <TextField label="State or region" {...field('state')} sx={{ flex: 1 }} />
        <TextField label="Postal code" {...field('zip')} sx={{ flex: 1 }} />
      </Stack>
      <Autocomplete
        options={COUNTRY_OPTIONS}
        value={country}
        onChange={(_event, next) => onChange({ ...value, country: next?.code ?? '' })}
        getOptionLabel={(option) => option.label}
        isOptionEqualToValue={(option, other) => option.code === other.code}
        disabled={disabled}
        size="small"
        renderInput={(params) => (
          <TextField {...params} label="Country or region" required error={badFields.includes('country')} />
        )}
      />
    </Stack>
  )
}
