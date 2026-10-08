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
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import QuotaReadoutComponent from '@aglyn/shared-ui-jsx/components/quota-readout.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { invalidOpeningHoursLines } from '@aglyn/aglyn/app-utils/local-business'
import {
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  limit,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { useFirestoreCollection } from '@aglyn/tenant-feature-instance'
import { useHostResourceApi } from '@aglyn/tenant-feature-instance'
import { useOrgPlan } from '@aglyn/tenant-feature-instance'
import { pluginDocsHelp } from '@aglyn/aglyn'

export interface LocationsCardProps {
  hostId: string
}

/**
 * Inventory locations (AGL-286): named stock buckets under
 * `hosts/{hostId}/locations`, capped by the plan's `inventoryLocations`
 * quota (AGL-278). Variant stock splits per location in the products
 * hub; POS registers sell from their location (AGL-312).
 */
export function LocationsCard(props: LocationsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const createHostResource = useHostResourceApi()
  const { org, ready: planReady } = useOrgPlan(hostId)
  const { data: locationDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'locations'), limit(25)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const locations = [...(locationDocs ?? [])].sort((a: any, b: any) =>
    String(a.name ?? '').localeCompare(String(b.name ?? '')),
  )
  /**
   * The location HEAD-COUNT is a server aggregate, not the length of the
   * capped listener (AGL-1716, the AGL-1706 shape).
   *
   * The smallest margin of the eight, and real for exactly one plan: the
   * listener is `limit(25)` and `inventoryLocations` runs 1 / 1 / 2 / 4 / 6 /
   * 10 / 50, so only Agency's 50 sits above the window. An agency with more
   * than 25 stock buckets read its cap as satisfiable, and
   * `api/hosts/resources` — which counts the collection — refused the add.
   *
   * Re-read after an add AND a delete: locations are hard-deleted here, so
   * unlike the soft-deleting cards a removal really does free a slot on both
   * sides, and a one-shot that missed it would keep refusing.
   *
   * `locations.length === 0` below still decides the FIRST location's
   * `isDefault` flag off the loaded rows, which is the right question for it
   * — that one is about what this card can see, not about the site's total.
   */
  const [locationCountEpoch, setLocationCountEpoch] = useState(0)
  const [serverLocationCount, setServerLocationCount] = useState<number | null>(
    null,
  )
  useEffect(() => {
    let active = true
    void getCountFromServer(collection(firestore, 'hosts', hostId, 'locations'))
      .then((snapshot) => {
        if (active) setServerLocationCount(snapshot.data().count)
      })
      .catch(() => {
        // Falls back to the loaded rows — a LOWER bound and the prior
        // behaviour, never 0, which reads as "no locations used" on a site
        // that is over its band.
      })
    return () => {
      active = false
    }
  }, [firestore, hostId, locationCountEpoch])
  const locationCount = serverLocationCount ?? locations.length
  const quota = Aglyn.checkQuota(org, 'inventoryLocations', locationCount)
  const [name, setName] = useState('')

  const handleAdd = useCallback(async () => {
    if (!name.trim()) return
    // Held until the org doc lands (AGL-1064): an absent org resolves to
    // the free tier's `inventoryLocations: 1`, so a site that already has
    // its default location would be refused with an upgrade prompt it does
    // not need. The button is disabled too; this guards the race.
    if (!planReady) return
    if (!quota.allowed) {
      return void enqueueSnackbar(
        `Your plan includes ${quota.limit} locations — upgrade for more`,
        { variant: 'info', persist: false },
      )
    }
    try {
      // Creation rides the quota-enforcing resources API (AGL-473).
      await createHostResource({
        hostId,
        resource: 'location',
        data: {
          name: name.trim().slice(0, 80),
          ...(locations.length === 0 ? { isDefault: true } : {}),
        } satisfies CommerceModel.InventoryLocation,
      })
      setName('')
      setLocationCountEpoch((epoch) => epoch + 1)
    } catch (error: any) {
      enqueueSnackbar(error?.message ?? 'Could not add location', {
        variant: 'warning',
        persist: false,
      })
    }
  }, [
    name,
    planReady,
    quota,
    locations.length,
    hostId,
    createHostResource,
    enqueueSnackbar,
  ])

  const handleDelete = useCallback(
    (location: any) => async () => {
      const confirmed = await confirm({
        title: 'Remove this location?',
        description:
          `Stock bucketed under "${location.name}" folds back into the ` +
          'flat totals; adjust counts afterward if needed.',
        confirmationText: 'Remove',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      await deleteDoc(doc(firestore, 'hosts', hostId, 'locations', location.$id))
      // A HARD delete, so the slot really is freed on both sides — the
      // one-shot aggregate has to be told (AGL-1716).
      setLocationCountEpoch((epoch) => epoch + 1)
    },
    [confirm, firestore, hostId],
  )

  const handleMakeDefault = useCallback(
    (location: any) => async () => {
      for (const other of locations) {
        if (other.isDefault && other.$id !== location.$id) {
          await setDoc(
            doc(firestore, 'hosts', hostId, 'locations', other.$id),
            { isDefault: false },
            { merge: true },
          )
        }
      }
      await setDoc(
        doc(firestore, 'hosts', hostId, 'locations', location.$id),
        { isDefault: true },
        { merge: true },
      )
    },
    [locations, firestore, hostId],
  )

  /*
   * A location's postal address (AGL-3612): where parcels can leave from,
   * for anything that ships. Optional, written beside the free-text name.
   */
  const [addressFor, setAddressFor] = useState<any | null>(null)
  const [addressDraft, setAddressDraft] = useState<CommerceModel.PostalAddress>({})
  const openAddress = useCallback(
    (location: any) => () => {
      setAddressFor(location)
      setAddressDraft(CommerceModel.normalizePostalAddress(location.postalAddress) ?? {})
    },
    [],
  )
  const handleSaveAddress = useCallback(async () => {
    if (!addressFor) return
    try {
      await setDoc(
        doc(firestore, 'hosts', hostId, 'locations', addressFor.$id),
        { postalAddress: CommerceModel.normalizePostalAddress(addressDraft) ?? {} },
        { merge: true },
      )
      setAddressFor(null)
    } catch (error: any) {
      enqueueSnackbar(error?.message ?? 'Could not save the address', {
        variant: 'warning',
        persist: false,
      })
    }
  }, [addressDraft, addressFor, enqueueSnackbar, firestore, hostId])
  const addressField = (field: keyof CommerceModel.PostalAddress, label: string) => (
    <TextField
      label={label}
      value={addressDraft[field] ?? ''}
      onChange={(event) =>
        setAddressDraft((prior) => ({
          ...prior,
          [field]: field === 'country' ? event.target.value.toUpperCase().slice(0, 2) : event.target.value,
        }))
      }
      size="small"
    />
  )

  /*
   * Pickup at a location (AGL-3624): whether buyers may collect orders here,
   * its hours and what to do on arrival. Checkout offers every location that
   * has it on, and routes the order and its stock there.
   */
  const [pickupFor, setPickupFor] = useState<any | null>(null)
  const [pickupDraft, setPickupDraft] = useState<CommerceModel.PickupLocationSettings>({})
  const openPickup = useCallback(
    (location: any) => () => {
      setPickupFor(location)
      setPickupDraft(CommerceModel.normalizePickupSettings(location.pickup))
    },
    [],
  )
  const badHourLines = invalidOpeningHoursLines(pickupDraft.hours ?? '')
  const handleSavePickup = useCallback(async () => {
    if (!pickupFor) return
    try {
      // `updateDoc` replaces the map whole, so a cleared field is cleared;
      // a merge-set would deep-merge it back.
      await updateDoc(doc(firestore, 'hosts', hostId, 'locations', pickupFor.$id), {
        pickup: CommerceModel.normalizePickupSettings(pickupDraft),
      })
      setPickupFor(null)
    } catch (error: any) {
      enqueueSnackbar(error?.message ?? 'Could not save pickup', {
        variant: 'warning',
        persist: false,
      })
    }
  }, [enqueueSnackbar, firestore, hostId, pickupDraft, pickupFor])

  return (
    <CardDisplay
      header={'Inventory locations'}
      help={pluginDocsHelp('commerce', { anchor: '#inventory' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1}>
        {locations.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'Track stock per warehouse or storefront. Without locations, ' +
              'every variant has a single stock count.'}
          </Typography>
        ) : (
          locations.map((location: any) => (
            <Stack
              key={location.$id}
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center' }}
            >
              <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                {location.name}
              </Typography>
              {CommerceModel.normalizePickupSettings(location.pickup).enabled ? (
                <Chip label="Pickup" size="small" color="primary" variant="outlined" />
              ) : null}
              <Button size="small" onClick={openPickup(location)}>
                {'Pickup'}
              </Button>
              <Button size="small" onClick={openAddress(location)}>
                {location.postalAddress?.line1 ? 'Edit address' : 'Add address'}
              </Button>
              {location.isDefault ? (
                <Chip label="Default" size="small" variant="outlined" />
              ) : (
                <Button size="small" onClick={handleMakeDefault(location)}>
                  {'Make default'}
                </Button>
              )}
              <Button size="small" color="error" onClick={handleDelete(location)}>
                {'Remove'}
              </Button>
            </Stack>
          ))
        )}
        <Stack direction="row" spacing={1}>
          <TextField
            label="New location"
            value={name}
            onChange={(event) => setName(event.target.value)}
            size="small"
            sx={{ flex: 1 }}
            placeholder="Main warehouse"
          />
          <Button
            size="small"
            disabled={!name.trim() || !planReady}
            onClick={handleAdd}
          >
            {'Add'}
          </Button>
        </Stack>
        {/* The site's locations, not this card's rows (AGL-1716) — the
            readout and the gate must agree, and the gate now counts.
            The wording moved to the shared component in AGL-2113 so the five
            sibling cards that were missing it render the identical string
            rather than five near-misses; the output here is unchanged. */}
        <QuotaReadoutComponent
          ready={planReady}
          used={locationCount}
          limit={quota.limit}
          noun="location"
        />
      </Stack>
      <Dialog open={Boolean(addressFor)} onClose={() => setAddressFor(null)} fullWidth maxWidth="sm">
        <DialogTitle>{`Address of ${addressFor?.name ?? 'this location'}`}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            {addressField('line1', 'Street address')}
            {addressField('line2', 'Apartment, suite (optional)')}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              {addressField('city', 'City')}
              {addressField('state', 'State or region')}
              {addressField('postalCode', 'Postal code')}
              {addressField('country', 'Country (two letters)')}
            </Stack>
            {addressField('phone', 'Phone')}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddressFor(null)}>{'Cancel'}</Button>
          <Button variant="contained" onClick={handleSaveAddress}>
            {'Save'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={Boolean(pickupFor)} onClose={() => setPickupFor(null)} fullWidth maxWidth="sm">
        <DialogTitle>{`Pickup at ${pickupFor?.name ?? 'this location'}`}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={Boolean(pickupDraft.enabled)}
                  onChange={(event) =>
                    setPickupDraft((prior) => ({ ...prior, enabled: event.target.checked }))
                  }
                />
              }
              label="Buyers can pick up orders here"
            />
            {pickupDraft.enabled && !pickupFor?.postalAddress?.line1 && !pickupFor?.address ? (
              <Typography variant="caption" color="warning.main">
                {'Add this location’s address so buyers know where to go.'}
              </Typography>
            ) : null}
            <TextField
              label="Pickup hours"
              value={pickupDraft.hours ?? ''}
              onChange={(event) => setPickupDraft((prior) => ({ ...prior, hours: event.target.value }))}
              multiline
              minRows={2}
              size="small"
              placeholder={'Mo-Fr 09:00-17:00\nSa 10:00-14:00'}
              error={badHourLines.length > 0}
              helperText={
                badHourLines.length
                  ? `Line ${badHourLines.join(', ')} does not read as days and times, like Mo-Fr 09:00-17:00.`
                  : 'One line per set of days, like Mo-Fr 09:00-17:00.'
              }
            />
            <TextField
              label="Arrival instructions"
              value={pickupDraft.instructions ?? ''}
              onChange={(event) =>
                setPickupDraft((prior) => ({ ...prior, instructions: event.target.value }))
              }
              multiline
              minRows={2}
              size="small"
              placeholder="Ring the bell at the side door and give your order number."
              slotProps={{ htmlInput: { maxLength: CommerceModel.PICKUP_INSTRUCTIONS_MAX } }}
            />
            <TextField
              select
              label="Usually ready in"
              value={String(pickupDraft.readyWithinMinutes ?? '')}
              onChange={(event) =>
                setPickupDraft((prior) => ({
                  ...prior,
                  readyWithinMinutes: event.target.value ? Number(event.target.value) : undefined,
                }))
              }
              size="small"
            >
              <MenuItem value="">{'Don’t say'}</MenuItem>
              {[
                [30, '30 minutes'],
                [60, '1 hour'],
                [120, '2 hours'],
                [240, '4 hours'],
                [1440, '1 day'],
                [2880, '2 days'],
              ].map(([minutes, label]) => (
                <MenuItem key={minutes} value={String(minutes)}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
            <Typography variant="caption" color="text.secondary">
              {'Buyers choose this location at checkout. The order’s stock comes off this location, ' +
                'and the buyer is emailed when you mark the order ready.'}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPickupFor(null)}>{'Cancel'}</Button>
          <Button variant="contained" disabled={badHourLines.length > 0} onClick={handleSavePickup}>
            {'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
LocationsCard.displayName = 'LocationsCard'

export default LocationsCard
