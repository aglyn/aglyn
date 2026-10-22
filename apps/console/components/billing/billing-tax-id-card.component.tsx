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

import { useConfirmationContext, useLoading } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Autocomplete,
  Button,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import BillingProfileGateComponent from './billing-profile-gate.component'
import { COMPACT_FIELD_WIDTH } from '../../constants/shared'
import {
  TAX_ID_TYPE_OPTIONS,
  taxIdTypeLabel,
  type TaxIdTypeOption,
} from '../../utils/stripe-tax-id-types'
import type { BillingProfile } from './use-billing-profile'

export interface BillingTaxIdCardProps {
  profile: BillingProfile
  /** billing.manage: the form saves; read-only otherwise. */
  canManage: boolean
}

/**
 * The org's own tax registration numbers, on its invoices.
 *
 * ## Why a searchable type picker and not a text field
 *
 * Stripe stores a tax ID as a `(type, value)` pair, and the type is what
 * decides how the number is printed and how a tax authority reads it. There
 * are ~100 of them. A free-text type is unusable; a short list of "the ones
 * we thought of" silently excludes every other jurisdiction; and a scrolling
 * `<select>` of a hundred rows is a worse version of the same problem. So it
 * is one searchable field, matching on the country name, the abbreviation and
 * the raw Stripe code — a customer who knows they need `us_ein` types that,
 * and one who does not types "United States".
 *
 * ## Where the list comes from
 *
 * Stripe's own, lifted out of `@stripe/stripe-js` by
 * `tools/scripts/generate-stripe-tax-id-types.mjs`, with a spec that
 * re-extracts on every run and fails on drift. A hand-written enum here would
 * be wrong within a quarter and wrong in the expensive direction: the customer
 * picks the nearest available type, and the compliance cost of a wrong type on
 * an invoice is theirs, not ours.
 *
 * ## Why there is no client-side format check
 *
 * Stripe validates per type, its rules track the law, and a second validator
 * of ours would eventually refuse a number Stripe would have accepted. So the
 * value goes to Stripe unexamined and STRIPE'S OWN REJECTION is what the
 * customer reads — it names the format expected for the type they chose, which
 * is the one sentence that stays true as the rules change. It is rendered
 * inline rather than only in a toast, because it is read while retyping.
 */
