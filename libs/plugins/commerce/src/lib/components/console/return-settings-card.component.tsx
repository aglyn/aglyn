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

import * as CommerceModel from '../../model'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Checkbox,
  FormControlLabel,
  FormGroup,
  FormLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { doc } from 'firebase/firestore'
import { useCallback, useMemo } from 'react'
import {
  useFirestore,
  useFirestoreDoc,
  useUser,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import { pluginDocsHelp } from '@aglyn/aglyn'
import { writeSiteWideChange } from '@aglyn/tenant-feature-instance/hooks/helpers/site-wide-change'
import {
  heldSaveLabel,
  isSeedChecking,
  seedCheckingText,
  useHeldSave,
  useSeedEdits,
} from '@aglyn/tenant-feature-instance/hooks/use-seed-edits'
import type { ProductType } from '../../model/commerce'

export interface ReturnSettingsCardProps {
  hostId: string
}

const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  physical: 'Physical products',
  digital: 'Digital products',
  service: 'Services',
}

/**
 * Return settings (AGL-3611) on `hosts/{hostId}/settings/store` `returns`:
 * whether buyers may ask for a return online, for how many days after the
 * order shipped, and which product types. The rules are the buyer's alone —
 * a merchant may start a return on any order from the order dialog.
 *
 * Written as the store settings card writes the same document: guarded by a
 * server-confirmed seed, merged so the other cards' fields stay, and with the
 * site's cache drop, since the buyer's account page offers returns from it.
 */
export function ReturnSettingsCard(props: ReturnSettingsCardProps) {
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
  const saved = useMemo(() => {
    const stored = CommerceModel.readReturnSettings(store?.returns)
    return {
      enabled: stored.enabled,
      windowDays: String(stored.windowDays),
      eligibleTypes: stored.eligibleTypes,
    }
  }, [store])
  // What was typed, kept as edits over the saved settings, and Save held
  // until the server has confirmed them (AGL-4047).
  const form = useSeedEdits(saved)
  const current = form.values
  const update = (patch: Partial<typeof current>) => form.edit(patch)
  const checking = isSeedChecking({ fromCache: storeFromCache, unreadable: storeStatus === 'error' })

  const days = Number(current.windowDays)
  const daysValid =
    current.windowDays.trim() !== '' &&
    Number.isInteger(days) &&
    days >= 0 &&
    days <= CommerceModel.RETURN_WINDOW_MAX_DAYS

  const toggleType = (type: ProductType, on: boolean) =>
    update({
      eligibleTypes: on
        ? [...current.eligibleTypes.filter((entry) => entry !== type), type]
        : current.eligibleTypes.filter((entry) => entry !== type),
    })

  const handleSave = useCallback(async () => {
    if (!daysValid) return
    const written = form.edits
    const verdict = await writeGuardedBySeed(
      {
        subject: 'return settings',
        unreadable: storeStatus === 'error',
        fromCache: storeFromCache,
        listen: storeListen,
      },
      async () => {
        await writeSiteWideChange({
          firestore,
          user,
          hostId,
          write: (batch) =>
            batch.set(
              doc(firestore, 'hosts', hostId, 'settings', 'store'),
              {
                returns: {
                  enabled: current.enabled,
                  windowDays: days,
                  eligibleTypes: (['physical', 'digital', 'service'] as ProductType[]).filter(
                    (type) => current.eligibleTypes.includes(type),
                  ),
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
    enqueueSnackbar('Return settings saved', { variant: 'success', persist: false })
  }, [form, daysValid, storeStatus, storeFromCache, storeListen, firestore, user, hostId, current, days, enqueueSnackbar])

  // A press while Save is held is kept, and saves once confirmed (AGL-4047).
  const held = useHeldSave(handleSave, {
    checking,
    subject: 'return settings',
    onRefused: (message) => enqueueSnackbar(message, { variant: 'warning', persist: false }),
  })

  return (
    <CardDisplay
      header={'Returns'}
      help={pluginDocsHelp('ordersAndReturns', { anchor: '#buyer-requests' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1.5}>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={current.enabled}
              onChange={(event) => update({ enabled: event.target.checked })}
            />
          }
          label="Accept return requests online"
        />
        <TextField
          label="Return window in days"
          type="number"
          value={current.windowDays}
          onChange={(event) => update({ windowDays: event.target.value })}
          size="small"
          error={!daysValid}
          helperText={`Days after the order shipped (or was placed, when nothing ships), 0–${CommerceModel.RETURN_WINDOW_MAX_DAYS}`}
          slotProps={{ htmlInput: { min: 0, max: CommerceModel.RETURN_WINDOW_MAX_DAYS, step: 1 } }}
          sx={{ maxWidth: 320 }}
        />
        <FormGroup>
          <FormLabel>{'Returnable product types'}</FormLabel>
          {(Object.keys(PRODUCT_TYPE_LABELS) as ProductType[]).map((type) => (
            <FormControlLabel
              key={type}
              control={
                <Checkbox
                  size="small"
                  checked={current.eligibleTypes.includes(type)}
                  onChange={(event) => toggleType(type, event.target.checked)}
                />
              }
              label={PRODUCT_TYPE_LABELS[type]}
            />
          ))}
        </FormGroup>
        <Button
          variant="contained"
          color="primary"
          size="small"
          disabled={!form.dirty || !daysValid || held.saving}
          onClick={held.press}
          sx={{ alignSelf: 'flex-start' }}
        >
          {heldSaveLabel(held, 'Save return settings')}
        </Button>
        {form.dirty && checking ? (
          <Typography variant="body2" color="text.secondary" role="status">
            {seedCheckingText('return settings')}
          </Typography>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
ReturnSettingsCard.displayName = 'ReturnSettingsCard'

export default ReturnSettingsCard
