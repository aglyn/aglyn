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
import { invalidOpeningHoursLines } from '@aglyn/aglyn/app-utils/local-business'
import * as CommerceModel from '../../model'
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
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { collection, doc, limit, query, setDoc } from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
  useFirestoreDoc,
  useUser,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import { pluginDocsHelp } from '@aglyn/aglyn'

export interface LocalDeliverySettingsCardProps {
  hostId: string
}

const LEAD_TIMES: ReadonlyArray<[number, string]> = [
  [0, 'No notice'],
  [60, '1 hour'],
  [120, '2 hours'],
  [240, '4 hours'],
  [1440, '1 day'],
  [2880, '2 days'],
]

/**
 * Local delivery (AGL-3624): the store's OWN delivery — zones by postal code
 * or by distance, each with a fee, a minimum order and a free-over
 * threshold, and the delivery windows a buyer books at the cart. Stored on
 * `settings/store.localDelivery`, written whole so a cleared field is
 * cleared. Marketplace couriers (DoorDash and the rest) are the Delivery apps
 * plugin's, and nothing here touches them.
 *
 * DISTANCE ZONES are offered only where the store's shipping address check
 * can place an address on a map (`GET /api/commerce/local-fulfillment`), and
 * need the store placed first ("Place on map"). Postal-code zones need
 * nothing.
 */
