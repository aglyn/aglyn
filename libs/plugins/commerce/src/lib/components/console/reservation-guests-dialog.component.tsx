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

import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { doc, getDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import {
  reservationGuests,
  reservationGuestsProblem,
  resourceGuestCeiling,
  RESERVATION_GUESTS_ROUTE,
  type HostReservation,
  type HostResource,
} from '../../model/commerce-reservations'

export interface ReservationGuestsDialogProps {
  /** The stay whose guests change; the dialog is open while it is set. */
  reservationId: string | null
  hostId: string
  onClose: () => void
  /** What the route did: the new count and the check-ins it added and took away. */
  onDone: (answer: { guests: number; added: number; removed: number; unchanged: boolean }) => void
}

interface Loaded {
  guests: number
  ceiling: number | null
  label: string
}

/**
 * How many guests a stay is for, after it is booked (AGL-4043): from the
 * Reservations card and the check-in screens, through
 * `/api/commerce/reservations/guests`. The stay and its resource are read
 * when it opens, for the count and what the resource sleeps; the route is
 * the one that decides, so a read the member cannot make still leaves the
 * field working. When the stay is checked in one guest at a time, the route
 * brings today's check-ins in line and refuses a count below how many are
 * already checked in, in its own words.
 */
export function ReservationGuestsDialog(props: ReservationGuestsDialogProps) {
  const { reservationId, hostId, onClose, onDone } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoaded(null)
    setTyped('')
    setError('')
    if (!reservationId) return
    let live = true
    void (async () => {
      try {
        const stay = await getDoc(doc(firestore, 'hosts', hostId, 'reservations', reservationId))
        const reservation = (stay.data() ?? {}) as Partial<HostReservation>
        const resource = reservation.resourceId
          ? ((await getDoc(doc(firestore, 'hosts', hostId, 'resources', reservation.resourceId))).data() as
              | HostResource
              | undefined)
          : undefined
        if (!live) return
        const guests = reservationGuests(reservation)
        setLoaded({
          guests,
          ceiling: resourceGuestCeiling(resource),
          label: [resource?.name, reservation.guestName ?? reservation.guestEmail].filter(Boolean).join(' · '),
        })
        setTyped(String(guests))
      } catch {
        if (live) setLoaded({ guests: 0, ceiling: null, label: '' })
      }
    })()
    return () => {
      live = false
    }
  }, [firestore, hostId, reservationId])

  const count = typed.trim() ? Number(typed) : NaN
  const problem = !typed.trim()
    ? 'How many guests?'
    : loaded?.ceiling
      ? reservationGuestsProblem(count, { capacity: loaded.ceiling })
      : reservationGuestsProblem(count, null)

  const save = async () => {
    if (!reservationId || problem) return
    setBusy(true)
    setError('')
    try {
      const response = await authorizedFetch(user as never, RESERVATION_GUESTS_ROUTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId, reservationId, guests: count }),
      })
      const answer = (await response.json().catch(() => ({}))) as {
        error?: string
        guests?: number
        unchanged?: boolean
        checkIns?: { added?: number; removed?: number }
      }
      if (!response.ok) {
        setError(answer.error ?? 'The guests could not be changed. Try again.')
        return
      }
      onDone({
        guests: answer.guests ?? count,
        added: answer.checkIns?.added ?? 0,
        removed: answer.checkIns?.removed ?? 0,
        unchanged: answer.unchanged === true,
      })
    } catch {
      setError('The guests could not be changed. Check the connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={Boolean(reservationId)} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{'Guests'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {loaded?.label ? (
            <Typography variant="body2" color="text.secondary">
              {loaded.label}
            </Typography>
          ) : null}
          <TextField
            label="Guests"
            value={typed}
            onChange={(event) => setTyped(event.target.value.replace(/\D/g, ''))}
            error={Boolean(typed) && Boolean(problem)}
            helperText={
              (typed && problem) ||
              (loaded?.ceiling ? `Up to ${loaded.ceiling}, what this stay sleeps` : 'At least 1')
            }
            disabled={!loaded}
            autoFocus
            size="small"
            slotProps={{ htmlInput: { inputMode: 'numeric', 'aria-label': 'Guests' } }}
          />
          <Typography variant="caption" color="text.secondary">
            {'When the stay is checked in one guest at a time, today’s check-ins follow: an added guest gets their own, and a guest already checked in stays.'}
          </Typography>
          {error ? <Alert severity="warning">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{'Cancel'}</Button>
        <Button variant="contained" disabled={busy || !loaded || Boolean(problem)} onClick={() => void save()}>
          {'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

ReservationGuestsDialog.displayName = 'ReservationGuestsDialog'

export default ReservationGuestsDialog
