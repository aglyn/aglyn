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
  AlertTitle,
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

export interface ShippingSettingsCardProps {
  hostId: string
}

/**
 * Shipping settings (AGL-288): zones (countries, '*' = rest of world)
 * and rates (flat / free-over / subtotal or weight tiers), stored on
 * `hosts/{hostId}/settings/store` under `shipping`. Cart checkout (AGL-1707)
 * and buy-now (AGL-1720) both read this document and declare the rates as
 * Stripe `shipping_options` (`planCheckoutShipping`) — until those landed
 * nothing read it, and everything saved here was charged to nobody. Buy-now
 * resolves only for physical one-time sales; draft orders and POS still
 * resolve no shipping at all.
 *
 * WHAT A ZONE LAYOUT COSTS THE SHOPPER (AGL-1721). A session's rates are
 * charged as picked and never re-checked against the address, so the checkout
 * can only offer rates that hold for every country it will ship to. Saving
 * zones whose rates DIFFER therefore makes the storefront ask the shopper
 * where the parcel is going before it can price one, and a destination no
 * zone covers is refused outright rather than shipped for free. One zone, or
 * one '*' zone, needs neither: the shopper is asked nothing.
 *
 * AND THE MERCHANT HAS TO BE ABLE TO SEE IT (AGL-1791). Both consequences
 * were invisible here: a merchant saved zones and the checkouts they refused
 * were refused with nothing on this page saying so, which is a support ticket
 * from someone who did nothing wrong. The coverage block reads
 * `summarizeShippingCoverage` off the same `current` object the save writes,
 * so it moves as the form is typed rather than after a round trip.
 *
 * It escalates to a warning ONLY for a merchant who priced some destinations
 * and not others. A merchant whose rates reach nowhere is not misconfigured —
 * that store charges no shipping and refuses nobody — and warning them would
 * nag every store selling downloads.
 */
