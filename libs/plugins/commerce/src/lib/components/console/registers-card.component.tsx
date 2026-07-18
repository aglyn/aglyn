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
import { Button, Chip, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { collection, deleteDoc, doc, limit, query } from 'firebase/firestore'
import { useCallback, useState } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
  useFirestoreDoc,
  useHostOrgId,
  useHostResourceApi,
} from '@aglyn/tenant-feature-instance'

export interface RegistersCardProps {
  hostId: string
}

/**
 * POS registers (AGL-472): named registers under `hosts/{hostId}/registers`,
 * capped by the plan's `posRegisters` quota (Pro 1, Business 2, Advanced 5;
 * the $89/mo add-on raises it via a per-org entitlement override). Creation
 * rides the quota-enforcing resources API so the cap is authoritative;
 * every POS sale stamps its register so takings are attributable.
 */
export function RegistersCard(props: RegistersCardProps) {
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
  const { data: registerDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'registers'), limit(25)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: locationDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'locations'), limit(25)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const registers = [...(registerDocs ?? [])].sort((a: any, b: any) =>
    String(a.name ?? '').localeCompare(String(b.name ?? '')),
  )
  const locations = locationDocs ?? []
  const quota = Aglyn.checkQuota(org, 'posRegisters', registers.length)
  // Registers beyond the plan cap (e.g. after a downgrade) can't transact —
  // pos-order.ts blocks them by creation rank (AGL-482); mirror that here.
  const withinCap = CommerceModel.registersWithinCap(registers, quota.limit)
  const [name, setName] = useState('')
  const [locationId, setLocationId] = useState('')

  const handleAdd = useCallback(async () => {
    if (!name.trim()) return
    if (!quota.allowed) {
      return void enqueueSnackbar(
        quota.limit === 0
          ? 'POS registers require the Pro plan or above — see Billing'
          : `Your plan includes ${quota.limit} register${
              quota.limit === 1 ? '' : 's'
            } — add the register add-on in Billing for more`,
        { variant: 'info', persist: false },
      )
    }
    try {
      // Creation rides the quota-enforcing resources API (AGL-472/473).
      await createHostResource({
        hostId,
        resource: 'register',
        data: {
          name: name.trim().slice(0, 80),
          ...(locationId ? { locationId } : {}),
        } satisfies CommerceModel.PosRegister,
      })
      setName('')
      setLocationId('')
    } catch (error: any) {
      enqueueSnackbar(error?.message ?? 'Could not add register', {
        variant: 'warning',
        persist: false,
      })
    }
  }, [name, locationId, quota, hostId, createHostResource, enqueueSnackbar])

  const handleDelete = useCallback(
    (register: any) => async () => {
      const confirmed = await confirm({
        title: 'Remove this register?',
        description:
          `"${register.name}" stops being available at checkout. Past ` +
          'sales keep their register tag.',
        confirmationText: 'Remove',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      await deleteDoc(doc(firestore, 'hosts', hostId, 'registers', register.$id))
    },
    [confirm, firestore, hostId],
  )

  const locationName = (id: string) =>
    locations.find((location: any) => location.$id === id)?.name

  return (
    <CardDisplay header={'POS registers'} contentGutterX contentGutterY>
      <Stack spacing={1}>
        {registers.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'Name each till or device that takes in-person payments. Every ' +
              'POS sale is tagged with its register for end-of-day takings.'}
          </Typography>
        ) : (
          registers.map((register: any) => {
            const overCap = !withinCap.has(register.$id)
            return (
              <Stack
                key={register.$id}
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', opacity: overCap ? 0.6 : 1 }}
              >
                <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                  {register.name}
                  {register.locationId && locationName(register.locationId) ? (
                    <Typography component="span" variant="caption" color="text.secondary">
                      {` · ${locationName(register.locationId)}`}
                    </Typography>
                  ) : null}
                </Typography>
                {overCap ? (
                  <Chip
                    label="Over plan limit"
                    size="small"
                    color="warning"
                    variant="outlined"
                  />
                ) : null}
                <Button size="small" color="error" onClick={handleDelete(register)}>
                  {'Remove'}
                </Button>
              </Stack>
            )
          })
        )}
        <Stack direction="row" spacing={1}>
          <TextField
            label="New register"
            value={name}
            onChange={(event) => setName(event.target.value)}
            size="small"
            sx={{ flex: 1 }}
            placeholder="Front counter"
          />
          {locations.length > 1 ? (
            <TextField
              select
              label="Location"
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
              size="small"
              sx={{ minWidth: 140 }}
            >
              <MenuItem value="">{'Any'}</MenuItem>
              {locations.map((location: any) => (
                <MenuItem key={location.$id} value={location.$id}>
                  {location.name}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
          <Button size="small" disabled={!name.trim()} onClick={handleAdd}>
            {'Add'}
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {`${registers.length}/${
            quota.limit === Aglyn.UNLIMITED ? '∞' : quota.limit
          } registers on your plan`}
        </Typography>
      </Stack>
    </CardDisplay>
  )
}
RegistersCard.displayName = 'RegistersCard'

export default RegistersCard