export default function BillingTaxIdCardComponent({
  profile,
  canManage,
}: BillingTaxIdCardProps) {
  const { state, loadState, reload, request } = profile
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const { confirm } = useConfirmationContext()
  const [type, setType] = useState<TaxIdTypeOption | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  /** Stripe's verbatim refusal for the pair just submitted, or null. */
  const [rejection, setRejection] = useState<string | null>(null)

  const save = async () => {
    setBusy(true)
    setRejection(null)
    const dequeue = queueLoading()
    try {
      const outcome = await request({
        action: 'add-tax-id',
        taxIdType: type?.code ?? '',
        taxIdValue: value,
      })
      if (!outcome.ok) {
        setRejection(outcome.error ?? 'Stripe rejected that tax ID.')
        return
      }
      setValue('')
      setType(null)
      enqueueSnackbar('Tax ID saved. It will appear on your invoices.', {
        variant: 'success',
        persist: false,
      })
    } finally {
      dequeue()
      setBusy(false)
    }
  }

  const remove = async (taxIdId: string) => {
    // The overlay has to drop BEFORE the dialog opens — it sits above the
    // dialog and swallows the Confirm click (AGL-535).
    const accepted = await confirm({
      title: 'Remove this tax ID?',
      description:
        'It will stop appearing on future invoices. Invoices already issued ' +
        'are unchanged — a finalized invoice is a legal record and is never ' +
        'edited after the fact.',
      confirmationText: 'Remove it',
    })
      .then(() => true)
      .catch(() => false)
    if (!accepted) return
    setBusy(true)
    const dequeue = queueLoading()
    try {
      const outcome = await request({ action: 'remove-tax-id', taxIdId })
      if (outcome.ok) {
        enqueueSnackbar('Tax ID removed.', { variant: 'success', persist: false })
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
      subject="tax IDs"
    >
      {(state) => (
        <Stack spacing={2}>
          {/*
            Editable before there is a subscription. A tax ID is a detail that
            belongs on an invoice, decided before there is an invoice to put it
            on — the workspace's Stripe customer is created on the first save.
          */}
          {state.taxIds.length ? (
            <List dense disablePadding>
              {state.taxIds.map((taxId) => (
                <ListItem
                  key={taxId.id}
                  disableGutters
                  secondaryAction={
                    canManage ? (
                      <IconButton
                        edge="end"
                        size="small"
                        disabled={busy}
                        aria-label={`Remove ${taxIdTypeLabel(
                          String(taxId.type ?? ''),
                        )}`}
                        onClick={() => remove(taxId.id)}
                      >
                        {'×'}
                      </IconButton>
                    ) : null
                  }
                >
                  <ListItemText
                    primary={taxId.value ?? ''}
                    secondary={
                      <Stack
                        direction="row"
                        spacing={1}
                        component="span"
                        sx={{ alignItems: 'center' }}
                      >
                        <span>{taxIdTypeLabel(String(taxId.type ?? ''))}</span>
                        {/* Stripe verifies some types asynchronously, so
                            `unverified` is a real outcome the customer has
                            to be able to see — a number that will not be
                            honored looks identical to one that will
                            otherwise. */}
                        {taxId.verification &&
                        taxId.verification !== 'verified' ? (
                          <Chip
                            component="span"
                            label={taxId.verification}
                            size="small"
                            variant="outlined"
                            color={
                              taxId.verification === 'pending'
                                ? 'default'
                                : 'warning'
                            }
                          />
                        ) : null}
                      </Stack>
                    }
                    slotProps={{ secondary: { component: 'div' } }}
                  />
                </ListItem>
              ))}
            </List>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {'No tax IDs yet.'}
            </Typography>
          )}

          {rejection ? (
            // Stripe's own words. It names the format expected for the type
            // chosen, which is what the customer needs while retyping.
            <Alert severity="warning" onClose={() => setRejection(null)}>
              {rejection}
            </Alert>
          ) : null}

          {/*
            WRAPS rather than fits.

            The three controls have a combined minimum wider than this card
            gets in a multi-column layout, and a `direction="row"` Stack does
            not wrap: the Save button was laid out past the card's right edge
            and clipped. Sizing the controls down would only move the failure
            to the next breakpoint, because the column width is what changes —
            so the row is allowed to break instead, and each control keeps a
            width its own label fits in.

            `useFlexGap` is what makes that safe: Stack's default spacing is a
            margin on the following sibling, which a wrapped item carries onto
            the start of its new line. `gap` spaces both axes.
          */}
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            useFlexGap
            sx={{ alignItems: 'flex-start', flexWrap: 'wrap' }}
          >
            <Autocomplete
              sx={{ minWidth: COMPACT_FIELD_WIDTH, flexGrow: 1 }}
              size="small"
              disabled={!canManage || busy}
              options={TAX_ID_TYPE_OPTIONS}
              value={type}
              onChange={(_event, next) => setType(next)}
              getOptionLabel={(option) => option.label}
              isOptionEqualToValue={(option, selected) =>
                option.code === selected.code
              }
              // Match on the prose AND the raw Stripe code. The default
              // filter reads the label only, so a customer typing the code
              // their accountant gave them would find nothing.
              filterOptions={(options, params) => {
                const needle = params.inputValue.trim().toLowerCase()
                if (!needle) return options
                return options.filter((option) =>
                  option.searchText.includes(needle),
                )
              }}
              renderInput={(params) => (
                <TextField {...params} label="Type" placeholder="Search…" />
              )}
            />
            <TextField
              label="Tax ID"
              size="small"
              sx={{ minWidth: COMPACT_FIELD_WIDTH, flexGrow: 1 }}
              value={value}
              disabled={!canManage || busy}
              onChange={(event) => setValue(event.target.value)}
              slotProps={{ htmlInput: { 'aria-label': 'Tax ID' } }}
            />
            <Button
              variant="contained"
              size="small"
              disabled={!canManage || busy || !type || !value.trim()}
              onClick={save}
              sx={{ mt: { xs: 0, sm: 0.5 } }}
            >
              {'Save'}
            </Button>
          </Stack>
        </Stack>
      )}
    </BillingProfileGateComponent>
  )
}