export function ShippingSettingsCard(props: ShippingSettingsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const {
    data: store,
    status: storeStatus,
    /**
     * The settings doc this form is seeded from is unconfirmed by the server
     * (AGL-1358). `current` is `draft ?? store?.shipping ?? {}` and the save
     * writes `{shipping: current}`, so `merge: true` protects the doc's other
     * maps and nothing inside this one — `zones` and `rates` are arrays, and
     * a merge replaces an array wholesale. Against a cached read, adding one
     * rate restores that snapshot's whole price table, and a zone that
     * disappears with it means `resolveShippingRates` matches nothing, which
     * is a checkout offering no shipping option at all.
     */
    fromCache: storeFromCache,
  } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId, 'settings', 'store'),
    [firestore, hostId],
  )
  const [draft, setDraft] = useState<CommerceModel.ShippingSettings | null>(null)
  const current: CommerceModel.ShippingSettings = draft ?? store?.shipping ?? {}
  const update = (patch: Partial<CommerceModel.ShippingSettings>) =>
    setDraft({ ...current, ...patch })

  const updateZone = (
    index: number,
    patch: Partial<CommerceModel.ShippingZone> | null,
  ) => {
    const zones = [...(current.zones ?? [])]
    if (patch === null) {
      const removed = zones.splice(index, 1)[0]
      update({
        zones,
        rates: (current.rates ?? []).filter(
          (rate) => rate.zoneId !== removed?.id,
        ),
      })
      return
    }
    zones[index] = {
      id: Aglyn.createResourceUid(),
      name: '',
      countries: [],
      ...zones[index],
      ...patch,
    }
    update({ zones })
  }

  const updateRate = (
    index: number,
    patch: Partial<CommerceModel.ShippingRate> | null,
  ) => {
    const rates = [...(current.rates ?? [])]
    if (patch === null) rates.splice(index, 1)
    else
      rates[index] = {
        id: Aglyn.createResourceUid(),
        zoneId: current.zones?.[0]?.id ?? '',
        name: '',
        kind: 'flat',
        ...rates[index],
        ...patch,
      }
    update({ rates })
  }

  const handleSave = useCallback(async () => {
    /**
     * Refuse a save whose seed the server never confirmed (AGL-1358).
     *
     * No create path to exempt: this is a FIXED document path, so the empty
     * `{}` that `store?.shipping ?? {}` yields when the cache has never seen
     * the map is not the harmless blank a fresh uid would be — it replaces
     * the real zones and rates with nothing.
     *
     * The guard WRAPS the write — an early return is a shape you can keep
     * while losing the protection.
     */
    const verdict = await writeGuardedBySeed(
      {
        subject: 'shipping settings',
        unreadable: storeStatus === 'error',
        fromCache: storeFromCache,
      },
      async () => {
        await setDoc(
          doc(firestore, 'hosts', hostId, 'settings', 'store'),
          { shipping: current },
          { merge: true },
        )
      },
    )
    // Before `setDraft(null)`, so a refusal keeps every zone and rate that
    // was typed on screen.
    if (!verdict.ok) {
      return void enqueueSnackbar(verdict.message, {
        variant: 'warning',
        persist: false,
      })
    }
    setDraft(null)
    enqueueSnackbar('Shipping settings saved', {
      variant: 'success',
      persist: false,
    })
  }, [current, firestore, hostId, enqueueSnackbar, storeStatus, storeFromCache])

  /**
   * Recomputed from `current` on every render, so the block answers for what
   * is typed rather than for what was last saved — a merchant deleting the
   * zone that covered France should see France go uncovered before they
   * commit it, not after.
   */
  const coverage = CommerceModel.summarizeShippingCoverage(current)
  const countryNames = (codes: readonly string[]) =>
    codes
      .map((code) => CommerceModel.CHECKOUT_SHIPPING_COUNTRY_NAMES[code] ?? code)
      .join(', ')
  /**
   * The one-click half of the fix: a zone claiming everywhere the merchant
   * has not named. It adds the ZONE only — a rate on it prices the parcel,
   * and choosing that price is the merchant's call, not ours. A rate row
   * defaulted here would post at whatever we picked, and a blank flat rate
   * resolves to free.
   */
  const addRestOfWorldZone = () =>
    updateZone(current.zones?.length ?? 0, {
      name: 'Rest of world',
      countries: ['*'],
    })

  const usd = (cents: number | undefined) =>
    cents == null ? '' : String(cents / 100)
  const cents = (raw: string) =>
    raw.trim() === '' ? undefined : Math.round(Number(raw) * 100)

  return (
    <CardDisplay header={'Shipping'} contentGutterX contentGutterY>
      <Stack spacing={1.5}>
        <Typography variant="subtitle2">{'Zones'}</Typography>
        {(current.zones ?? []).map((zone, index) => (
          <Stack key={zone.id} direction="row" spacing={1}>
            <TextField
              label="Zone name"
              value={zone.name}
              onChange={(event) =>
                updateZone(index, { name: event.target.value })
              }
              size="small"
              sx={{ width: 180 }}
            />
            <TextField
              label="Countries"
              value={zone.countries.join(', ')}
              onChange={(event) =>
                updateZone(index, {
                  countries: event.target.value
                    .split(',')
                    .map((code) => code.trim().toUpperCase())
                    .filter(Boolean),
                })
              }
              size="small"
              sx={{ flex: 1 }}
              placeholder="US, CA — or * for everywhere else"
            />
            <Button
              size="small"
              color="error"
              onClick={() => updateZone(index, null)}
            >
              {'✕'}
            </Button>
          </Stack>
        ))}
        <Button
          size="small"
          sx={{ alignSelf: 'flex-start' }}
          onClick={() => updateZone(current.zones?.length ?? 0, {})}
        >
          {'Add zone'}
        </Button>

        <Divider />
        <Typography variant="subtitle2">{'Rates'}</Typography>
        {(current.rates ?? []).map((rate, index) => (
          <Stack key={rate.id} spacing={1}>
            <Stack direction="row" spacing={1}>
              <TextField
                label="Zone"
                value={rate.zoneId}
                onChange={(event) =>
                  updateRate(index, { zoneId: event.target.value })
                }
                size="small"
                select
                sx={{ width: 150 }}
              >
                {(current.zones ?? []).map((zone) => (
                  <MenuItem key={zone.id} value={zone.id}>
                    {zone.name || zone.countries.join(',')}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Name"
                value={rate.name}
                onChange={(event) =>
                  updateRate(index, { name: event.target.value })
                }
                size="small"
                sx={{ flex: 1 }}
                placeholder="Standard"
              />
              <TextField
                label="Type"
                value={rate.kind}
                onChange={(event) =>
                  updateRate(index, {
                    kind: event.target.value as CommerceModel.ShippingRate['kind'],
                  })
                }
                size="small"
                select
                sx={{ width: 170 }}
              >
                <MenuItem value="flat">{'Flat'}</MenuItem>
                <MenuItem value="free_over">{'Free over subtotal'}</MenuItem>
                <MenuItem value="price_tiers">{'Subtotal tiers'}</MenuItem>
                <MenuItem value="weight_tiers">{'Weight tiers'}</MenuItem>
              </TextField>
              <Button
                size="small"
                color="error"
                onClick={() => updateRate(index, null)}
              >
                {'✕'}
              </Button>
            </Stack>
            {rate.kind === 'flat' || rate.kind === 'free_over' ? (
              <Stack direction="row" spacing={1}>
                <TextField
                  label="Price ($)"
                  value={usd(rate.amountCents)}
                  onChange={(event) =>
                    updateRate(index, { amountCents: cents(event.target.value) })
                  }
                  size="small"
                  sx={{ width: 120 }}
                  slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                />
                {rate.kind === 'free_over' ? (
                  <TextField
                    label="Free at subtotal ($)"
                    value={usd(rate.freeOverCents)}
                    onChange={(event) =>
                      updateRate(index, {
                        freeOverCents: cents(event.target.value),
                      })
                    }
                    size="small"
                    sx={{ width: 160 }}
                    slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                  />
                ) : null}
              </Stack>
            ) : (
              <Stack spacing={1} sx={{ pl: 2 }}>
                {(rate.tiers ?? []).map((tier, tierIndex) => (
                  <Stack key={tierIndex} direction="row" spacing={1}>
                    <TextField
                      label={
                        rate.kind === 'weight_tiers'
                          ? 'Up to (g)'
                          : 'Up to subtotal ($)'
                      }
                      value={
                        rate.kind === 'weight_tiers'
                          ? tier.upTo
                          : tier.upTo / 100
                      }
                      onChange={(event) => {
                        const tiers = [...(rate.tiers ?? [])]
                        const value = Number(event.target.value) || 0
                        tiers[tierIndex] = {
                          ...tier,
                          upTo:
                            rate.kind === 'weight_tiers'
                              ? Math.round(value)
                              : Math.round(value * 100),
                        }
                        updateRate(index, { tiers })
                      }}
                      size="small"
                      sx={{ width: 160 }}
                      slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                    />
                    <TextField
                      label="Price ($)"
                      value={tier.amountCents / 100}
                      onChange={(event) => {
                        const tiers = [...(rate.tiers ?? [])]
                        tiers[tierIndex] = {
                          ...tier,
                          amountCents: Math.round(
                            (Number(event.target.value) || 0) * 100,
                          ),
                        }
                        updateRate(index, { tiers })
                      }}
                      size="small"
                      sx={{ width: 120 }}
                      slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                    />
                    <Button
                      size="small"
                      color="error"
                      onClick={() =>
                        updateRate(index, {
                          tiers: (rate.tiers ?? []).filter(
                            (_item, itemIndex) => itemIndex !== tierIndex,
                          ),
                        })
                      }
                    >
                      {'✕'}
                    </Button>
                  </Stack>
                ))}
                <Button
                  size="small"
                  sx={{ alignSelf: 'flex-start' }}
                  onClick={() =>
                    updateRate(index, {
                      tiers: [
                        ...(rate.tiers ?? []),
                        { upTo: 0, amountCents: 0 },
                      ],
                    })
                  }
                >
                  {'Add tier'}
                </Button>
              </Stack>
            )}
          </Stack>
        ))}
        <Button
          size="small"
          disabled={(current.zones?.length ?? 0) === 0}
          sx={{ alignSelf: 'flex-start' }}
          onClick={() => updateRate(current.rates?.length ?? 0, {})}
        >
          {'Add rate'}
        </Button>

        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={Boolean(current.localPickup)}
              onChange={(event) =>
                update({ localPickup: event.target.checked })
              }
            />
          }
          label="Offer free local pickup"
        />

        <Divider />
        <Typography variant="subtitle2">{'Coverage'}</Typography>
        {coverage.unserved.length > 0 ? (
          <Alert
            severity="warning"
            action={
              coverage.hasRestOfWorldZone ? undefined : (
                <Button
                  size="small"
                  color="inherit"
                  onClick={addRestOfWorldZone}
                >
                  {'Add rest-of-world zone'}
                </Button>
              )
            }
          >
            <AlertTitle>
              {`Checkout turns away ${coverage.unserved.length} of the ${CommerceModel.CHECKOUT_SHIPPING_COUNTRIES.length} destinations it collects addresses for`}
            </AlertTitle>
            {`No rate reaches ${countryNames(coverage.unserved)}, so an order shipping there is refused rather than posted for free. `}
            {coverage.hasRestOfWorldZone
              ? 'A rest-of-world zone is already saved, so what those destinations are missing is a rate on the zone that covers them.'
              : 'Give them a zone with a rate, or add a rest-of-world zone and price one on it.'}
          </Alert>
        ) : (
          <Typography variant="caption" color="text.secondary">
            {coverage.shipsNowhere
              ? 'No rate reaches any destination, so checkout charges no shipping and turns nobody away.'
              : `Checkout can price shipping to every destination it collects an address for: ${countryNames(coverage.served)}.`}
          </Typography>
        )}
        {coverage.asksDestination ? (
          <Typography variant="caption" color="text.secondary">
            {
              'Rates differ by destination, so checkout asks the shopper where the parcel is going before it can price one.'
            }
          </Typography>
        ) : null}

        <Button
          variant="contained"
          color="primary"
          size="small"
          disabled={!draft}
          onClick={handleSave}
          sx={{ alignSelf: 'flex-start' }}
        >
          {'Save shipping settings'}
        </Button>
      </Stack>
    </CardDisplay>
  )
}
ShippingSettingsCard.displayName = 'ShippingSettingsCard'

export default ShippingSettingsCard
