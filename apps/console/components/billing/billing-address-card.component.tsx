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

import { useLoading } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Autocomplete,
  Button,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import BillingProfileGateComponent from './billing-profile-gate.component'
import { COMPACT_FIELD_WIDTH } from '../../constants/shared'
import { COUNTRY_OPTIONS, countryOption, type CountryOption } from '../../utils/country-options'
import type { BillingProfile } from './use-billing-profile'

export interface BillingAddressCardProps {
  profile: BillingProfile
  /** billing.manage: the fields save; read-only otherwise. */
  canManage: boolean
}

const EMPTY = {
  name: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
}

/**
 * The address invoices are issued to.
 *
 * ## Why this is not just a Stripe write
 *
 * The org already carries a structured `contact.address`, and
 * `/api/orgs/settings` pushes it to the Stripe customer on every profile save.
 * A card that wrote only Stripe would look correct and then be silently undone:
 * the next unrelated save on the Organization Settings page would push the OLD
 * address straight back over this one. So the route writes both, and this card
 * is a view onto the same single address rather than a second one.
 *
 * ## Why clearing the form does not clear the address
 *
 * This address is what an active subscription's invoices carry and what
 * `automatic_tax` computes from. Emptying a form field is not a request to put
 * an addressless invoice in front of a tax authority, so a blank save is
 * refused with a sentence saying so rather than obeyed.
 */
export default function BillingAddressCardComponent({
  profile,
  canManage,
}: BillingAddressCardProps) {
  const { state, loadState, reload, request } = profile
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const [fields, setFields] = useState(EMPTY)
  const [country, setCountry] = useState<CountryOption | null>(null)
  const [busy, setBusy] = useState(false)

  const customer = state?.customer ?? null
  const serverKey = JSON.stringify(customer ?? {})
  useEffect(() => {
    // Re-seed on every server answer, so a save refreshes what is on screen
    // instead of leaving the form holding what was typed before it.
    const address = customer?.address ?? null
    setFields({
      name: customer?.name ?? '',
      line1: address?.line1 ?? '',
      line2: address?.line2 ?? '',
      city: address?.city ?? '',
      state: address?.state ?? '',
      postalCode: address?.postalCode ?? '',
    })
    setCountry(countryOption(address?.country ?? ''))
    // `serverKey` rather than `customer`: the profile object is rebuilt on
    // every fetch, so depending on the reference re-seeds the form on reads
    // that changed nothing — including one triggered mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey])

  const set = (key: keyof typeof EMPTY) => (event: { target: { value: string } }) =>
    setFields((previous) => ({ ...previous, [key]: event.target.value }))

  const save = async () => {
    setBusy(true)
    const dequeue = queueLoading()
    try {
      const outcome = await request({
        action: 'set-billing-address',
        ...fields,
        country: country?.code ?? '',
      })
      if (outcome.ok) {
        enqueueSnackbar('Billing address saved.', {
          variant: 'success',
          persist: false,
        })
      }
    } finally {
      dequeue()
      setBusy(false)
    }
  }

  return (
    <BillingProfileGateComponent
      loadState={loadState}
      state={state}
      onRetry={reload}
      subject="billing address"
    >
      {() => (
        <Stack spacing={2}>
          {/*
            Editable before there is a subscription. A billing address is also
            a TAX INPUT: setting it here means the upgrade computes tax from it
            and never asks for it a second time, which is what stops a customer
            wondering which of two addresses their invoice used.
          */}
          <TextField
            label="Full name"
            size="small"
            fullWidth
            value={fields.name}
            disabled={!canManage || busy}
            onChange={set('name')}
            slotProps={{ htmlInput: { 'aria-label': 'Full name' } }}
          />
          <Autocomplete
            size="small"
            disabled={!canManage || busy}
            options={COUNTRY_OPTIONS}
            value={country}
            onChange={(_event, next) => setCountry(next)}
            getOptionLabel={(option) => option.label}
            isOptionEqualToValue={(option, selected) =>
              option.code === selected.code
            }
            filterOptions={(options, params) => {
              const needle = params.inputValue.trim().toLowerCase()
              if (!needle) return options
              return options.filter((option) =>
                option.searchText.includes(needle),
              )
            }}
            renderInput={(params) => (
              <TextField {...params} label="Country or region" />
            )}
          />
          <TextField
            label="Address line 1"
            size="small"
            fullWidth
            value={fields.line1}
            disabled={!canManage || busy}
            onChange={set('line1')}
            slotProps={{ htmlInput: { 'aria-label': 'Address line 1' } }}
          />
          <TextField
            label="Address line 2"
            size="small"
            fullWidth
            value={fields.line2}
            disabled={!canManage || busy}
            onChange={set('line2')}
            slotProps={{ htmlInput: { 'aria-label': 'Address line 2' } }}
          />
          {/*
            Three across, and allowed to WRAP.

            `fullWidth` lets these shrink without overflowing, but shrinking is
            its own failure: MUI sizes a TextField from its input, so at a
            third of a narrow column "State or province" renders as a truncated
            label on a control too small to type a value into. `useFlexGap` +
            `flexWrap` with a floor per field means the row breaks onto a
            second line instead — the column width is what varies between
            breakpoints, so the row has to be the thing that gives.
          */}
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            useFlexGap
            sx={{ flexWrap: 'wrap' }}
          >
            <TextField
              label="City"
              size="small"
              sx={{ minWidth: COMPACT_FIELD_WIDTH, flexGrow: 1 }}
              value={fields.city}
              disabled={!canManage || busy}
              onChange={set('city')}
              slotProps={{ htmlInput: { 'aria-label': 'City' } }}
            />
            <TextField
              label="State or province"
              size="small"
              sx={{ minWidth: COMPACT_FIELD_WIDTH, flexGrow: 1 }}
              value={fields.state}
              disabled={!canManage || busy}
              onChange={set('state')}
              slotProps={{ htmlInput: { 'aria-label': 'State or province' } }}
            />
            <TextField
              label="Postal code"
              size="small"
              sx={{ minWidth: COMPACT_FIELD_WIDTH, flexGrow: 1 }}
              value={fields.postalCode}
              disabled={!canManage || busy}
              onChange={set('postalCode')}
              slotProps={{ htmlInput: { 'aria-label': 'Postal code' } }}
            />
          </Stack>
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              size="small"
              disabled={!canManage || busy}
              onClick={save}
            >
              {'Save'}
            </Button>
          </Stack>
        </Stack>
      )}
    </BillingProfileGateComponent>
  )
}
