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
  composeContactName,
  CONTACT_NAME_PART_MAX,
  CRM_LEAD_TEXT_MAX,
  type CrmLeadFields,
  type CrmPicklist,
  type CrmPicklistId,
  effectiveCrmPicklist,
} from '@aglyn/aglyn'
import { Checkbox, FormControlLabel, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { addressDraftFrom, ContactAddressFields, EMPTY_ADDRESS, type AddressDraft } from './contact-address-fields'
import { LeadSourceSelect } from './lead-source-select'
import { CrmPicklistSelect } from './picklist-select'
import {
  amountInputValue,
  DEAL_CURRENCIES,
  DEFAULT_DEAL_CURRENCY,
  parseAmountInput,
} from '../model/deal-board-model'

/**
 * A LEAD'S OWN PROFILE AS A FORM HOLDS IT (AGL-3231, AGL-3513) — every
 * field a string, the address a draft, Do not call a flag — shared by the
 * New lead drawer and the lead's Details card, so the two read and refuse
 * a value the same way.
 */
export interface LeadProfileDraft {
  salutation: string
  firstName: string
  lastName: string
  company: string
  jobTitle: string
  phone: string
  mobilePhone: string
  fax: string
  doNotCall: boolean
  website: string
  leadSource: string
  industry: string
  rating: string
  tags: string
  numberOfEmployees: string
  /** As typed, in the currency's major unit. */
  annualRevenue: string
  currency: string
  address: AddressDraft
}

export const EMPTY_LEAD_PROFILE_DRAFT: LeadProfileDraft = {
  salutation: '',
  firstName: '',
  lastName: '',
  company: '',
  jobTitle: '',
  phone: '',
  mobilePhone: '',
  fax: '',
  doNotCall: false,
  website: '',
  leadSource: '',
  industry: '',
  rating: '',
  tags: '',
  numberOfEmployees: '',
  annualRevenue: '',
  currency: DEFAULT_DEAL_CURRENCY,
  address: EMPTY_ADDRESS,
}

/** The stored profile as a draft the fields can edit. */
export function leadProfileDraftFrom(lead: Record<string, unknown> & CrmLeadFields): LeadProfileDraft {
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  return {
    salutation: text(lead.salutation),
    firstName: text(lead.firstName),
    lastName: text(lead.lastName),
    company: text(lead.company),
    jobTitle: text(lead.jobTitle),
    phone: text(lead.phone),
    mobilePhone: text(lead.mobilePhone),
    fax: text(lead.fax),
    doNotCall: lead.doNotCall === true,
    website: text(lead.website),
    leadSource: text(lead.leadSource),
    industry: text(lead.industry),
    rating: text(lead.rating),
    tags: (lead.tags ?? []).join(', '),
    numberOfEmployees: typeof lead.numberOfEmployees === 'number' ? String(lead.numberOfEmployees) : '',
    annualRevenue: amountInputValue(lead.annualRevenueCents),
    currency: text(lead.currency).toLowerCase() || DEFAULT_DEAL_CURRENCY,
    address: addressDraftFrom(lead.address ?? null),
  }
}

/** The fields of a draft that change what the lead's name reads as. */
export function leadDraftComposedName(draft: Pick<LeadProfileDraft, 'firstName' | 'lastName'>): string {
  return composeContactName(draft.firstName, draft.lastName)
}

/** The sentence a revenue that is not an amount is refused with, under the field. */
export const LEAD_REVENUE_REFUSAL = 'Enter an amount, like 1250000.00'

/**
 * The draft as the body `normalizeCrmLeadProfile` reads: the revenue
 * typed in the currency's major unit becomes its minor unit, with the
 * currency beside it only while there is a revenue for it to describe.
 * `revenueError` is set for a revenue that is not an amount.
 */
export function leadProfileDraftBody(draft: LeadProfileDraft): {
  body: Record<string, unknown>
  revenueError?: string
} {
  const revenueText = draft.annualRevenue.trim()
  const revenue = revenueText ? parseAmountInput(revenueText) : null
  return {
    body: {
      salutation: draft.salutation,
      firstName: draft.firstName,
      lastName: draft.lastName,
      company: draft.company,
      jobTitle: draft.jobTitle,
      phone: draft.phone,
      mobilePhone: draft.mobilePhone,
      fax: draft.fax,
      doNotCall: draft.doNotCall,
      website: draft.website,
      leadSource: draft.leadSource,
      industry: draft.industry,
      rating: draft.rating,
      tags: draft.tags,
      numberOfEmployees: draft.numberOfEmployees,
      annualRevenueCents: revenue,
      currency: revenue === null ? null : draft.currency,
      address: draft.address,
    },
    ...(revenueText && revenue === null ? { revenueError: LEAD_REVENUE_REFUSAL } : {}),
  }
}

export interface LeadProfileFieldsProps {
  draft: LeadProfileDraft
  onChange: <K extends keyof LeadProfileDraft>(key: K, value: LeadProfileDraft[K]) => void
  /** Each field's refusal, under it, by the profile key. */
  errors?: Readonly<Record<string, string | undefined>>
  disabled?: boolean
  /** The org's lead source list. */
  leadSources: CrmPicklist
  /** The org's Salutation, Industry and Rating lists. */
  lists: Readonly<Partial<Record<CrmPicklistId, CrmPicklist>>>
  /** The lead as stored, so a value its list no longer offers stays shown. */
  stored?: Readonly<Record<string, unknown>> | null
  /** The drawer's hints under the company and the lead source. */
  helperTexts?: Partial<Record<'company' | 'leadSource', string>>
}

/**
 * The profile's fields in Salesforce's lead layout (AGL-3513): the name,
 * then Lead Information — the company, title, industry, rating, source,
 * size and revenue — then how to reach the person, then the address.
 */
export function LeadProfileFields(props: LeadProfileFieldsProps) {
  const { draft, onChange, errors = {}, disabled, leadSources, lists, stored, helperTexts = {} } = props
  const storedText = (key: string) => (stored ? String(stored[key] ?? '') : undefined)
  const composed = leadDraftComposedName(draft)
  // A list not read yet is its standard values.
  const picklist = (id: CrmPicklistId): CrmPicklist => lists[id] ?? effectiveCrmPicklist(id, undefined)
  const text = (key: 'company' | 'jobTitle', label: string) => (
    <TextField
      size="small"
      label={label}
      value={draft[key]}
      onChange={(event) => onChange(key, event.target.value)}
      disabled={disabled}
      helperText={key === 'company' ? helperTexts.company : undefined}
      slotProps={{ htmlInput: { maxLength: CRM_LEAD_TEXT_MAX } }}
      fullWidth
    />
  )
  const phone = (key: 'phone' | 'mobilePhone' | 'fax', label: string, hint?: string) => (
    <TextField
      size="small"
      label={label}
      value={draft[key]}
      onChange={(event) => onChange(key, event.target.value)}
      disabled={disabled}
      error={Boolean(errors[key])}
      helperText={errors[key] || hint}
      fullWidth
    />
  )
  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <CrmPicklistSelect
          picklistId="salutation"
          picklist={picklist('salutation')}
          value={draft.salutation}
          stored={storedText('salutation')}
          onChange={(label) => onChange('salutation', label)}
          disabled={disabled}
          error={Boolean(errors['salutation'])}
          helperText={errors['salutation']}
        />
        <TextField
          size="small"
          label="First name"
          value={draft.firstName}
          onChange={(event) => onChange('firstName', event.target.value)}
          disabled={disabled}
          slotProps={{ htmlInput: { maxLength: CONTACT_NAME_PART_MAX } }}
          fullWidth
        />
        <TextField
          size="small"
          label="Last name"
          value={draft.lastName}
          onChange={(event) => onChange('lastName', event.target.value)}
          disabled={disabled}
          helperText={composed ? `The lead's name reads "${composed}".` : undefined}
          slotProps={{ htmlInput: { maxLength: CONTACT_NAME_PART_MAX } }}
          fullWidth
        />
      </Stack>
      <Typography variant="subtitle2">{'Lead information'}</Typography>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        {text('company', 'Company')}
        {text('jobTitle', 'Job title')}
      </Stack>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        {(['industry', 'rating'] as const).map((key) => (
          <CrmPicklistSelect
            key={key}
            picklistId={key}
            picklist={picklist(key)}
            value={draft[key]}
            stored={storedText(key)}
            onChange={(label) => onChange(key, label)}
            disabled={disabled}
            error={Boolean(errors[key])}
            helperText={errors[key]}
          />
        ))}
      </Stack>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        {/* The org's own values (AGL-3298); the stored one stays shown when the list no longer offers it. */}
        <LeadSourceSelect
          picklist={leadSources}
          value={draft.leadSource}
          stored={storedText('leadSource')}
          onChange={(label) => onChange('leadSource', label)}
          disabled={disabled}
          error={Boolean(errors['leadSource'])}
          helperText={errors['leadSource'] || helperTexts.leadSource}
        />
        <TextField
          size="small"
          label="Tags"
          value={draft.tags}
          onChange={(event) => onChange('tags', event.target.value)}
          disabled={disabled}
          helperText="Comma-separated"
          fullWidth
        />
      </Stack>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <TextField
          size="small"
          label="Employees"
          value={draft.numberOfEmployees}
          onChange={(event) => onChange('numberOfEmployees', event.target.value)}
          disabled={disabled}
          error={Boolean(errors['numberOfEmployees'])}
          helperText={errors['numberOfEmployees']}
          slotProps={{ htmlInput: { inputMode: 'numeric' } }}
          fullWidth
        />
        <Stack direction="row" spacing={1} sx={{ width: '100%' }}>
          <TextField
            size="small"
            label="Annual revenue"
            placeholder="0.00"
            value={draft.annualRevenue}
            onChange={(event) => onChange('annualRevenue', event.target.value)}
            disabled={disabled}
            error={Boolean(errors['annualRevenueCents'])}
            helperText={errors['annualRevenueCents']}
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            sx={{ flex: 1 }}
          />
          <TextField
            select
            size="small"
            label="Currency"
            value={draft.currency}
            onChange={(event) => onChange('currency', event.target.value)}
            disabled={disabled}
            sx={{ width: 120 }}
          >
            {/* A stored code outside the short list stays selectable as itself. */}
            {[...new Set<string>([...DEAL_CURRENCIES, draft.currency])].map((code) => (
              <MenuItem key={code} value={code}>
                {code.toUpperCase()}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </Stack>
      <Typography variant="subtitle2">{'Contact information'}</Typography>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        {phone('phone', 'Phone', 'With the country code, like +1 512 555 0107')}
        {phone('mobilePhone', 'Mobile phone')}
      </Stack>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        {phone('fax', 'Fax')}
        <TextField
          size="small"
          label="Website"
          value={draft.website}
          onChange={(event) => onChange('website', event.target.value)}
          disabled={disabled}
          error={Boolean(errors['website'])}
          helperText={errors['website'] || 'Like acme.com'}
          fullWidth
        />
      </Stack>
      {/* A hint on every dial control, never a block (the contact's rule). */}
      <FormControlLabel
        control={
          <Checkbox
            checked={draft.doNotCall}
            onChange={(event) => onChange('doNotCall', event.target.checked)}
            disabled={disabled}
          />
        }
        label="Do not call"
      />
      <Typography variant="subtitle2">{'Address'}</Typography>
      <ContactAddressFields
        value={draft.address}
        onChange={(next) => onChange('address', next)}
        disabled={disabled}
      />
    </Stack>
  )
}
LeadProfileFields.displayName = 'LeadProfileFields'

export default LeadProfileFields
