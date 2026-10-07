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
import { doc } from 'firebase/firestore'
import { useFirestore, useFirestoreDoc, useUser } from '@aglyn/tenant-feature-instance'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useCallback, useState } from 'react'
import {
  POS_CASH_EVENT_LABELS,
  posCashVarianceCents,
  posMoney,
  type PosCashEventType,
  type PosShift,
  type PosShiftReport,
} from '../../../model/commerce-pos-ops'
import { callPosOps, newPosAttemptKey, parsePosDollars } from './pos-ops-api'
import { usePosReceiptStore } from './pos-receipt-actions.component'
import {
  PosShiftReportView,
  posShiftReportDocument,
  printPosDocument,
} from './pos-shift-report.component'

export interface PosShiftPanelProps {
  hostId: string
  registerId: string
  registerName?: string
  /** The PIN-switched cashier's assertion, so the shift names them. */
  cashierAssertion?: string
}

type DialogKind = 'open' | 'cash' | 'report' | 'close' | null

/**
 * The register's shift (AGL-3609): open it with a starting float, record cash
 * paid in, paid out and dropped to the safe, read the X report at any time,
 * and close with a count — the Z report freezes the figures and the variance.
 * Live: a shift another tablet opens on this register shows here at once.
 */
export function PosShiftPanel(props: PosShiftPanelProps) {
  const { hostId, registerId, cashierAssertion } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const store = usePosReceiptStore(hostId)
  const { data: register } = useFirestoreDoc<Record<string, any>>(
    () => (registerId ? doc(firestore, 'hosts', hostId, 'registers', registerId) : null),
    [firestore, hostId, registerId],
  )
  const openShiftId = String(register?.['openShiftId'] ?? '')
  const { data: shiftData } = useFirestoreDoc<PosShift>(
    () =>
      registerId && openShiftId
        ? doc(firestore, 'hosts', hostId, 'registers', registerId, 'shifts', openShiftId)
        : null,
    [firestore, hostId, registerId, openShiftId],
  )
  const shift = openShiftId && shiftData?.status === 'open' ? shiftData : null

  const [dialog, setDialog] = useState<DialogKind>(null)
  const [amount, setAmount] = useState('')
  const [cashType, setCashType] = useState<Exclude<PosCashEventType, 'refund'>>('paid_out')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [report, setReport] = useState<PosShiftReport | null>(null)
  const [closed, setClosed] = useState<(PosShift & { id: string }) | null>(null)
  const [eventKey, setEventKey] = useState('')

  const reset = () => {
    setAmount('')
    setReason('')
    setNote('')
    setError('')
    setBusy(false)
  }
  const close = () => {
    setDialog(null)
    setClosed(null)
    reset()
  }

  const call = useCallback(
    (body: Record<string, unknown>) =>
      callPosOps<Record<string, any>>(user, 'pos-shift', {
        hostId,
        registerId,
        ...(cashierAssertion ? { cashierAssertion } : {}),
        ...body,
      }),
    [user, hostId, registerId, cashierAssertion],
  )

  const loadReport = useCallback(async () => {
    const answer = await call({ action: 'x-report' })
    if (!answer.ok) {
      setError(answer.body.error ?? 'Could not read the shift.')
      return null
    }
    setReport(answer.body['report'] as PosShiftReport)
    return answer.body['report'] as PosShiftReport
  }, [call])

  const submitOpen = async () => {
    const cents = parsePosDollars(amount || '0')
    if (cents == null) return setError('Enter the starting cash, like 150.00.')
    setBusy(true)
    const answer = await call({ action: 'open', openingFloatCents: cents })
    setBusy(false)
    if (!answer.ok) return setError(answer.body.error ?? 'Could not open the shift.')
    enqueueSnackbar('Shift opened', { variant: 'success', persist: false })
    close()
  }

  const submitCash = async () => {
    const cents = parsePosDollars(amount)
    if (!cents) return setError('Enter an amount above zero.')
    setBusy(true)
    const answer = await call({ action: 'cash-event', type: cashType, amountCents: cents, reason, eventId: eventKey })
    setBusy(false)
    if (!answer.ok) return setError(answer.body.error ?? 'Could not record the cash.')
    enqueueSnackbar(`${POS_CASH_EVENT_LABELS[cashType]} recorded`, { variant: 'success', persist: false })
    close()
  }

  const submitClose = async () => {
    const counted = parsePosDollars(amount)
    if (counted == null) return setError('Enter the cash you counted, like 212.40.')
    setBusy(true)
    const answer = await call({ action: 'close', countedCashCents: counted, shiftId: openShiftId, note })
    setBusy(false)
    if (!answer.ok) return setError(answer.body.error ?? 'Could not close the shift.')
    setClosed(answer.body['shift'] as PosShift & { id: string })
  }

  /**
   * The register's cloud receipt printer when it has one (AGL-3619), and the
   * browser's print dialog when it does not or the queue is unreachable.
   */
  const printReport = async (
    title: string,
    data: PosShiftReport,
    shiftId: string,
    frozen?: PosShift,
  ) => {
    const answer = await call({ action: 'print-report', shiftId, attemptKey: newPosAttemptKey() })
    if (answer.ok && answer.body['printed']) {
      enqueueSnackbar('Sent to the receipt printer', { variant: 'success', persist: false })
      return
    }
    printPosDocument(
      posShiftReportDocument({
        title,
        storeName: store.name,
        subtitle: `${props.registerName ?? 'Register'} · ${new Date().toLocaleString()}`,
        report: data,
        ...(frozen ? { shift: frozen } : {}),
      }),
    )
  }

  const countedCents = parsePosDollars(amount)
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        {shift ? (
          <>
            <Chip
              color="success"
              size="small"
              label={`Shift open since ${new Date(shift.openedAtMs).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
              })}`}
            />
            <Button
              size="small"
              onClick={() => {
                setEventKey(newPosAttemptKey())
                setDialog('cash')
              }}
            >
              {'Cash in/out'}
            </Button>
            <Button
              size="small"
              onClick={() => {
                setReport(null)
                setDialog('report')
                void loadReport()
              }}
            >
              {'X report'}
            </Button>
            <Button
              size="small"
              color="warning"
              onClick={() => {
                setReport(null)
                setDialog('close')
                void loadReport()
              }}
            >
              {'Close shift'}
            </Button>
          </>
        ) : (
          <>
            <Chip size="small" label="No shift open" />
            <Button size="small" variant="outlined" onClick={() => setDialog('open')} disabled={!registerId}>
              {'Open shift'}
            </Button>
          </>
        )}
      </Stack>

      <Dialog open={dialog === 'open'} onClose={close} maxWidth="xs" fullWidth>
        <DialogTitle>{'Open a shift'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {'Count the cash in the drawer before the first sale. Every sale and cash ' +
                'movement until you close is counted against it.'}
            </Typography>
            <TextField
              autoFocus
              label="Starting cash ($)"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              placeholder="150.00"
            />
            {error ? <Alert severity="warning">{error}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>{'Cancel'}</Button>
          <Button variant="contained" disabled={busy} onClick={submitOpen}>
            {'Open shift'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialog === 'cash'} onClose={close} maxWidth="xs" fullWidth>
        <DialogTitle>{'Cash in or out'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              select
              label="What happened"
              value={cashType}
              onChange={(event) => setCashType(event.target.value as typeof cashType)}
            >
              <MenuItem value="paid_in">{'Paid in — cash added to the drawer'}</MenuItem>
              <MenuItem value="paid_out">{'Paid out — cash taken for an expense'}</MenuItem>
              <MenuItem value="drop">{'Safe drop — cash moved to the safe'}</MenuItem>
            </TextField>
            <TextField
              label="Amount ($)"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
            />
            <TextField
              label={cashType === 'drop' ? 'Note (optional)' : 'Reason'}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={cashType === 'paid_out' ? 'Milk for the coffee bar' : ''}
            />
            {error ? <Alert severity="warning">{error}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>{'Cancel'}</Button>
          <Button variant="contained" disabled={busy} onClick={submitCash}>
            {'Record'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialog === 'report'} onClose={close} maxWidth="xs" fullWidth>
        <DialogTitle>{'X report'}</DialogTitle>
        <DialogContent>
          {report ? <PosShiftReportView report={report} /> : <Typography variant="body2">{'Reading the shift…'}</Typography>}
          {error ? <Alert severity="warning">{error}</Alert> : null}
        </DialogContent>
        <DialogActions>
          <Button disabled={!report} onClick={() => report && void printReport('X REPORT', report, openShiftId)}>
            {'Print'}
          </Button>
          <Button onClick={close}>{'Done'}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialog === 'close'} onClose={close} maxWidth="xs" fullWidth>
        <DialogTitle>{closed ? 'Z report' : 'Close the shift'}</DialogTitle>
        <DialogContent>
          {closed?.report ? (
            <PosShiftReportView report={closed.report} shift={closed} />
          ) : (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                {'Count the drawer, then enter what is in it.'}
              </Typography>
              <TextField
                autoFocus
                label="Cash counted ($)"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
              />
              {report && countedCents != null ? (
                <Alert
                  severity={posCashVarianceCents(countedCents, report.expectedCashCents) === 0 ? 'success' : 'info'}
                >
                  {`Expected ${posMoney(report.expectedCashCents)} · ${(() => {
                    const variance = posCashVarianceCents(countedCents, report.expectedCashCents)
                    return variance === 0
                      ? 'balanced'
                      : `${variance < 0 ? 'short' : 'over'} ${posMoney(Math.abs(variance))}`
                  })()}`}
                </Alert>
              ) : null}
              <TextField
                label="Note (optional)"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                multiline
                minRows={2}
              />
              {error ? <Alert severity="warning">{error}</Alert> : null}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          {closed?.report ? (
            <>
              <Button onClick={() => void printReport('Z REPORT', closed.report!, closed.id, closed)}>{'Print'}</Button>
              <Button variant="contained" onClick={close}>
                {'Done'}
              </Button>
            </>
          ) : (
            <>
              <Button onClick={close}>{'Cancel'}</Button>
              <Button variant="contained" color="warning" disabled={busy} onClick={submitClose}>
                {'Close shift'}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

PosShiftPanel.displayName = 'PosShiftPanel'

export default PosShiftPanel
