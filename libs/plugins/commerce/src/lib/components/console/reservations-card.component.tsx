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
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
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
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { useFirestore, useMerchantPayments, useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { PrerequisiteNotice } from '@aglyn/shared-ui-jsx/components/prerequisite-notice.component'
import {
  useFirestoreCollection,
  usePagedCollection,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import { pluginDocsHelp } from '@aglyn/aglyn'

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
const nightLabel = (dayMs: number) =>
  new Date(dayMs).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })

/** The Reservations card's look-ahead for a several-unit resource. */
const UNITS_LOOKAHEAD_NIGHTS = 14

/** The desk's calendar day as the UTC-midnight `dayMs` stays are stored in. */
function localTodayDayMs(): number {
  const now = new Date()
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
}

/** The units field's problem, or null when the typed value is a valid count. */
function unitsProblem(units: number | undefined): string | null {
  if (units === undefined) return null
  if (
    !Number.isInteger(units) ||
    units < 1 ||
    units > CommerceModel.MAX_RESOURCE_UNITS
  ) {
    return `A whole number from 1 to ${CommerceModel.MAX_RESOURCE_UNITS}`
  }
  return null
}

/**
 * Reservations console (AGL-311): resources CRUD (nightly pricing,
 * seasons via multipliers, deposits) plus the reservations list with
 * check-in/out, no-show, cancel, and walk-in creation. The storefront
 * widget books against the same docs.
 */
