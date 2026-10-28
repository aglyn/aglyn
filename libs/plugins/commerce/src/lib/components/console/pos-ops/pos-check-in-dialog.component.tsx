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

import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useUser } from '@aglyn/tenant-feature-instance'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { zonedDayKey } from '@aglyn/shared-util-timestamp/zoned-time'
import {
  alreadyCheckedInLabel,
  checkInItemLabel,
  checkInRainCheckIsOpen,
  checkInTimeLabel,
  CHECK_IN_WRISTBAND_COLORS,
  CHECK_IN_WRISTBAND_MAX,
  describeWristband,
  rainCheckLabel,
  type CheckInCustomer,
  type CheckInRow,
} from '../../../model/commerce-check-in'
import { POS_TOUCH_PX } from '../pos/pos-product-grid.component'
import { callPosOps, newPosAttemptKey } from './pos-ops-api'
import { PosCheckInZone } from './pos-check-in-zone.component'
import { PosRainCheckDialog } from './pos-rain-check-dialog.component'

/** A stay's guest count (AGL-4043), loaded the first time it opens. */
const ReservationGuestsDialog = lazy(() => import('../reservation-guests-dialog.component'))

/** How long typing pauses before the register asks. */
const SEARCH_DEBOUNCE_MS = 250

/** The customer to open on, as the register's customer panel names them. */
export interface PosCheckInTarget {
  customerKey?: string
  email?: string | null
  contactId?: string | null
}

export interface PosCheckInDialogProps {
  open: boolean
  hostId: string
  /** The register the dialog was opened at, so a PIN's cashier is who checks people in. */
  registerId?: string
  cashierAssertion?: string
  /** Opens straight on one customer rather than on the search. */
  initialCustomer?: PosCheckInTarget | null
  onClose: () => void
}

type Draft = { number: string; color: string }

/**
 * Check-in at the window (AGL-4043): look the customer up by name, email,
 * phone or order number, see each person their passes, camping and stays
 * cover today, and check each in with an optional wristband number and
 * color. One already checked in says when and by whom, with an undo.
 */
