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
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
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
    <CardDisplay header={'Taxes'} contentGutterX contentGutterY>
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
