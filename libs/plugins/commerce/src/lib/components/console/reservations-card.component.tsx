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
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  collection,
  deleteDoc,
  doc,
  limit,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { useFirestoreCollection } from '@aglyn/tenant-feature-instance'

export interface ReservationsCardProps {
  hostId: string
}

const STATUS_COLOR: Record<
  string,
  'default' | 'success' | 'warning' | 'error' | 'info'
> = {
  pending: 'warning',
  confirmed: 'info',
  checked_in: 'success',
  checked_out: 'default',
  cancelled: 'default',
  no_show: 'error',
}

const usd = (cents: number | undefined) =>
  `$${((cents ?? 0) / 100).toFixed(2)}`
const day = (dayMs: number | undefined) =>
  dayMs ? new Date(dayMs).toISOString().slice(0, 10) : '—'

/**
 * Reservations console (AGL-311): resources CRUD (nightly pricing,
 * seasons via multipliers, deposits) plus the reservations list with
 * check-in/out, no-show, cancel, and walk-in creation. The storefront
 * widget books against the same docs.
 */
export function ReservationsCard(props: ReservationsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { data: resourceDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'resources'), limit(50)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: reservationDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'reservations'),
        limit(300),
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const resourceNames = useMemo(() => {
    const map: Record<string, string> = {}
    for (const resource of resourceDocs ?? []) {
      map[resource.$id] = resource.name
    }
    return map
  }, [resourceDocs])
  const reservations = useMemo(
    () =>
      [...(reservationDocs ?? [])].sort(
        (a: any, b: any) => (a.checkInDayMs ?? 0) - (b.checkInDayMs ?? 0),
      ),
    [reservationDocs],
  )

  const [resourceDraft, setResourceDraft] = useState<
    (Partial<Aglyn.HostResource> & { id: string | null }) | null
  >(null)
  const [walkIn, setWalkIn] = useState<{
    resourceId: string
    checkIn: string
    checkOut: string
    guestName: string
  } | null>(null)

  const handleResourceSave = useCallback(async () => {
    if (!resourceDraft?.name?.trim() || !(resourceDraft.nightlyRateUsd! > 0)) {
      return
    }
    const { id, ...data } = resourceDraft
    await setDoc(
      doc(
        firestore,
        'hosts',
        hostId,
        'resources',
        id ?? Aglyn.createResourceUid(),
      ),
      {
        ...data,
        name: resourceDraft.name!.trim().slice(0, 120),
      },
      { merge: true },
    )
    setResourceDraft(null)
    enqueueSnackbar('Resource saved', { variant: 'success', persist: false })
  }, [resourceDraft, firestore, hostId, enqueueSnackbar])

  const handleStatus = useCallback(
    (reservation: any, status: Aglyn.ReservationStatus) => async () => {
      await updateDoc(
        doc(firestore, 'hosts', hostId, 'reservations', reservation.$id),
        { status },
      )
    },
    [firestore, hostId],
  )

  const handleWalkIn = useCallback(async () => {
    if (!walkIn?.resourceId || !walkIn.checkIn || !walkIn.checkOut) return
    const resource = (resourceDocs ?? []).find(
      (item: any) => item.$id === walkIn.resourceId,
    ) as Aglyn.HostResource | undefined
    if (!resource) return
    const checkInDayMs = Date.parse(`${walkIn.checkIn}T00:00:00Z`)
    const checkOutDayMs = Date.parse(`${walkIn.checkOut}T00:00:00Z`)
    const existing = reservations
      .filter((item: any) => item.resourceId === walkIn.resourceId)
      .map((item: any) => ({
        checkInDayMs: item.checkInDayMs,
        checkOutDayMs: item.checkOutDayMs,
        status: item.status,
      }))
    if (
      !Aglyn.isRangeAvailable(resource, existing, checkInDayMs, checkOutDayMs)
    ) {
      return void enqueueSnackbar('Those dates are taken', {
        variant: 'warning',
        persist: false,
      })
    }
    const quote = Aglyn.computeReservationQuote(
      resource,
      checkInDayMs,
      checkOutDayMs,
    )
    await setDoc(
      doc(
        firestore,
        'hosts',
        hostId,
        'reservations',
        Aglyn.createResourceUid(),
      ),
      {
        resourceId: walkIn.resourceId,
        status: 'confirmed',
        checkInDayMs,
        checkOutDayMs,
        guestName: walkIn.guestName || null,
        guestEmail: null,
        nights: quote.nights,
        totalCents: quote.totalCents,
        depositCents: 0,
        paidCents: 0,
        createdAtMs: Date.now(),
      } satisfies Aglyn.HostReservation,
    )
    setWalkIn(null)
    enqueueSnackbar('Walk-in reserved — collect payment at POS', {
      variant: 'success',
      persist: false,
    })
  }, [walkIn, resourceDocs, reservations, firestore, hostId, enqueueSnackbar])

  return (
    <CardDisplay header={'Reservations'} contentGutterX contentGutterY>
      <Stack spacing={1}>
        <Typography variant="subtitle2">{'Resources'}</Typography>
        {(resourceDocs ?? []).map((resource: any) => (
          <Stack
            key={resource.$id}
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center' }}
          >
            <Stack sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {`${resource.name} · $${resource.nightlyRateUsd}/night`}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {`id: ${resource.$id}`}
              </Typography>
            </Stack>
            <Button
              size="small"
              onClick={() => setResourceDraft({ id: resource.$id, ...resource })}
            >
              {'Edit'}
            </Button>
            <Button
              size="small"
              color="error"
              onClick={async () => {
                const confirmed = await confirm({
                  title: 'Remove this resource?',
                  description:
                    'Existing reservations keep their records; the widget ' +
                    'stops accepting new stays.',
                  confirmationText: 'Remove',
                  confirmationButtonProps: { color: 'error' },
                })
                  .then(() => true)
                  .catch(() => false)
                if (!confirmed) return
                await deleteDoc(
                  doc(firestore, 'hosts', hostId, 'resources', resource.$id),
                )
              }}
            >
              {'Remove'}
            </Button>
          </Stack>
        ))}
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            onClick={() =>
              setResourceDraft({
                id: null,
                name: '',
                nightlyRateUsd: 100,
                depositPct: 30,
                minNights: 1,
              })
            }
          >
            {'Add resource'}
          </Button>
          <Button
            size="small"
            disabled={(resourceDocs?.length ?? 0) === 0}
            onClick={() =>
              setWalkIn({
                resourceId: resourceDocs?.[0]?.$id ?? '',
                checkIn: '',
                checkOut: '',
                guestName: '',
              })
            }
          >
            {'Walk-in'}
          </Button>
        </Stack>

        <Typography variant="subtitle2" sx={{ mt: 1 }}>
          {'Upcoming & recent stays'}
        </Typography>
        {reservations.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'Reservations from the widget (and walk-ins) appear here.'}
          </Typography>
        ) : (
          reservations.slice(0, 20).map((reservation: any) => (
            <Stack
              key={reservation.$id}
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center' }}
            >
              <Stack sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {`${resourceNames[reservation.resourceId] ?? '?'} · ` +
                    `${day(reservation.checkInDayMs)} → ${day(reservation.checkOutDayMs)}`}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {[
                    reservation.guestName ?? reservation.guestEmail ?? 'Guest',
                    `${usd(reservation.paidCents)} / ${usd(reservation.totalCents)} paid`,
                  ].join(' · ')}
                </Typography>
              </Stack>
              <Chip
                label={String(reservation.status).replace('_', ' ')}
                size="small"
                variant="outlined"
                color={STATUS_COLOR[reservation.status] ?? 'default'}
              />
              {reservation.status === 'confirmed' ? (
                <>
                  <Button size="small" onClick={handleStatus(reservation, 'checked_in')}>
                    {'Check in'}
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    onClick={handleStatus(reservation, 'no_show')}
                  >
                    {'No-show'}
                  </Button>
                </>
              ) : null}
              {reservation.status === 'checked_in' ? (
                <Button
                  size="small"
                  onClick={async () => {
                    // Folio settlement (AGL-317): surface unpaid room
                    // charges before the guest leaves.
                    const folio = (reservation.folio ?? []) as Array<{
                      amountCents: number
                    }>
                    const folioCents = folio.reduce(
                      (sum, entry) => sum + (entry.amountCents ?? 0),
                      0,
                    )
                    const balanceCents =
                      (reservation.totalCents ?? 0) -
                      (reservation.paidCents ?? 0)
                    if (folioCents > 0 || balanceCents > 0) {
                      const confirmed = await confirm({
                        title: 'Check out with open balance?',
                        description:
                          `${folioCents > 0 ? `Room charges: ${usd(folioCents)} (already recorded as paid POS orders). ` : ''}` +
                          `${balanceCents > 0 ? `Stay balance due: ${usd(balanceCents)} — collect at the register.` : ''}`,
                        confirmationText: 'Check out',
                      })
                        .then(() => true)
                        .catch(() => false)
                      if (!confirmed) return
                    }
                    await handleStatus(reservation, 'checked_out')()
                  }}
                >
                  {'Check out'}
                </Button>
              ) : null}
              {['pending', 'confirmed'].includes(reservation.status) ? (
                <Button
                  size="small"
                  color="error"
                  onClick={handleStatus(reservation, 'cancelled')}
                >
                  {'Cancel'}
                </Button>
              ) : null}
            </Stack>
          ))
        )}
      </Stack>

      <Dialog
        open={Boolean(resourceDraft)}
        onClose={() => setResourceDraft(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {resourceDraft?.id ? 'Edit resource' : 'New resource'}
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Name"
            value={resourceDraft?.name ?? ''}
            onChange={(event) =>
              setResourceDraft((prev) =>
                prev ? { ...prev, name: event.target.value } : prev,
              )
            }
            size="small"
            autoFocus
            sx={{ mt: 1 }}
            placeholder="Lakeside cabin"
          />
          <Stack direction="row" spacing={1}>
            <TextField
              label="Nightly rate ($)"
              value={resourceDraft?.nightlyRateUsd ?? ''}
              onChange={(event) =>
                setResourceDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        nightlyRateUsd: Number(event.target.value) || 0,
                      }
                    : prev,
                )
              }
              size="small"
              slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            />
            <TextField
              label="Weekend ×"
              placeholder="1"
              value={resourceDraft?.weekendMultiplier ?? ''}
              onChange={(event) =>
                setResourceDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        weekendMultiplier:
                          Number(event.target.value) || undefined,
                      }
                    : prev,
                )
              }
              size="small"
              slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            />
          </Stack>
          <Stack direction="row" spacing={1}>
            <TextField
              label="Min nights"
              value={resourceDraft?.minNights ?? ''}
              onChange={(event) =>
                setResourceDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        minNights:
                          Math.round(Number(event.target.value)) || undefined,
                      }
                    : prev,
                )
              }
              size="small"
              slotProps={{ htmlInput: { inputMode: 'numeric' } }}
            />
            <TextField
              label="Deposit %"
              placeholder="100 = pay in full"
              value={resourceDraft?.depositPct ?? ''}
              onChange={(event) =>
                setResourceDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        depositPct:
                          Math.round(Number(event.target.value)) || undefined,
                      }
                    : prev,
                )
              }
              size="small"
              slotProps={{ htmlInput: { inputMode: 'numeric' } }}
            />
            <TextField
              label="Free cancel (hrs)"
              value={resourceDraft?.cancellationHours ?? ''}
              onChange={(event) =>
                setResourceDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        cancellationHours:
                          Math.round(Number(event.target.value)) || undefined,
                      }
                    : prev,
                )
              }
              size="small"
              slotProps={{ htmlInput: { inputMode: 'numeric' } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResourceDraft(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={
              !resourceDraft?.name?.trim() ||
              !((resourceDraft?.nightlyRateUsd ?? 0) > 0)
            }
            onClick={handleResourceSave}
          >
            {'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(walkIn)}
        onClose={() => setWalkIn(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'Walk-in reservation'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Resource"
            value={walkIn?.resourceId ?? ''}
            onChange={(event) =>
              setWalkIn((prev) =>
                prev ? { ...prev, resourceId: event.target.value } : prev,
              )
            }
            size="small"
            select
            sx={{ mt: 1 }}
          >
            {(resourceDocs ?? []).map((resource: any) => (
              <MenuItem key={resource.$id} value={resource.$id}>
                {resource.name}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction="row" spacing={1}>
            <TextField
              label="Check-in"
              type="date"
              value={walkIn?.checkIn ?? ''}
              onChange={(event) =>
                setWalkIn((prev) =>
                  prev ? { ...prev, checkIn: event.target.value } : prev,
                )
              }
              size="small"
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label="Check-out"
              type="date"
              value={walkIn?.checkOut ?? ''}
              onChange={(event) =>
                setWalkIn((prev) =>
                  prev ? { ...prev, checkOut: event.target.value } : prev,
                )
              }
              size="small"
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Stack>
          <TextField
            label="Guest name"
            value={walkIn?.guestName ?? ''}
            onChange={(event) =>
              setWalkIn((prev) =>
                prev ? { ...prev, guestName: event.target.value } : prev,
              )
            }
            size="small"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setWalkIn(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={!walkIn?.resourceId || !walkIn?.checkIn || !walkIn?.checkOut}
            onClick={handleWalkIn}
          >
            {'Reserve'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
ReservationsCard.displayName = 'ReservationsCard'

export default ReservationsCard
