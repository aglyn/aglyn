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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Box,
  Button,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { doc } from 'firebase/firestore'
import { useCallback, useState } from 'react'
import { pluginDocsHelp } from '@aglyn/aglyn'
import {
  useFirestore,
  useFirestoreDoc,
  useUser,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import { writeSiteWideChange } from '@aglyn/tenant-feature-instance/hooks/helpers/site-wide-change'
import {
  heldSaveLabel,
  isSeedChecking,
  seedCheckingText,
  useHeldSave,
  useSeedEdits,
} from '@aglyn/tenant-feature-instance/hooks/use-seed-edits'
import * as CommerceModel from '../../model'
import { useCurrencySetup } from './use-currency-setup'

export interface CurrenciesCardProps {
  hostId: string
}

/** The price each currency's preview converts: 250 of the store currency. */
const SAMPLE_MAJOR = 250


/**
 * Currencies (AGL-4248), beside Store settings: which other currencies the
 * store sells in, the rate each converts at (daily, or a manual one), its
 * price adjustment and rounding (off until turned on, as on Shopify), whether
 * its prices include tax, and whether shoppers get their own currency from
 * where they browse. Stored on `hosts/{hostId}/settings/store` under
 * `currencies`; the storefront and checkout read it through
 * `GET commerce/currency`.
 *
 * Same write guard as Store settings (AGL-1358): `currencies.currencies` is
 * an array, and a merge replaces an array wholesale, so a save from a seed
 * the server never confirmed would put a stale list back.
 */
export function CurrenciesCard(props: CurrenciesCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const {
    data: store,
    status: storeStatus,
    fromCache: storeFromCache,
    listen: storeListen,
  } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId, 'settings', 'store'),
    [firestore, hostId],
  )
  const base = CommerceModel.storeBaseCurrency(store)
  const saved = (store?.currencies ?? {}) as CommerceModel.StoreCurrencySettings
  const form = useSeedEdits<CommerceModel.StoreCurrencySettings>({
    enabled: saved.enabled === true,
    currencies: saved.currencies ?? [],
    autoDetect: saved.autoDetect !== false,
  })
  const current = form.values
  const list = current.currencies ?? []
  const checking = isSeedChecking({
    fromCache: storeFromCache,
    unreadable: storeStatus === 'error',
  })
  const { rates } = useCurrencySetup(hostId)
  const [adding, setAdding] = useState('')

  const setEntry = (index: number, patch: Partial<CommerceModel.StoreCurrency> | null) => {
    const next = [...list]
    if (patch === null) next.splice(index, 1)
    else next[index] = { ...next[index], ...patch }
    form.edit({ currencies: next })
  }
  // A whole entry, for a field whose clearing removes a key.
  const replaceEntry = (index: number, entry: CommerceModel.StoreCurrency) =>
    form.edit({ currencies: list.map((was, at) => (at === index ? entry : was)) })
  const addCurrency = (code: string) => {
    if (!code) return
    form.edit({ currencies: [...list, CommerceModel.newStoreCurrency(code)] })
    setAdding('')
  }
  const addable = CommerceModel.addableCurrencies(
    base,
    list.map((entry) => entry.code),
  )

  const handleSave = useCallback(async () => {
    const written = form.edits
    const verdict = await writeGuardedBySeed(
      {
        subject: 'currencies',
        unreadable: storeStatus === 'error',
        fromCache: storeFromCache,
        listen: storeListen,
      },
      async () => {
        // Prices on the live store change with no publish step, so the save
        // carries the site's cache drop with it, as Store settings does.
        await writeSiteWideChange({
          firestore,
          user,
          hostId,
          write: (batch) =>
            batch.set(
              doc(firestore, 'hosts', hostId, 'settings', 'store'),
              {
                currencies: {
                  enabled: current.enabled === true,
                  currencies: (current.currencies ?? []).map((entry) => ({
                    code: entry.code,
                    rounding: entry.rounding ?? 'none',
                    bufferPct: CommerceModel.clampAdjustmentInput(String(entry.bufferPct ?? 0)),
                    // Blank is the daily rate: the key is left off, never null.
                    ...(entry.manualRate && entry.manualRate > 0 ? { manualRate: entry.manualRate } : {}),
                    pricesIncludeTax: entry.pricesIncludeTax === true,
                  })),
                  autoDetect: current.autoDetect !== false,
                },
              },
              { merge: true },
            ),
        })
      },
    )
    if (!verdict.ok) {
      return void enqueueSnackbar(verdict.message, { variant: 'warning', persist: false })
    }
    form.settle(written)
    enqueueSnackbar('Currencies saved', { variant: 'success', persist: false })
  }, [current, form, firestore, hostId, user, enqueueSnackbar, storeStatus, storeFromCache, storeListen])
  const held = useHeldSave(handleSave, {
    checking,
    subject: 'currencies',
    onRefused: (message) => enqueueSnackbar(message, { variant: 'warning', persist: false }),
  })

  const sampleMinor = CommerceModel.majorToMinor(SAMPLE_MAJOR, base)

  return (
    <CardDisplay
      header={'Currencies'}
      help={pluginDocsHelp('currencies')}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1.5}>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={current.enabled === true}
              onChange={(event) => form.edit({ enabled: event.target.checked })}
            />
          }
          label="Sell in other currencies"
        />
        <Typography variant="caption" color="text.secondary">
          {`Shoppers see and pay prices in their own currency. Stripe converts each payment and ` +
            `pays you in ${base}, less its conversion fee.`}
        </Typography>
        {current.enabled ? (
          <>
            <Typography variant="body2" color="text.secondary" data-testid="currency-rates-updated">
              {rates?.asOfMs
                ? `Rates updated ${CommerceModel.ratesAsOfLabel(rates)} (European Central Bank, daily)`
                : 'Daily rates are not in yet: a currency without a manual rate sells in ' + base + ' until they are.'}
            </Typography>
            {list.map((entry, index) => (
              <Box key={entry.code}>
                <Divider sx={{ mb: 1.5 }} />
                <Stack spacing={1}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Typography variant="subtitle2" sx={{ flex: 1 }}>
                      {CommerceModel.currencyOptionLabel(entry.code)}
                    </Typography>
                    <IconButton
                      size="small"
                      aria-label={`Remove ${entry.code}`}
                      onClick={() => setEntry(index, null)}
                    >
                      {'✕'}
                    </IconButton>
                  </Stack>
                  <Typography variant="body2" color="text.secondary" data-testid={`currency-rate-${entry.code}`}>
                    {CommerceModel.currencyRateLabel(rates, base, entry)}
                  </Typography>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                    <TextField
                      label={`Manual exchange rate (${entry.code})`}
                      // Kept as typed until the field is left (as below).
                      defaultValue={entry.manualRate ? String(entry.manualRate) : ''}
                      placeholder="Daily rate"
                      onBlur={(event) => {
                        const manualRate = CommerceModel.parseManualRateInput(event.target.value)
                        const next = { ...entry }
                        if (manualRate) next.manualRate = manualRate
                        else delete next.manualRate
                        replaceEntry(index, next)
                      }}
                      size="small"
                      sx={{ minWidth: 220 }}
                      helperText={`${base} 1 = ${entry.code} this much. Blank uses the ${CommerceModel.dailyRateLabel(
                        rates,
                        base,
                        entry.code,
                      ).replace(/^Daily rate/, 'daily rate')}`}
                      slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                    />
                    <TextField
                      label={`Price adjustment (%) (${entry.code})`}
                      // Kept as typed until the field is left, so "2.5" can
                      // be typed through "2." without the dot being eaten.
                      defaultValue={entry.bufferPct ? String(entry.bufferPct) : ''}
                      placeholder="0"
                      onBlur={(event) =>
                        setEntry(index, { bufferPct: CommerceModel.clampAdjustmentInput(event.target.value) })
                      }
                      size="small"
                      sx={{ minWidth: 220 }}
                      helperText={
                        '-90 to +100. Stripe’s currency conversion fee (about 1–2%) comes out of your ' +
                        'payout unless you raise prices here.'
                      }
                      slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                    />
                  </Stack>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
                    <FormControlLabel
                      control={
                        <Switch
                          size="small"
                          checked={(entry.rounding ?? 'none') !== 'none'}
                          onChange={(event) =>
                            setEntry(index, { rounding: event.target.checked ? '99' : 'none' })
                          }
                        />
                      }
                      label={`Round converted prices (${entry.code})`}
                    />
                    {(entry.rounding ?? 'none') !== 'none' ? (
                      <TextField
                        label={`Round up to (${entry.code})`}
                        value={entry.rounding}
                        onChange={(event) =>
                          setEntry(index, { rounding: event.target.value as CommerceModel.CurrencyRounding })
                        }
                        size="small"
                        select
                        sx={{ minWidth: 220 }}
                      >
                        {CommerceModel.CURRENCY_ROUNDING_ENDINGS.map((value) => (
                          <MenuItem key={value} value={value}>
                            {CommerceModel.CURRENCY_ROUNDING_LABELS[value]}
                          </MenuItem>
                        ))}
                      </TextField>
                    ) : null}
                  </Stack>
                  <FormControlLabel
                    control={
                      <Switch
                        size="small"
                        checked={entry.pricesIncludeTax === true}
                        onChange={(event) => setEntry(index, { pricesIncludeTax: event.target.checked })}
                      />
                    }
                    label={`Prices in ${entry.code} include tax`}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {'For shoppers who expect VAT or GST in the price. Tax is worked out by Stripe Tax, ' +
                      'so it needs a Stripe Tax registration in each country that pays in this currency.'}
                  </Typography>
                  <Typography variant="body2" data-testid={`currency-preview-${entry.code}`}>
                    {CommerceModel.currencyPreviewText(sampleMinor, base, entry, rates)}
                  </Typography>
                </Stack>
              </Box>
            ))}
            <Divider />
            <TextField
              label="Add a currency"
              value={adding}
              onChange={(event) => addCurrency(event.target.value)}
              size="small"
              select
              sx={{ maxWidth: 320 }}
              disabled={!addable.length}
            >
              {addable.map((code) => (
                <MenuItem key={code} value={code}>
                  {CommerceModel.currencyOptionLabel(code)}
                </MenuItem>
              ))}
            </TextField>
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={current.autoDetect !== false}
                  onChange={(event) => form.edit({ autoDetect: event.target.checked })}
                />
              }
              label="Show each shopper prices in their own currency, picked from where they are browsing"
            />
            <Typography variant="caption" color="text.secondary">
              {'Shoppers can always switch with the Currency selector element; add it to your header ' +
                'or footer in the Besigner. Rates are the European Central Bank’s, updated daily. Set a ' +
                'fixed price in a currency on a product, add-on or shipping rate to skip conversion.'}
            </Typography>
          </>
        ) : null}
        <Button
          variant="contained"
          color="primary"
          size="small"
          disabled={!form.dirty || held.saving}
          onClick={held.press}
          sx={{ alignSelf: 'flex-start' }}
        >
          {heldSaveLabel(held, 'Save currencies')}
        </Button>
        {form.dirty && checking ? (
          <Typography variant="body2" color="text.secondary" role="status">
            {seedCheckingText('currencies')}
          </Typography>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
CurrenciesCard.displayName = 'CurrenciesCard'

export default CurrenciesCard