export function LocalDeliverySettingsCard(props: LocalDeliverySettingsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { data: store, status: storeStatus, fromCache } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId, 'settings', 'store'),
    [firestore, hostId],
  )
  const { data: locationDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'locations'), limit(25)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const [draft, setDraft] = useState<CommerceModel.LocalDeliverySettings | null>(null)
  const current: CommerceModel.LocalDeliverySettings = draft ?? (store?.localDelivery as CommerceModel.LocalDeliverySettings) ?? {}
  const update = (patch: Partial<CommerceModel.LocalDeliverySettings>) => setDraft({ ...current, ...patch })
  const [radiusAvailable, setRadiusAvailable] = useState(false)
  useEffect(() => {
    let live = true
    authorizedFetch(user, `/api/commerce/local-fulfillment?hostId=${encodeURIComponent(hostId)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((answer) => {
        if (live) setRadiusAvailable(Boolean(answer?.radius))
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [hostId, user])

  const zones = current.zones ?? []
  const updateZone = (index: number, patch: Partial<CommerceModel.LocalDeliveryZone> | null) => {
    const next = [...zones]
    if (patch === null) next.splice(index, 1)
    else next[index] = { ...next[index], ...patch }
    update({ zones: next })
  }
  const addZone = () =>
    update({
      zones: [
        ...zones,
        { id: Aglyn.createResourceUid(), name: 'Local delivery', kind: 'postcode', postcodes: [], feeCents: 0 },
      ],
    })

  const [locating, setLocating] = useState(false)
  const handleLocate = useCallback(async () => {
    if (!current.locationId) {
      return void enqueueSnackbar('Choose the location deliveries leave from first', { variant: 'info', persist: false })
    }
    setLocating(true)
    try {
      const response = await authorizedFetch(user, '/api/commerce/local-fulfillment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId, action: 'locate', locationId: current.locationId }),
      })
      const payload: any = await response.json().catch(() => ({}))
      if (!response.ok || !payload?.origin) {
        enqueueSnackbar(payload?.error ?? 'Could not place the store on a map', { variant: 'warning', persist: false })
        return
      }
      setDraft({ ...current, origin: payload.origin })
    } finally {
      setLocating(false)
    }
  }, [current, enqueueSnackbar, hostId, user])

  const badWindowLines = invalidOpeningHoursLines(current.windows ?? '')
  const problems = CommerceModel.localDeliveryProblems(CommerceModel.normalizeLocalDeliverySettings(current))

  const handleSave = useCallback(async () => {
    const value = CommerceModel.normalizeLocalDeliverySettings(current)
    const verdict = await writeGuardedBySeed(
      { subject: 'local delivery settings', unreadable: storeStatus === 'error', fromCache },
      async () => {
        // `mergeFields` replaces `localDelivery` whole and leaves every other
        // map on the settings document alone.
        await setDoc(doc(firestore, 'hosts', hostId, 'settings', 'store'), { localDelivery: value }, {
          mergeFields: ['localDelivery'],
        })
      },
    )
    if (!verdict.ok) {
      return void enqueueSnackbar(verdict.message, { variant: 'warning', persist: false })
    }
    setDraft(null)
    enqueueSnackbar('Local delivery saved', { variant: 'success', persist: false })
  }, [current, enqueueSnackbar, firestore, fromCache, hostId, storeStatus])

  const dollars = (cents: number | undefined) => (cents ? String(cents / 100) : '')
  const cents = (raw: string) => (raw.trim() === '' ? 0 : Math.max(0, Math.round(Number(raw) * 100) || 0))
  const locations = [...(locationDocs ?? [])].sort((a: any, b: any) =>
    String(a.name ?? '').localeCompare(String(b.name ?? '')),
  )

  return (
    <CardDisplay
      header={'Local delivery'}
      help={pluginDocsHelp('pickupAndDelivery', {
        anchor: '#set-up-local-delivery',
      })}
      HeaderProps={{
        action: (
          <Button variant="contained" size="small" disabled={!draft || badWindowLines.length > 0} onClick={handleSave}>
            {'Save'}
          </Button>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1.5}>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={Boolean(current.enabled)}
              onChange={(event) => update({ enabled: event.target.checked })}
            />
          }
          label="Deliver orders yourself"
        />
        <Typography variant="caption" color="text.secondary">
          {'Buyers choose local delivery at the cart, enter their postal code and book a delivery time. ' +
            'You mark each order out for delivery and delivered, and the buyer is told at each step.'}
        </Typography>
        {problems.length ? (
          <Alert severity="warning">{`Checkout won’t offer delivery yet: ${problems.join(' ')}`}</Alert>
        ) : null}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <TextField
            label="Country"
            value={current.country ?? ''}
            onChange={(event) => update({ country: event.target.value.toUpperCase().slice(0, 2) })}
            size="small"
            placeholder="US"
            helperText="Two letters"
            sx={{ width: { sm: 120 } }}
          />
          <TextField
            select
            label="Leaves from"
            value={current.locationId ?? ''}
            onChange={(event) => update({ locationId: event.target.value || undefined })}
            size="small"
            sx={{ flex: 1 }}
            helperText="Its stock is reserved and sold for delivery orders"
          >
            <MenuItem value="">{'No particular location'}</MenuItem>
            {locations.map((location: any) => (
              <MenuItem key={location.$id} value={location.$id}>
                {location.name}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        <Divider />
        <Typography variant="subtitle2">{'Zones'}</Typography>
        {zones.map((zone, index) => (
          <Stack key={zone.id} spacing={1}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <TextField
                label="Zone name"
                value={zone.name}
                onChange={(event) => updateZone(index, { name: event.target.value })}
                size="small"
                sx={{ flex: 1 }}
              />
              {radiusAvailable || zone.kind === 'radius' ? (
                <TextField
                  select
                  label="Matched by"
                  value={zone.kind}
                  onChange={(event) =>
                    updateZone(index, { kind: event.target.value as CommerceModel.LocalDeliveryZone['kind'] })
                  }
                  size="small"
                  sx={{ width: { sm: 160 } }}
                >
                  <MenuItem value="postcode">{'Postal codes'}</MenuItem>
                  <MenuItem value="radius">{'Distance'}</MenuItem>
                </TextField>
              ) : null}
              <Button size="small" color="error" onClick={() => updateZone(index, null)}>
                {'Remove'}
              </Button>
            </Stack>
            {zone.kind === 'radius' ? (
              <TextField
                label="Within (km)"
                type="number"
                value={zone.radiusKm ?? ''}
                onChange={(event) => updateZone(index, { radiusKm: Number(event.target.value) || 0 })}
                size="small"
                sx={{ width: { sm: 160 } }}
              />
            ) : (
              <TextField
                label="Postal codes"
                value={(zone.postcodes ?? []).join(', ')}
                onChange={(event) =>
                  updateZone(index, {
                    postcodes: event.target.value.split(',').map((code) => code.trim()).filter(Boolean),
                  })
                }
                size="small"
                placeholder="10001, 100*, 10010-10020"
                helperText="Exact codes, a prefix ending in *, or a range"
              />
            )}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <TextField
                label="Fee ($)"
                value={dollars(zone.feeCents)}
                onChange={(event) => updateZone(index, { feeCents: cents(event.target.value) })}
                size="small"
                slotProps={{ htmlInput: { inputMode: 'decimal' } }}
              />
              <TextField
                label="Minimum order ($)"
                value={dollars(zone.minimumCents)}
                onChange={(event) => updateZone(index, { minimumCents: cents(event.target.value) || undefined })}
                size="small"
                slotProps={{ htmlInput: { inputMode: 'decimal' } }}
              />
              <TextField
                label="Free over ($)"
                value={dollars(zone.freeOverCents)}
                onChange={(event) => updateZone(index, { freeOverCents: cents(event.target.value) || undefined })}
                size="small"
                slotProps={{ htmlInput: { inputMode: 'decimal' } }}
              />
            </Stack>
            <Divider flexItem />
          </Stack>
        ))}
        <Button size="small" sx={{ alignSelf: 'flex-start' }} onClick={addZone}>
          {'Add zone'}
        </Button>
        {zones.some((zone) => zone.kind === 'radius') ? (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="body2" sx={{ flex: 1 }}>
              {current.origin
                ? `Distances measure from ${current.origin.lat.toFixed(4)}, ${current.origin.lng.toFixed(4)}.`
                : 'Distance zones measure from the location deliveries leave from, once it is placed on a map.'}
            </Typography>
            <Button size="small" disabled={locating} onClick={handleLocate}>
              {current.origin ? 'Place again' : 'Place on map'}
            </Button>
          </Stack>
        ) : null}

        <Divider />
        <Typography variant="subtitle2">{'Delivery times'}</Typography>
        <TextField
          label="Delivery windows"
          value={current.windows ?? ''}
          onChange={(event) => update({ windows: event.target.value })}
          multiline
          minRows={2}
          size="small"
          placeholder={'Mo-Fr 09:00-12:00\nMo-Fr 13:00-17:00'}
          error={badWindowLines.length > 0}
          helperText={
            badWindowLines.length
              ? `Line ${badWindowLines.join(', ')} does not read as days and times, like Mo-Fr 09:00-12:00.`
              : 'One window per line. Each line is offered on each of its days.'
          }
        />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <TextField
            select
            label="Order at least"
            value={String(current.leadTimeMinutes ?? CommerceModel.LOCAL_DELIVERY_DEFAULT_LEAD_MINUTES)}
            onChange={(event) => update({ leadTimeMinutes: Number(event.target.value) })}
            size="small"
            helperText="Before a window starts"
            sx={{ flex: 1 }}
          >
            {LEAD_TIMES.map(([minutes, label]) => (
              <MenuItem key={minutes} value={String(minutes)}>
                {label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Book up to (days ahead)"
            type="number"
            value={current.daysAhead ?? CommerceModel.LOCAL_DELIVERY_DEFAULT_DAYS_AHEAD}
            onChange={(event) =>
              update({
                daysAhead: Math.min(
                  CommerceModel.LOCAL_DELIVERY_MAX_DAYS_AHEAD,
                  Math.max(1, Math.round(Number(event.target.value)) || 1),
                ),
              })
            }
            size="small"
            sx={{ flex: 1 }}
          />
        </Stack>
        <TextField
          label="What buyers should know"
          value={current.instructions ?? ''}
          onChange={(event) => update({ instructions: event.target.value })}
          multiline
          minRows={2}
          size="small"
          placeholder="We text when we’re 10 minutes away."
          slotProps={{ htmlInput: { maxLength: CommerceModel.PICKUP_INSTRUCTIONS_MAX } }}
        />
      </Stack>
    </CardDisplay>
  )
}
LocalDeliverySettingsCard.displayName = 'LocalDeliverySettingsCard'

export default LocalDeliverySettingsCard
