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
import useFirestoreDoc from '../../hooks/use-firestore-doc'

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
  const { data: store } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId, 'settings', 'store'),
    [firestore, hostId],
  )
  const [draft, setDraft] = useState<Aglyn.TaxSettings | null>(null)
  const current: Aglyn.TaxSettings = draft ?? store?.tax ?? { mode: 'manual' }
  const update = (patch: Partial<Aglyn.TaxSettings>) =>
    setDraft({ ...current, ...patch })
  const updateRate = (
    index: number,
    patch: Partial<Aglyn.TaxRate> | null,
  ) => {
    const rates = [...(current.rates ?? [])]
    if (patch === null) rates.splice(index, 1)
    else rates[index] = { country: '', pct: 0, ...rates[index], ...patch }
    update({ rates })
  }

  const handleSave = useCallback(async () => {
    await setDoc(
      doc(firestore, 'hosts', hostId, 'settings', 'store'),
      { tax: current },
      { merge: true },
    )
    setDraft(null)
    enqueueSnackbar('Tax settings saved', { variant: 'success', persist: false })
  }, [current, firestore, hostId, enqueueSnackbar])

  return (
    <CardDisplay header={'Taxes'} contentGutterX contentGutterY>
      <Stack spacing={1.5}>
        <TextField
          label="Calculation"
          value={current.mode ?? 'manual'}
          onChange={(event) =>
            update({ mode: event.target.value as 'manual' | 'stripe' })
          }
          size="small"
          select
          sx={{ maxWidth: 280 }}
        >
          <MenuItem value="manual">{'Manual rates (below)'}</MenuItem>
          <MenuItem value="stripe">{'Stripe Tax (automatic)'}</MenuItem>
        </TextField>
        {current.mode === 'stripe' ? (
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
                  inputProps={{ inputMode: 'decimal' }}
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
          color="secondary"
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
