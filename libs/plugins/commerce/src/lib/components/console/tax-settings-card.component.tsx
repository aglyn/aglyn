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

import * as Aglyn from '@aglyn/aglyn'
import * as CommerceModel from '../../model'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Divider,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { doc, setDoc } from 'firebase/firestore'
import { useCallback, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import {
  useFirestoreDoc,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import { pluginDocsHelp } from '@aglyn/aglyn'

export interface TaxSettingsCardProps {
  hostId: string
}

/**
 * Tax settings (AGL-285): manual per-region rates (most-specific wins)
 * or Stripe Tax automatic calculation, stored on
 * `hosts/{hostId}/settings/store` under `tax`. The legacy quick-buy
 * checkout taxes by the store origin; Checkout v2 taxes by destination.
 */
export function TaxSettingsCard(props: TaxSettingsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const {
    data: store,
    status: storeStatus,
    /**
     * The settings doc this form is seeded from is unconfirmed by the server
     * (AGL-1358). `current` is `draft ?? store?.tax ?? {mode: 'manual'}` and
     * the save writes `{tax: current}`, so `merge: true` protects the doc's
     * other maps and nothing inside this one. `mode` is the field that costs
     * money: a cached seed flipping `stripe` back to `manual` stops automatic
     * tax calculation — `resolveTaxRate` returns null in stripe mode — and
     * the store under-collects with nothing anywhere reporting it.
     */
    fromCache: storeFromCache,
  } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId, 'settings', 'store'),
    [firestore, hostId],
  )
  const [draft, setDraft] = useState<CommerceModel.TaxSettings | null>(null)
  const current: CommerceModel.TaxSettings = draft ?? store?.tax ?? { mode: 'manual' }
  /**
   * Whether anyone has ever answered the tax question for this store
   * (AGL-1999). Read from the SAVED document, never from `current` — the
   * `{ mode: 'manual' }` seed above is local state that has never reached
   * Firestore, and it is exactly what made this invisible: the card looked
   * configured while the server saw `mode: undefined`, took no branch, and
   * sold untaxed. Every storefront path now refuses that state, so the card
   * has to show it rather than paper over it.
   */
  const decided =
    storeStatus !== 'loading' && typeof store?.tax?.mode === 'string'
  const update = (patch: Partial<CommerceModel.TaxSettings>) =>
    setDraft({ ...current, ...patch })
  const updateRate = (
    index: number,
    patch: Partial<CommerceModel.TaxRate> | null,
  ) => {
    const rates = [...(current.rates ?? [])]
    if (patch === null) rates.splice(index, 1)
    else rates[index] = { country: '', pct: 0, ...rates[index], ...patch }
    update({ rates })
  }
  /**
   * One of the flat, per-regime rates (AGL-1969 lodging, AGL-2028 services).
   *
   * A blank field clears the rate rather than storing `NaN`: clearing is how a
   * merchant turns the regime back off, and `Number('')` is 0 while
   * `Number(' ')` is also 0 — neither of which should ever reach the document
   * as a "rate".
   */
  const updateFlat = (
    key: 'lodging' | 'service',
    patch: Partial<CommerceModel.FlatTaxRate>,
  ) => update({ [key]: { ...current[key], ...patch } })
  const flatPctText = (key: 'lodging' | 'service') => {
    const pct = current[key]?.pct
    return pct === undefined || pct === null ? '' : String(pct)
  }
  /**
   * Shown under a typed rate this will NOT apply. Silence here would be the
   * failure: `resolveFlatTaxCents` treats an out-of-range percentage as off,
   * so a decimal-point typo would otherwise save cleanly and collect nothing.
   */
  const flatPctProblem = (key: 'lodging' | 'service'): string | null => {
    const raw = current[key]?.pct
    if (raw === undefined || raw === null || String(raw) === '') return null
    if (Number(raw) === 0) return null
    return CommerceModel.isUsableFlatTaxPct(raw)
      ? null
      : `Enter a percentage between 0 and ${CommerceModel.FLAT_TAX_MAX_PCT}. ` +
          'This rate is not being applied.'
  }

  const handleSave = useCallback(async () => {
    /**
     * Refuse a save whose seed the server never confirmed (AGL-1358).
     *
     * No create path to exempt: this is a FIXED document path, so the
     * `{mode: 'manual'}` default produced when the cache has never seen the
     * map is not the harmless blank a fresh uid would be — writing it turns
     * automatic tax calculation off on a store that had it on.
     *
     * The guard WRAPS the write — an early return is a shape you can keep
     * while losing the protection.
     */
    const verdict = await writeGuardedBySeed(
      {
        subject: 'tax settings',
        unreadable: storeStatus === 'error',
        fromCache: storeFromCache,
      },
      async () => {
        await setDoc(
          doc(firestore, 'hosts', hostId, 'settings', 'store'),
          { tax: current },
          { merge: true },
        )
      },
    )
    // Before `setDraft(null)`, so a refusal keeps every typed rate on screen.
    if (!verdict.ok) {
      return void enqueueSnackbar(verdict.message, {
        variant: 'warning',
        persist: false,
      })
    }
    setDraft(null)
    enqueueSnackbar('Tax settings saved', { variant: 'success', persist: false })
  }, [current, firestore, hostId, enqueueSnackbar, storeStatus, storeFromCache])

  return (
    <CardDisplay
      header={'Taxes'}
      help={pluginDocsHelp('commerce', { anchor: '#shipping--taxes' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1.5}>
        {decided ? null : (
          // The store is not selling. Saying so here is the whole point: the
          // silent version of this state charged shoppers an untaxed total.
          <Alert severity="warning">
            {'Choose how this store handles sales tax and save. Until you ' +
              'do, checkout is turned off — we won’t take an order we can’t ' +
              'tax correctly.'}
          </Alert>
        )}
        <TextField
          label="Calculation"
          value={current.mode ?? 'manual'}
          onChange={(event) =>
            update({
              mode: event.target.value as 'manual' | 'stripe' | 'none',
            })
          }
          size="small"
          select
          sx={{ maxWidth: 280 }}
        >
          <MenuItem value="manual">{'Manual rates (below)'}</MenuItem>
          <MenuItem value="stripe">{'Stripe Tax (automatic)'}</MenuItem>
          {/* An explicit decision, not an omission (AGL-1999) — the option a
              merchant under a nexus threshold, or selling non-taxable goods,
              needs in order to sell at all. */}
          <MenuItem value="none">{'Don’t collect sales tax'}</MenuItem>
        </TextField>
        {current.mode === 'none' ? (
          <Typography variant="body2" color="text.secondary">
            {'This store adds no sales tax to any order. Orders still go ' +
              'through — the decision is recorded, not the tax.'}
          </Typography>
        ) : current.mode === 'stripe' ? (
          <Typography variant="body2" color="text.secondary">
            {'Stripe Tax calculates per buyer location at checkout. ' +
              'Activate Stripe Tax in your Stripe dashboard first.'}
          </Typography>
        ) : (
          <>
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={Boolean(current.pricesIncludeTax)}
                  onChange={(event) =>
                    update({ pricesIncludeTax: event.target.checked })
                  }
                />
              }
              label="Prices include tax (VAT-style)"
            />
            <Stack direction="row" spacing={1}>
              <TextField
                label="Origin country"
                value={current.origin?.country ?? ''}
                onChange={(event) =>
                  update({
                    origin: {
                      ...current.origin,
                      country: event.target.value.toUpperCase().slice(0, 2),
                    },
                  })
                }
                size="small"
                sx={{ width: 140 }}
                placeholder="US"
              />
              <TextField
                label="Origin state"
                value={current.origin?.state ?? ''}
                onChange={(event) =>
                  update({
                    origin: {
                      ...current.origin,
                      state: event.target.value.toUpperCase().slice(0, 3),
                    },
                  })
                }
                size="small"
                sx={{ width: 140 }}
                placeholder="TX"
              />
            </Stack>
            {/* Which of the product's three addresses this is. A merchant
                who reads an unlabeled origin as "our address" may set it
                from the wrong one: the address the workspace pays Aglyn
                from is a different jurisdiction question, and the payout
                identity is a third. Naming the two it is NOT costs a line
                and prevents a mis-taxed order. */}
            <Typography variant="body2" color="text.secondary">
              {'Where this store ships or sells FROM — the jurisdiction the ' +
                'manual rates below are applied from. Not the address your ' +
                'workspace is billed at by Aglyn, and not where your payouts ' +
                'are sent.'}
            </Typography>
            {(current.rates ?? []).map((rate, index) => (
              <Stack key={index} direction="row" spacing={1}>
                <TextField
                  label="Country"
                  value={rate.country}
                  onChange={(event) =>
                    updateRate(index, {
                      country: event.target.value.toUpperCase().slice(0, 2),
                    })
                  }
                  size="small"
                  sx={{ width: 90 }}
                />
                <TextField
                  label="State"
                  value={rate.state ?? ''}
                  onChange={(event) =>
                    updateRate(index, {
                      state:
                        event.target.value.toUpperCase().slice(0, 3) ||
                        undefined,
                    })
                  }
                  size="small"
                  sx={{ width: 80 }}
                />
                <TextField
                  label="%"
                  value={rate.pct}
                  onChange={(event) =>
                    updateRate(index, { pct: Number(event.target.value) || 0 })
                  }
                  size="small"
                  sx={{ width: 80 }}
                  slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                />
                <TextField
                  label="Label"
                  value={rate.label ?? ''}
                  onChange={(event) =>
                    updateRate(index, { label: event.target.value })
                  }
                  size="small"
                  sx={{ flex: 1 }}
                  placeholder="Sales tax"
                />
                <Button
                  size="small"
                  color="error"
                  onClick={() => updateRate(index, null)}
                >
                  {'✕'}
                </Button>
              </Stack>
            ))}
            <Button
              size="small"
              sx={{ alignSelf: 'flex-start' }}
              onClick={() => updateRate(current.rates?.length ?? 0, {})}
            >
              {'Add rate'}
            </Button>
          </>
        )}
        {/*
          LODGING TAX (AGL-1969) — deliberately OUTSIDE the calculation branch
          above, and deliberately not a `rates[]` row.

          The setting above is a goods SALES rate resolved against an address.
          Occupancy tax is a different regime with its own rates, registration
          and return, and it applies to reservations, which sell nights rather
          than goods. Nesting it under "Manual rates" would have said the two
          are the same machinery; putting it here says a store on Stripe Tax —
          which cannot compute occupancy tax from these sessions at all — can
          still set one.

          It is off until the merchant fills it in, so nothing an existing
          store charges moves.
        */}
        <Divider sx={{ my: 0.5 }} />
        <Stack spacing={1}>
          <Typography variant="subtitle2">{'Lodging tax'}</Typography>
          <Typography variant="body2" color="text.secondary">
            {'Charged on reservations, on top of the price, using the rate ' +
              'you enter here. It is separate from the sales tax above ' +
              'because occupancy tax is its own regime with its own rates ' +
              'and its own return. Leave it blank to charge none — that is ' +
              'the default.'}
          </Typography>
          <Stack direction="row" spacing={1}>
            <TextField
              label="Rate %"
              value={flatPctText('lodging')}
              onChange={(event) =>
                updateFlat('lodging', {
                  pct:
                    event.target.value === ''
                      ? undefined
                      : Number(event.target.value),
                })
              }
              size="small"
              sx={{ width: 110 }}
              placeholder="0"
              error={Boolean(flatPctProblem('lodging'))}
              helperText={flatPctProblem('lodging') ?? ' '}
              slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            />
            <TextField
              label="Label"
              value={current.lodging?.label ?? ''}
              onChange={(event) =>
                updateFlat('lodging', { label: event.target.value })
              }
              size="small"
              sx={{ flex: 1 }}
              placeholder="Occupancy tax"
              helperText="Shown to the guest on the receipt"
            />
          </Stack>
          {/*
            MECHANISM ONLY, AND NO REMITTANCE DETERMINATION.

            Whether a jurisdiction imposes occupancy tax, who must register for
            it and who must remit it are legal conclusions that attach by
            operation of law (AGL-1904/AGL-1956) and are the merchant's under
            the Terms. This copy says what the software DOES and what it does
            not do, and stops there — including the deposit basis, which is a
            real limitation rather than an answer this product has taken.
          */}
          <Alert severity="info">
            {`${PLATFORM_BRAND_NAME} applies the rate you enter and records ` +
              'what was charged. It does not determine whether this tax ' +
              'applies to you, at what rate, or where it should be paid — ' +
              'that is yours to decide.'}
          </Alert>
          <Typography variant="body2" color="text.secondary">
            {'On a reservation that takes a deposit, the rate is applied to ' +
              'the deposit — the amount actually charged here — not to the ' +
              'whole stay. If tax is due on the full stay, collect the ' +
              'difference the same way you collect the rest of the balance.'}
          </Typography>
        </Stack>
        {/*
          SERVICE TAX (AGL-2028) — the bookings sibling of the block above,
          and here for the same reason it is not in the bookings plugin's own
          settings: this is the one card a merchant comes to with a tax
          question, and a second tax surface elsewhere is how one of them ends
          up unanswered.

          Its EXISTENCE is also the opt-in AGL-2000 wanted. That issue
          declined to apply the goods rate to an appointment partly because
          nothing said the merchant meant these settings to cover bookings; a
          field labelled for services, blank until they fill it in, is them
          saying so.
        */}
        <Divider sx={{ my: 0.5 }} />
        <Stack spacing={1}>
          <Typography variant="subtitle2">{'Service tax'}</Typography>
          <Typography variant="body2" color="text.secondary">
            {'Charged on paid bookings, on top of the price, using the rate ' +
              'you enter here. It is separate from the sales tax above ' +
              'because whether a service is taxable is often a different ' +
              'question from whether goods are. Leave it blank to charge ' +
              'none — that is the default.'}
          </Typography>
          <Stack direction="row" spacing={1}>
            <TextField
              label="Rate %"
              value={flatPctText('service')}
              onChange={(event) =>
                updateFlat('service', {
                  pct:
                    event.target.value === ''
                      ? undefined
                      : Number(event.target.value),
                })
              }
              size="small"
              sx={{ width: 110 }}
              placeholder="0"
              error={Boolean(flatPctProblem('service'))}
              helperText={flatPctProblem('service') ?? ' '}
              slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            />
            <TextField
              label="Label"
              value={current.service?.label ?? ''}
              onChange={(event) =>
                updateFlat('service', { label: event.target.value })
              }
              size="small"
              sx={{ flex: 1 }}
              placeholder="Service tax"
              helperText="Shown to the client on the receipt"
            />
          </Stack>
          {/* MECHANISM ONLY, AND NO REMITTANCE DETERMINATION — see the
              lodging block above. */}
          <Alert severity="info">
            {`${PLATFORM_BRAND_NAME} applies the rate you enter and records ` +
              'what was charged. It does not determine whether this tax ' +
              'applies to you, at what rate, or where it should be paid — ' +
              'that is yours to decide.'}
          </Alert>
        </Stack>
        <Button
          variant="contained"
          color="primary"
          size="small"
          disabled={!draft}
          onClick={handleSave}
          sx={{ alignSelf: 'flex-start' }}
        >
          {'Save tax settings'}
        </Button>
      </Stack>
    </CardDisplay>
  )
}
TaxSettingsCard.displayName = 'TaxSettingsCard'

export default TaxSettingsCard
