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
import {
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  limit,
  query,
} from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
  useHostResourceApi,
  useOrgPlan,
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
  const { org, ready: planReady } = useOrgPlan(hostId)
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
  /**
   * The register HEAD-COUNT is a server aggregate, not the length of the
   * capped listener (AGL-1738, the ninth instance of AGL-1716's AGL-1706
   * shape — filed as latent, made real when the clamp was declined).
   *
   * The listener is `limit(25)` and the stock `posRegisters` bands top out
   * at agency's 20 — under the window — but the $89/mo register add-on is
   * sold flat up to `POS_REGISTERS_ADDON_MAX` (50) on any plan carrying
   * `pos`, so an agency org's effective limit reaches 70. From the 26th
   * register the listener saturates and the card understated usage in the
   * flattering direction while `api/hosts/resources`, which counts the
   * collection, refused the add.
   *
   * Re-read after an add AND a delete: registers are hard-deleted here
   * (like locations, unlike the soft-deleting cards), so a removal really
   * does free a slot on both sides, and a one-shot that missed it would
   * keep refusing.
   */
  const [registerCountEpoch, setRegisterCountEpoch] = useState(0)
  const [serverRegisterCount, setServerRegisterCount] = useState<number | null>(
    null,
  )
  useEffect(() => {
    let active = true
    void getCountFromServer(collection(firestore, 'hosts', hostId, 'registers'))
      .then((snapshot) => {
        if (active) setServerRegisterCount(snapshot.data().count)
      })
      .catch(() => {
        // Falls back to the loaded rows — a LOWER bound and the prior
        // behaviour, never 0, which reads as "no registers used" on a site
        // that is over its cap.
      })
    return () => {
      active = false
    }
  }, [firestore, hostId, registerCountEpoch])
  const registerCount = serverRegisterCount ?? registers.length
  const quota = Aglyn.checkQuota(org, 'posRegisters', registerCount)
  // Registers beyond the plan cap (e.g. after a downgrade) can't transact —
  // pos-order.ts blocks them by creation rank (AGL-482); mirror that here.
  //
  // Only once the org doc has arrived (AGL-1064). An absent org resolves to
  // the free tier's `posRegisters: 0`, which would badge EVERY register
  // "Over plan limit" for the first render or two of every mount.
  const withinCap = planReady
    ? CommerceModel.registersWithinCap(registers, quota.limit)
    : new Set<string>(registers.map((register: any) => register.$id))
  const [name, setName] = useState('')
  const [locationId, setLocationId] = useState('')

  const handleAdd = useCallback(async () => {
    if (!name.trim()) return
    // The button is disabled until the plan is known; this guards the case
    // where a click and the org doc race (AGL-1064).
    if (!planReady) return
    if (!quota.allowed) {
      return void enqueueSnackbar(
        quota.limit === 0
          ? 'POS registers require the Pro plan or above — see Billing'
          : `Your plan includes ${quota.limit} register${
              quota.limit === 1 ? '' : 's'
            } — add more from Billing → Add-ons ($89/mo each)`,
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
      setRegisterCountEpoch((epoch) => epoch + 1)
    } catch (error: any) {
      enqueueSnackbar(error?.message ?? 'Could not add register', {
        variant: 'warning',
        persist: false,
      })
    }
  }, [
    name,
    locationId,
    planReady,
    quota,
    hostId,
    createHostResource,
    enqueueSnackbar,
  ])

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
      // A HARD delete, so the slot really is freed on both sides — the
      // one-shot aggregate has to be told (AGL-1716/AGL-1738).
      setRegisterCountEpoch((epoch) => epoch + 1)
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
          <Button
            size="small"
            disabled={!name.trim() || !planReady}
            onClick={handleAdd}
          >
            {'Add'}
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {/* The site's registers, not this card's rows (AGL-1738) — the
              readout and the gate must agree, and the gate now counts. */}
          {planReady
            ? `${registerCount}/${
                quota.limit === Aglyn.UNLIMITED ? '∞' : quota.limit
              } registers on your plan`
            : `${registerCount} register${
                registerCount === 1 ? '' : 's'
              } · checking your plan…`}
        </Typography>
      </Stack>
    </CardDisplay>
  )
}
RegistersCard.displayName = 'RegistersCard'

export default RegistersCard