export function PosCheckInDialog(props: PosCheckInDialogProps) {
  const { open, hostId, registerId, cashierAssertion, initialCustomer, onClose } = props
  const { data: user } = useUser()
  const [text, setText] = useState('')
  const [customers, setCustomers] = useState<CheckInCustomer[]>([])
  const [searched, setSearched] = useState(false)
  const [day, setDay] = useState<{ dayKey: string; timeZone: string } | null>(null)
  const [customer, setCustomer] = useState<CheckInCustomer | null>(null)
  const [rows, setRows] = useState<CheckInRow[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  /** The pass a rain check is being given on (AGL-4043). */
  const [rainCheckRow, setRainCheckRow] = useState<CheckInRow | null>(null)
  /** The stay whose guests are being changed (AGL-4043). */
  const [guestsFor, setGuestsFor] = useState<string | null>(null)
  const latest = useRef(0)

  const reset = useCallback(() => {
    setText('')
    setCustomers([])
    setSearched(false)
    setCustomer(null)
    setRows([])
    setDrafts({})
    setError('')
    setNotice('')
  }, [])

  const openCustomer = useCallback(
    async (target: PosCheckInTarget) => {
      if (!user) return
      setBusy(true)
      setError('')
      setNotice('')
      const answer = await callPosOps<{
        dayKey?: string
        timeZone?: string
        customer?: CheckInCustomer | null
        checkIns?: CheckInRow[]
      }>(user, 'pos-check-in', { hostId, action: 'customer', ...target })
      setBusy(false)
      if (!answer.ok) return setError(answer.body.error ?? 'That customer could not be opened.')
      if (answer.body.dayKey) setDay({ dayKey: answer.body.dayKey, timeZone: answer.body.timeZone ?? 'UTC' })
      setCustomer(answer.body.customer ?? null)
      setRows(answer.body.checkIns ?? [])
      setDrafts({})
      if (!answer.body.checkIns?.length) setNotice('Nothing to check in today for this customer.')
    },
    [user, hostId],
  )

  useEffect(() => {
    if (!open) return reset()
    if (initialCustomer && (initialCustomer.customerKey || initialCustomer.email || initialCustomer.contactId)) {
      void openCustomer(initialCustomer)
    }
    // Opening is the trigger; a new target while open is not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    const typed = text.trim()
    if (!open || typed.length < 2 || !user) {
      setCustomers([])
      setSearched(false)
      return
    }
    const ticket = ++latest.current
    const timer = window.setTimeout(() => {
      void callPosOps<{ dayKey?: string; timeZone?: string; customers?: CheckInCustomer[] }>(user, 'pos-check-in', {
        hostId,
        action: 'search',
        text: typed,
      }).then((answer) => {
        if (ticket !== latest.current) return
        if (!answer.ok) return setError(answer.body.error ?? 'The search did not run.')
        setError('')
        if (answer.body.dayKey) setDay({ dayKey: answer.body.dayKey, timeZone: answer.body.timeZone ?? 'UTC' })
        setCustomers(answer.body.customers ?? [])
        setSearched(true)
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [text, user, hostId, open])

  const merge = (changed: CheckInRow[]) => {
    const byId = new Map(changed.map((row) => [row.id, row]))
    setRows((current) => current.map((row) => byId.get(row.id) ?? row))
  }

  const checkIn = async (targets: CheckInRow[]) => {
    if (!targets.length) return
    setBusy(true)
    setError('')
    setNotice('')
    const answer = await callPosOps<{ checkedIn?: CheckInRow[]; alreadyCheckedIn?: CheckInRow[] }>(
      user,
      'pos-check-in',
      {
        hostId,
        action: 'check_in',
        checkIns: targets.map((row) => {
          const draft = drafts[row.id]
          return {
            id: row.id,
            ...(draft && (draft.number.trim() || draft.color)
              ? { wristband: { number: draft.number.trim(), color: draft.color } }
              : {}),
          }
        }),
        // The window's day: an open rain check checked in is used on it.
        ...(day?.dayKey ? { day: day.dayKey } : {}),
        ...(registerId ? { registerId } : {}),
        ...(cashierAssertion ? { cashierAssertion } : {}),
      },
      { idempotencyKey: newPosAttemptKey() },
    )
    setBusy(false)
    if (!answer.ok) return setError(answer.body.error ?? 'They could not be checked in.')
    merge([...(answer.body.checkedIn ?? []), ...(answer.body.alreadyCheckedIn ?? [])])
    const already = answer.body.alreadyCheckedIn ?? []
    if (already.length && day) setNotice(alreadyCheckedInLabel(already[0]!, day.timeZone))
  }

  const undo = async (row: CheckInRow) => {
    setBusy(true)
    setError('')
    setNotice('')
    const answer = await callPosOps<{ checkIn?: CheckInRow }>(user, 'pos-check-in', {
      hostId,
      action: 'undo',
      id: row.id,
      ...(registerId ? { registerId } : {}),
      ...(cashierAssertion ? { cashierAssertion } : {}),
    })
    setBusy(false)
    if (!answer.ok || !answer.body.checkIn) return setError(answer.body.error ?? 'The check-in could not be undone.')
    merge([answer.body.checkIn])
  }

  const undoRainCheck = async (row: CheckInRow) => {
    setBusy(true)
    setError('')
    setNotice('')
    const answer = await callPosOps<{ checkIn?: CheckInRow }>(user, 'pos-check-in', {
      hostId,
      action: 'undo_rain_check',
      id: row.id,
      ...(registerId ? { registerId } : {}),
      ...(cashierAssertion ? { cashierAssertion } : {}),
    })
    setBusy(false)
    if (!answer.ok || !answer.body.checkIn) return setError(answer.body.error ?? 'The rain check could not be undone.')
    merge([answer.body.checkIn])
  }

  const setDraft = (id: string, patch: Partial<Draft>) =>
    setDrafts((current) => ({ ...current, [id]: { number: '', color: '', ...current[id], ...patch } }))

  const dayKey = day?.dayKey ?? ''
  /** A pass a dated rain check moved off the window's day: not to check in today. */
  const movedAway = (row: CheckInRow) => row.status === 'expected' && row.rainCheck?.kind === 'date' && row.dayKey !== dayKey
  // "Check in all" leaves rain checks alone: an open one is used one at a time.
  const waiting = rows.filter((row) => row.status === 'expected' && !movedAway(row) && !checkInRainCheckIsOpen(row))
  const todayKey = day ? zonedDayKey(Date.now(), day.timeZone) : ''

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{customer ? customer.name || customer.email || 'Customer' : 'Check in'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {customer ? (
            <>
              <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                {customer.email ? (
                  <Typography variant="body2" color="text.secondary">
                    {customer.email}
                  </Typography>
                ) : null}
                <Chip
                  size="small"
                  variant="outlined"
                  color={rows.length && !waiting.length ? 'success' : 'default'}
                  label={`${rows.filter((row) => row.status === 'checked_in').length} of ${rows.length} checked in`}
                />
                {dayKey ? (
                  <PosCheckInZone
                    hostId={hostId}
                    orgId={undefined}
                    contactId={customer.contactId}
                    email={customer.email ? customer.email.toLowerCase() : null}
                    dayKey={dayKey}
                    name={customer.name}
                    unitsDue={rows.length}
                    placement="check-in-customer"
                  />
                ) : null}
              </Stack>
              <List disablePadding>
                {rows.map((row, index) => (
                  <Box key={row.id}>
                    {index ? <Divider component="li" /> : null}
                    <ListItem disableGutters sx={{ display: 'block', py: 1.5 }}>
                      <Stack spacing={1}>
                        <ListItemText
                          primary={checkInItemLabel(row)}
                          secondary={[
                            row.status === 'checked_in' && day
                              ? [
                                  `Checked in at ${checkInTimeLabel(row.checkedInAtMs, day.timeZone)}` +
                                    (row.checkedInByName ? ` by ${row.checkedInByName}` : ''),
                                  describeWristband(row.wristband),
                                ]
                                  .filter(Boolean)
                                  .join(' · ')
                              : row.orderLabel ?? (row.source === 'reservation' ? 'Stay' : ''),
                            rainCheckLabel(row),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        />
                        {row.status === 'checked_in' ? (
                          <Box>
                            <Button size="small" onClick={() => void undo(row)} disabled={busy}>
                              {'Undo'}
                            </Button>
                            {row.source === 'reservation' && row.reservationId ? (
                              <Button size="small" onClick={() => setGuestsFor(row.reservationId)} disabled={busy}>
                                {'Guests'}
                              </Button>
                            ) : null}
                          </Box>
                        ) : movedAway(row) ? (
                          <Box>
                            <Button size="small" onClick={() => void undoRainCheck(row)} disabled={busy}>
                              {'Undo rain check'}
                            </Button>
                          </Box>
                        ) : (
                          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                            <TextField
                              size="small"
                              label="Wristband number"
                              value={drafts[row.id]?.number ?? ''}
                              onChange={(event) => setDraft(row.id, { number: event.target.value })}
                              slotProps={{ htmlInput: { maxLength: CHECK_IN_WRISTBAND_MAX } }}
                              sx={{ flex: 1 }}
                            />
                            <TextField
                              select
                              size="small"
                              label="Color"
                              value={drafts[row.id]?.color ?? ''}
                              onChange={(event) => setDraft(row.id, { color: event.target.value })}
                              sx={{ flex: 1 }}
                            >
                              <MenuItem value="">{'None'}</MenuItem>
                              {CHECK_IN_WRISTBAND_COLORS.map((color) => (
                                <MenuItem key={color} value={color}>
                                  {color}
                                </MenuItem>
                              ))}
                            </TextField>
                            <Button
                              variant="contained"
                              onClick={() => void checkIn([row])}
                              disabled={busy}
                              sx={{ minHeight: POS_TOUCH_PX }}
                            >
                              {'Check in'}
                            </Button>
                            {row.source === 'reservation' && row.reservationId ? (
                              <Button onClick={() => setGuestsFor(row.reservationId)} disabled={busy}>
                                {'Guests'}
                              </Button>
                            ) : null}
                            {row.source === 'order' ? (
                              row.rainCheck ? (
                                <Button onClick={() => void undoRainCheck(row)} disabled={busy}>
                                  {'Undo rain check'}
                                </Button>
                              ) : (
                                <Button onClick={() => setRainCheckRow(row)} disabled={busy || !todayKey}>
                                  {'Rain check'}
                                </Button>
                              )
                            ) : null}
                          </Stack>
                        )}
                      </Stack>
                    </ListItem>
                  </Box>
                ))}
              </List>
            </>
          ) : (
            <>
              <TextField
                autoFocus
                label="Find a customer"
                placeholder="Name, email, phone or order number"
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
              {customers.length ? (
                <List dense disablePadding>
                  {customers.map((one) => (
                    <ListItem key={one.customerKey} disablePadding>
                      <ListItemButton onClick={() => void openCustomer({ customerKey: one.customerKey })}>
                        <ListItemText
                          primary={one.name || one.email || 'Customer'}
                          secondary={[
                            `${one.unitsCheckedIn} of ${one.unitsDue} checked in`,
                            one.items.join(', '),
                            one.email,
                            one.phone,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        />
                      </ListItemButton>
                      {dayKey ? (
                        <PosCheckInZone
                          hostId={hostId}
                          orgId={undefined}
                          contactId={one.contactId}
                          email={one.email ? one.email.toLowerCase() : null}
                          dayKey={dayKey}
                          name={one.name}
                          unitsDue={one.unitsDue}
                          placement="check-in-row"
                        />
                      ) : null}
                    </ListItem>
                  ))}
                </List>
              ) : searched ? (
                <Typography variant="body2" color="text.secondary">
                  {'Nobody with that name, email, phone or order number has anything to check in today.'}
                </Typography>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {'Passes, camping and stays bought online or at the register show up here on the day they are for.'}
                </Typography>
              )}
            </>
          )}
          {notice ? <Alert severity="info">{notice}</Alert> : null}
          {error ? <Alert severity="warning">{error}</Alert> : null}
        </Stack>
        <PosRainCheckDialog
          row={rainCheckRow}
          hostId={hostId}
          todayKey={todayKey}
          registerId={registerId}
          cashierAssertion={cashierAssertion}
          onClose={() => setRainCheckRow(null)}
          onDone={(changed) => {
            setRainCheckRow(null)
            merge([changed])
          }}
        />
        {guestsFor ? (
          <Suspense fallback={null}>
            <ReservationGuestsDialog
              reservationId={guestsFor}
              hostId={hostId}
              onClose={() => setGuestsFor(null)}
              onDone={() => {
                setGuestsFor(null)
                // The stay's check-ins may have changed: read the customer again.
                if (customer) void openCustomer({ customerKey: customer.customerKey })
              }}
            />
          </Suspense>
        ) : null}
      </DialogContent>
      <DialogActions>
        {customer ? (
          <Button
            onClick={() => {
              setCustomer(null)
              setRows([])
              setNotice('')
            }}
          >
            {'Back to search'}
          </Button>
        ) : null}
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>{'Done'}</Button>
        {customer && waiting.length > 1 ? (
          <Button variant="contained" disabled={busy} onClick={() => void checkIn(waiting)}>
            {`Check in all ${waiting.length}`}
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  )
}

PosCheckInDialog.displayName = 'PosCheckInDialog'

export default PosCheckInDialog