export function ReservationsCard(props: ReservationsCardProps) {
  const { hostId } = props
  // Every reservation is paid when it is booked, so a store that cannot
  // charge turns each guest away; the card says so up front.
  const payments = useMerchantPayments(hostId)
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const {
    data: resourceDocs,
    status: resourcesStatus,
    /**
     * The rows this editor is seeded from are unconfirmed by the server
     * (AGL-1358). Editing spreads a whole stored resource into
     * `resourceDraft` and writes all of it back, so `merge: true` protects
     * nothing. `blocks` is the field that costs more than money: it is the
     * manually blocked date ranges `isRangeAvailable` reads, so a cached seed
     * re-opens dates that were closed and lets the next guest book a room
     * that is already spoken for.
     */
    fromCache: resourcesFromCache,
  } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'resources'), limit(50)),
    [firestore, hostId],
    { idField: '$id' },
  )
  /*
   * Ordered by the server, and a growing window rather than a fixed 300.
   *
   * `limit(300)` carried no `orderBy`, so Firestore returned DOCUMENT-ID
   * order and the client sort below arranged that pseudo-random sample by
   * check-in. The ordering is unchanged — earliest check-in first, exactly
   * what the sort did — it is now the QUERY's, so the window is the real
   * front of the list and the rest can be reached.
   */
  const {
    rows: reservations,
    hasMore,
    page,
    setPage,
    pageSize,
    setPageSize,
  } = usePagedCollection<any>(
    (pageLimit) =>
      query(
        collection(firestore, 'hosts', hostId, 'reservations'),
        orderBy('checkInDayMs', 'asc'),
        limit(pageLimit),
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  /*
   * Units left on each of the next nights, for resources with several units
   * (AGL-4044). One listen across the site's resources, on the stays that
   * have not ended, nearest check-out first: a range and an order on the same
   * field, which Firestore's automatic single-field index serves. Not read at
   * all while every resource has one unit, so a cabin-only site pays nothing.
   *
   * The 500 cap is the booking door's: it can only leave out stays that end
   * after 500 others that are all still running, which would be a stay far
   * past the two weeks this draws.
   */
  const hasSeveralUnits = (resourceDocs ?? []).some(
    (resource: any) => CommerceModel.resourceUnits(resource) > 1,
  )
  const todayDayMs = localTodayDayMs()
  const { data: currentStays } = useFirestoreCollection<any>(
    () =>
      hasSeveralUnits
        ? query(
            collection(firestore, 'hosts', hostId, 'reservations'),
            where('checkOutDayMs', '>', todayDayMs),
            orderBy('checkOutDayMs'),
            limit(500),
          )
        : null,
    [firestore, hostId, hasSeveralUnits, todayDayMs],
    { idField: '$id' },
  )
  const unitsAhead = useMemo(() => {
    const byResource: Record<string, CommerceModel.ResourceNightUnits[]> = {}
    if (!hasSeveralUnits) return byResource
    const nowMs = Date.now()
    for (const resource of resourceDocs ?? []) {
      if (CommerceModel.resourceUnits(resource) === 1) continue
      const stays = (currentStays ?? [])
        .filter((stay: any) => stay.resourceId === resource.$id)
        .map((stay: any) => ({
          checkInDayMs: Number(stay.checkInDayMs),
          checkOutDayMs: Number(stay.checkOutDayMs),
          status: stay.status as CommerceModel.ReservationStatus,
          createdAtMs: Number(stay.createdAtMs ?? 0),
        }))
      byResource[resource.$id] = CommerceModel.unitsLeftByNight(
        resource,
        stays,
        todayDayMs,
        UNITS_LOOKAHEAD_NIGHTS,
        nowMs,
      )
    }
    return byResource
  }, [hasSeveralUnits, resourceDocs, currentStays, todayDayMs])

  const resourceNames = useMemo(() => {
    const map: Record<string, string> = {}
    for (const resource of resourceDocs ?? []) {
      map[resource.$id] = resource.name
    }
    return map
  }, [resourceDocs])

  const [resourceDraft, setResourceDraft] = useState<
    (Partial<CommerceModel.HostResource> & { id: string | null }) | null
  >(null)
  const [walkIn, setWalkIn] = useState<{
    resourceId: string
    checkIn: string
    checkOut: string
    guestName: string
    /** One walk-in attempt: a retry of it finds its own stay (AGL-4046). */
    attemptId: string
  } | null>(null)
  const [walkInBusy, setWalkInBusy] = useState(false)

  const handleResourceSave = useCallback(async () => {
    if (!resourceDraft?.name?.trim() || !(resourceDraft.nightlyRateUsd! > 0)) {
      return
    }
    /**
     * `$id` comes off with `id` (AGL-1374).
     *
     * The editor is seeded `{ id: resource.$id, ...resource }`, and that
     * spread carries the listener's SYNTHETIC `$id` — `idField: '$id'`
     * stamps the document id onto the in-memory row, where nothing persists
     * it. Destructuring only `id` left `$id` in `data`, so every save wrote
     * it into the stored document as a real field. Nothing reads it; it is
     * the listener's bookkeeping leaking into storage, and once there no
     * reader can tell it from a field the card meant to write.
     */
    if (unitsProblem(resourceDraft.units)) return
    const seeded = resourceDraft as typeof resourceDraft & { $id?: string }
    const { id, $id: _syntheticId, units, ...fields } = seeded
    // Units are written as the count the model reads (AGL-4044), and a
    // cleared field as 1 rather than left out: `merge: true` would otherwise
    // keep a stored 12 the merchant just removed.
    const data = 'units' in seeded
      ? { ...fields, units: CommerceModel.resourceUnits({ units }) }
      : fields
    /**
     * Refuse an EDIT whose seed the server never confirmed (AGL-1358).
     * `data` is the whole stored row spread out of the listener, so
     * `merge: true` has nothing left to protect — every field is present,
     * `blocks` and the seasonal multipliers included.
     *
     * Only the edit path. A NEW resource is built from defaults at a fresh
     * uid and can overwrite nothing, and the first snapshot of any listener
     * is `fromCache: true`, so guarding a create would refuse a save that was
     * never unsafe.
     *
     * The guard WRAPS the write — an early return is a shape you can keep
     * while losing the protection.
     */
    const verdict = await writeGuardedBySeed(
      {
        subject: 'resource',
        unreadable: Boolean(id) && resourcesStatus === 'error',
        fromCache: Boolean(id) && resourcesFromCache,
      },
      async () => {
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
      },
    )
    // Before `setResourceDraft(null)`, so a refusal keeps the dialog open
    // with what was typed.
    if (!verdict.ok) {
      return void enqueueSnackbar(verdict.message, {
        variant: 'warning',
        persist: false,
      })
    }
    setResourceDraft(null)
    enqueueSnackbar('Resource saved', { variant: 'success', persist: false })
  }, [
    resourceDraft,
    firestore,
    hostId,
    enqueueSnackbar,
    resourcesStatus,
    resourcesFromCache,
  ])

  const handleStatus = useCallback(
    (reservation: any, status: CommerceModel.ReservationStatus) => async () => {
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
    ) as CommerceModel.HostResource | undefined
    if (!resource) return
    const checkInDayMs = Date.parse(`${walkIn.checkIn}T00:00:00Z`)
    const checkOutDayMs = Date.parse(`${walkIn.checkOut}T00:00:00Z`)
    /*
     * The stay is priced FIRST, and its `problem` stops the walk-in: the quote
     * is the one rule for what can be booked (no nights, under the minimum
     * stay), shared with the booking widget and both native apps. Ignoring it
     * wrote a confirmed zero-night, $0 stay for a check-out on the arrival
     * day (AGL-3794).
     */
    const quote = CommerceModel.computeReservationQuote(
      resource,
      checkInDayMs,
      checkOutDayMs,
    )
    if (quote.problem) {
      return void enqueueSnackbar(quote.problem, {
        variant: 'warning',
        persist: false,
      })
    }
    /*
     * Every stay of THIS resource that ends after the walk-in arrives — the
     * same query `reserve.ts` checks a booking against, on the composite it
     * already has (AGL-3321). This used to test the rows on the card's
     * current page, so a stay on the next page did not block the dates and
     * the desk could double-book the room.
     */
    const overlapping = await getDocs(
      query(
        collection(firestore, 'hosts', hostId, 'reservations'),
        where('resourceId', '==', walkIn.resourceId),
        where('checkOutDayMs', '>', checkInDayMs),
        orderBy('checkOutDayMs'),
        limit(500),
      ),
    ).catch(() => null)
    if (!overlapping) {
      return void enqueueSnackbar('Could not check those dates — try again', {
        variant: 'warning',
        persist: false,
      })
    }
    // `createdAtMs` carried through because the pending hold lapses on it
    // (`reservationHoldsDates`). Dropping it made every unpaid `pending` row
    // block forever, so the front desk was refused a walk-in into a room that
    // an abandoned online checkout had left empty.
    const existing = overlapping.docs
      .map((snapshot) => snapshot.data() as any)
      .map((item: any) => ({
        checkInDayMs: item.checkInDayMs,
        checkOutDayMs: item.checkOutDayMs,
        status: item.status,
        createdAtMs: item.createdAtMs,
      }))
    // Count-based for a several-unit resource (AGL-4044): the walk-in takes
    // any unit that is free on every night, and is refused only when some
    // night has none left.
    if (
      !CommerceModel.isRangeAvailable(resource, existing, checkInDayMs, checkOutDayMs)
    ) {
      const message =
        CommerceModel.resourceUnits(resource) > 1
          ? 'Every unit is taken on at least one of those nights'
          : 'Those dates are taken'
      return void enqueueSnackbar(message, {
        variant: 'warning',
        persist: false,
      })
    }
    /*
     * The check above is the instant answer; the WRITE goes through
     * `/api/commerce/reservations/walk-in` (AGL-4046), which re-asks the same
     * question inside the transaction that books the stay. A client
     * read-then-write let two staff on two devices both take the last unit.
     */
    setWalkInBusy(true)
    try {
      const response = await authorizedFetch(
        user,
        '/api/commerce/reservations/walk-in',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hostId,
            resourceId: walkIn.resourceId,
            checkInDayMs,
            checkOutDayMs,
            guestName: walkIn.guestName || undefined,
            reservationId: walkIn.attemptId,
          }),
        },
      )
      const answer = await response.json().catch(() => ({}))
      if (!response.ok) {
        return void enqueueSnackbar(
          answer?.error ?? 'Could not reserve the walk-in — try again',
          {
            variant: response.status === 409 || response.status === 400
              ? 'warning'
              : 'error',
            persist: false,
          },
        )
      }
    } catch {
      return void enqueueSnackbar('Could not reserve the walk-in — try again', {
        variant: 'error',
        persist: false,
      })
    } finally {
      setWalkInBusy(false)
    }
    setWalkIn(null)
    enqueueSnackbar('Walk-in reserved — collect payment at POS', {
      variant: 'success',
      persist: false,
    })
  }, [walkIn, resourceDocs, firestore, hostId, user, enqueueSnackbar])

  return (
    <CardDisplay
      header={'Reservations'}
      help={pluginDocsHelp('pos', { anchor: '#reservations' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1}>
        {payments.blocked ? (
          <PrerequisiteNotice severity="warning" href={payments.href ?? undefined} actionLabel="Open Payments">
            {`${payments.reason ?? ''} Guests pay when they reserve, so they can't reserve until it is set up.`}
          </PrerequisiteNotice>
        ) : null}
        <Typography variant="subtitle2">{'Resources'}</Typography>
        {(resourceDocs ?? []).map((resource: any) => (
          <Stack key={resource.$id} spacing={0.5}>
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center' }}
            >
              <Stack sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {[
                    resource.name,
                    `$${resource.nightlyRateUsd}/night`,
                    ...(CommerceModel.resourceUnits(resource) > 1
                      ? [`${CommerceModel.resourceUnits(resource)} units`]
                      : []),
                  ].join(' · ')}
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
            {unitsAhead[resource.$id] ? (
              <Stack
                direction="row"
                useFlexGap
                aria-label={`Units left on the next ${UNITS_LOOKAHEAD_NIGHTS} nights`}
                sx={{ flexWrap: 'wrap', gap: 0.5 }}
              >
                {unitsAhead[resource.$id].map((night) => (
                  <Chip
                    key={night.dayMs}
                    size="small"
                    variant="outlined"
                    color={
                      night.unitsLeft === 0
                        ? 'error'
                        : night.unitsLeft <= CommerceModel.FEW_UNITS_LEFT
                          ? 'warning'
                          : 'default'
                    }
                    label={`${nightLabel(night.dayMs)} · ${night.unitsLeft} of ${night.units} left`}
                  />
                ))}
              </Stack>
            ) : null}
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
                attemptId: Aglyn.createResourceUid(),
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
          reservations.map((reservation: any) => (
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
        <ListPagination
          page={page}
          pageSize={pageSize}
          rowCount={reservations.length}
          hasMore={hasMore}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
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
              label="Spots or units available"
              placeholder="1"
              value={resourceDraft?.units ?? ''}
              onChange={(event) =>
                setResourceDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        units:
                          event.target.value.replace(/\D/g, '') === ''
                            ? undefined
                            : Number(event.target.value.replace(/\D/g, '')),
                      }
                    : prev,
                )
              }
              error={Boolean(unitsProblem(resourceDraft?.units))}
              helperText={
                unitsProblem(resourceDraft?.units) ??
                'How many identical ones you have, like 12 RV hookups'
              }
              size="small"
              fullWidth
              slotProps={{ htmlInput: { inputMode: 'numeric' } }}
            />
            <TextField
              label="Sleeps"
              value={resourceDraft?.capacity ?? ''}
              onChange={(event) =>
                setResourceDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        capacity:
                          Math.round(Number(event.target.value)) || undefined,
                      }
                    : prev,
                )
              }
              helperText="Guests per unit, for display"
              size="small"
              fullWidth
              slotProps={{ htmlInput: { inputMode: 'numeric' } }}
            />
          </Stack>
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
            color="primary"
            disabled={
              !resourceDraft?.name?.trim() ||
              !((resourceDraft?.nightlyRateUsd ?? 0) > 0) ||
              Boolean(unitsProblem(resourceDraft?.units))
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
            color="primary"
            disabled={
              walkInBusy ||
              !walkIn?.resourceId ||
              !walkIn?.checkIn ||
              !walkIn?.checkOut
            }
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
