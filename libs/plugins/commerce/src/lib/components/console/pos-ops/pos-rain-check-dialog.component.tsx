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
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useEffect, useState } from 'react'
import {
  checkInDayLabel,
  checkInItemLabel,
  type CheckInRow,
} from '../../../model/commerce-check-in'
import { UseDayPicker } from '../../use-day-picker'
import { callPosOps } from './pos-ops-api'

export interface PosRainCheckDialogProps {
  /** The pass to rain-check; the dialog is open while it is set. */
  row: CheckInRow | null
  hostId: string
  /** Today on the store's calendar. */
  todayKey: string
  /** The register it is given at, so a PIN's cashier is who gave it. */
  registerId?: string
  cashierAssertion?: string
  onClose: () => void
  /** The pass as the route left it. */
  onDone: (row: CheckInRow) => void
}

/**
 * A rain check on one pass (AGL-4043): leave it open, good on any later day
 * until it is used, or move it to a day staff pick. Through the check-in
 * route's `rain_check` action, gated as checking in is; the route records
 * who gave it, when, and the day it was on.
 */
export function PosRainCheckDialog(props: PosRainCheckDialogProps) {
  const { row, hostId, todayKey, registerId, cashierAssertion, onClose, onDone } = props
  const { data: user } = useUser()
  const [kind, setKind] = useState<'open' | 'date'>('open')
  const [day, setDay] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setKind('open')
    setDay('')
    setError('')
  }, [row?.id])

  const give = async () => {
    if (!row) return
    setBusy(true)
    setError('')
    const answer = await callPosOps<{ checkIn?: CheckInRow }>(user, 'pos-check-in', {
      hostId,
      action: 'rain_check',
      id: row.id,
      kind,
      ...(kind === 'date' ? { day } : {}),
      ...(registerId ? { registerId } : {}),
      ...(cashierAssertion ? { cashierAssertion } : {}),
    })
    setBusy(false)
    if (!answer.ok || !answer.body.checkIn) return setError(answer.body.error ?? 'The rain check was not given.')
    onDone(answer.body.checkIn)
  }

  return (
    <Dialog open={Boolean(row)} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{'Rain check'}</DialogTitle>
      <DialogContent>
        {row ? (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {`${row.customerName || row.customerEmail || 'Customer'} · ${checkInItemLabel(row)} · ${checkInDayLabel(row.dayKey)}`}
            </Typography>
            <RadioGroup value={kind} onChange={(event) => setKind(event.target.value === 'date' ? 'date' : 'open')}>
              <FormControlLabel value="open" control={<Radio />} label="Open: good on any later day until it is used" />
              <FormControlLabel value="date" control={<Radio />} label="Move it to a day" />
            </RadioGroup>
            {kind === 'date' ? (
              <UseDayPicker
                value={day}
                onChange={setDay}
                todayKey={todayKey}
                afterKey={row.dayKey}
                label="New day"
              />
            ) : null}
            {error ? <Alert severity="warning">{error}</Alert> : null}
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{'Cancel'}</Button>
        <Button variant="contained" disabled={busy || (kind === 'date' && !day)} onClick={() => void give()}>
          {'Give rain check'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

PosRainCheckDialog.displayName = 'PosRainCheckDialog'

export default PosRainCheckDialog
