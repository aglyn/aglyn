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
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
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
import { useFirestoreDoc } from '@aglyn/tenant-feature-instance'

export interface ShippingSettingsCardProps {
  hostId: string
}

/**
 * Shipping settings (AGL-288): zones (countries, '*' = rest of world)
 * and rates (flat / free-over / subtotal or weight tiers), stored on
 * `hosts/{hostId}/settings/store` under `shipping`. The cart estimator
 * and checkout resolve options via `resolveShippingRates`.
 */
export function ShippingSettingsCard(props: ShippingSettingsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { data: store } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId, 'settings', 'store'),
    [firestore, hostId],
  )
  const [draft, setDraft] = useState<Aglyn.ShippingSettings | null>(null)
  const current: Aglyn.ShippingSettings = draft ?? store?.shipping ?? {}
  const update = (patch: Partial<Aglyn.ShippingSettings>) =>
    setDraft({ ...current, ...patch })

  const updateZone = (
    index: number,
    patch: Partial<Aglyn.ShippingZone> | null,
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
    patch: Partial<Aglyn.ShippingRate> | null,
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
    await setDoc(
      doc(firestore, 'hosts', hostId, 'settings', 'store'),
      { shipping: current },
      { merge: true },
    )
    setDraft(null)
    enqueueSnackbar('Shipping settings saved', {
      variant: 'success',
      persist: false,
    })
  }, [current, firestore, hostId, enqueueSnackbar])

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
                    kind: event.target.value as Aglyn.ShippingRate['kind'],
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
        <Button
          variant="contained"
          color="secondary"
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
