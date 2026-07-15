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
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Button, Chip, Stack, TextField, Typography } from '@mui/material'
import {
  collection,
  deleteDoc,
  doc,
  limit,
  query,
  setDoc,
} from 'firebase/firestore'
import { useCallback, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { useFirestoreCollection } from '@aglyn/tenant-feature-instance'
import { useFirestoreDoc } from '@aglyn/tenant-feature-instance'
import { useHostOrgId } from '@aglyn/tenant-feature-instance'
import { useHostResourceApi } from '@aglyn/tenant-feature-instance'

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
  const orgId = useHostOrgId(hostId)
  const { data: org } = useFirestoreDoc<any>(
    () => doc(firestore, 'orgs', orgId ?? '-pending-'),
    [firestore, orgId],
  )
  const { data: locationDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'locations'), limit(25)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const locations = [...(locationDocs ?? [])].sort((a: any, b: any) =>
    String(a.name ?? '').localeCompare(String(b.name ?? '')),
  )
  const quota = Aglyn.checkQuota(org, 'inventoryLocations', locations.length)
  const [name, setName] = useState('')

  const handleAdd = useCallback(async () => {
    if (!name.trim()) return
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
    } catch (error: any) {
      enqueueSnackbar(error?.message ?? 'Could not add location', {
        variant: 'warning',
        persist: false,
      })
    }
  }, [name, quota, locations.length, hostId, createHostResource, enqueueSnackbar])

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

  return (
    <CardDisplay header={'Inventory locations'} contentGutterX contentGutterY>
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
          <Button size="small" disabled={!name.trim()} onClick={handleAdd}>
            {'Add'}
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {`${locations.length}/${quota.limit === Aglyn.UNLIMITED ? '∞' : quota.limit} locations on your plan`}
        </Typography>
      </Stack>
    </CardDisplay>
  )
}
LocationsCard.displayName = 'LocationsCard'

export default LocationsCard
