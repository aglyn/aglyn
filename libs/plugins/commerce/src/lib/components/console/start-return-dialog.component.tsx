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

import * as CommerceModel from '../../model'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useMemo, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { postReturnAction } from './return-actions'

export interface StartReturnDialogProps {
  hostId: string
  orderId: string
  order: Pick<
    CommerceModel.HostOrder,
    'lineItems' | 'fulfillments' | 'refundedLineItemIds'
  >
  /** The returns already on the order, which hold units against it. */
  existing: ReadonlyArray<Pick<CommerceModel.HostReturn, 'status' | 'lines' | 'refundedAtMs'>>
  open: boolean
  onClose: () => void
  /** Called with the new return's id once the route opened it. */
  onCreated?: (returnId: string) => void
}

interface LineChoice {
  quantity: string
  reason: CommerceModel.ReturnReason
}

/**
 * "Start return" (AGL-3611): the merchant opens a return on the buyer's
 * behalf. It starts approved — the merchant asking is the approval — and the
 * route re-checks every quantity against the order and the returns already on
 * it. What is offered here is `returnableLines` with no store policy, since a
 * merchant may take back any product type, at any time.
 */
export function StartReturnDialog(props: StartReturnDialogProps) {
  const { hostId, orderId, order, existing, open, onClose, onCreated } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const returnable = useMemo(
    () => CommerceModel.returnableLines(order, existing, null),
    [order, existing],
  )
  const [choices, setChoices] = useState<Record<number, LineChoice>>({})
  const [note, setNote] = useState('')
  const [notify, setNotify] = useState(true)
  const [busy, setBusy] = useState(false)

  const choiceFor = (lineItemId: number): LineChoice =>
    choices[lineItemId] ?? { quantity: '0', reason: 'other' }
  const setChoice = (lineItemId: number, patch: Partial<LineChoice>) =>
    setChoices((prior) => ({
      ...prior,
      [lineItemId]: { ...(prior[lineItemId] ?? { quantity: '0', reason: 'other' }), ...patch },
    }))

  const lines = returnable
    .map((line) => ({
      lineItemId: line.lineItemId,
      quantity: Math.floor(Number(choiceFor(line.lineItemId).quantity) || 0),
      reason: choiceFor(line.lineItemId).reason,
      returnable: line.returnable,
    }))
    .filter((line) => line.quantity > 0)
  const overLimit = lines.some((line) => line.quantity > line.returnable)

  const handleClose = useCallback(() => {
    setChoices({})
    setNote('')
    setNotify(true)
    onClose()
  }, [onClose])

  const handleSubmit = useCallback(async () => {
    setBusy(true)
    try {
      const outcome = await postReturnAction(user, {
        hostId,
        action: 'create',
        orderId,
        lines: lines.map(({ lineItemId, quantity, reason }) => ({ lineItemId, quantity, reason })),
        ...(note.trim() ? { note: note.trim() } : {}),
        notify,
      })
      if (!outcome.ok) {
        enqueueSnackbar(outcome.message, {
          variant: outcome.refused ? 'warning' : 'error',
          allowDuplicate: true,
        })
        return
      }
      enqueueSnackbar('Return started', { variant: 'success', persist: false })
      const returnId = String(outcome.payload['returnId'] ?? '')
      handleClose()
      if (returnId) onCreated?.(returnId)
    } finally {
      setBusy(false)
    }
  }, [user, hostId, orderId, lines, note, notify, enqueueSnackbar, handleClose, onCreated])

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{'Start a return'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Typography variant="body2" color="text.secondary">
          {'Choose what is coming back. A return you start is approved at once; ' +
            'receive the parcel and refund it from the return.'}
        </Typography>
        {returnable.map((line) => (
          <Stack key={line.lineItemId} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography
              variant="body2"
              sx={{ flex: 1 }}
              color={line.returnable ? 'text.primary' : 'text.secondary'}
            >
              {line.name + (line.variantLabel ? ` — ${line.variantLabel}` : '')}
              {line.blocked ? ` (${line.blocked})` : ''}
            </Typography>
            <TextField
              label={`Quantity (of ${line.returnable})`}
              type="number"
              size="small"
              disabled={!line.returnable}
              value={choiceFor(line.lineItemId).quantity}
              onChange={(event) => setChoice(line.lineItemId, { quantity: event.target.value })}
              error={Number(choiceFor(line.lineItemId).quantity) > line.returnable}
              slotProps={{ htmlInput: { min: 0, max: line.returnable, step: 1 } }}
              sx={{ width: 140 }}
            />
            <TextField
              label="Reason"
              select
              size="small"
              disabled={!line.returnable}
              value={choiceFor(line.lineItemId).reason}
              onChange={(event) =>
                setChoice(line.lineItemId, {
                  reason: event.target.value as CommerceModel.ReturnReason,
                })
              }
              sx={{ width: 180 }}
            >
              {CommerceModel.RETURN_REASONS.map((reason) => (
                <MenuItem key={reason} value={reason}>
                  {CommerceModel.RETURN_REASON_LABELS[reason]}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        ))}
        <TextField
          label="Note (optional)"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          size="small"
          multiline
          minRows={2}
          slotProps={{ htmlInput: { maxLength: CommerceModel.RETURN_NOTE_MAX } }}
        />
        <FormControlLabel
          control={
            <Checkbox checked={notify} onChange={(event) => setNotify(event.target.checked)} />
          }
          label="Notify customer"
        />
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={handleClose}>
          {'Cancel'}
        </Button>
        <Button
          variant="contained"
          color="primary"
          disabled={busy || lines.length === 0 || overLimit}
          onClick={handleSubmit}
        >
          {'Start return'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
StartReturnDialog.displayName = 'StartReturnDialog'

export default StartReturnDialog
