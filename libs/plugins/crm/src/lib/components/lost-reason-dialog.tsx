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
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from '@mui/material'
import { useEffect, useState } from 'react'

/** Matches the route's own cap on the reason it stores. */
const LOST_REASON_MAX = 500

export interface LostReasonDialogProps {
  open: boolean
  /** The deal being closed, for the title. */
  dealTitle: string
  /**
   * How many deals the reason applies to — the bulk bar's selection
   * (AGL-2621). One, or absent, names the deal; more says the number.
   */
  count?: number
  busy?: boolean
  onClose: () => void
  onConfirm: (reason: string) => void
}

/**
 * The question a loss asks before it is recorded.
 *
 * A lost deal with no reason is a row a report cannot learn from, so the
 * dialog asks — but it does not insist. The reason is optional, because a
 * required field here is how "n/a" becomes the most common answer in the
 * data, and an empty reason is at least honest.
 */
export function LostReasonDialog(props: LostReasonDialogProps) {
  const { open, dealTitle, count = 1, busy, onClose, onConfirm } = props
  const [reason, setReason] = useState('')
  const many = count > 1

  // A fresh field each time the dialog opens: the previous deal's reason is
  // not this deal's.
  useEffect(() => {
    if (open) setReason('')
  }, [open])

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>{many ? `Mark ${count} deals lost?` : 'Mark this deal lost?'}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          {many
            ? `${count} deals move to Lost and leave the open pipeline, each ` +
              'with the reason below. Any can be reopened from its page.'
            : `"${dealTitle}" moves to Lost and leaves the open pipeline. ` +
              'It can be reopened from its page.'}
        </DialogContentText>
        <TextField
          label="Reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          multiline
          minRows={2}
          fullWidth
          autoFocus
          helperText={
            many
              ? 'Optional. Kept on each deal and sent with each dealLost event.'
              : 'Optional. Kept on the deal and sent with the dealLost event.'
          }
          slotProps={{ htmlInput: { maxLength: LOST_REASON_MAX } }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {'Cancel'}
        </Button>
        <Button
          variant="contained"
          color="error"
          disabled={busy}
          onClick={() => onConfirm(reason.trim())}
        >
          {'Mark lost'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
LostReasonDialog.displayName = 'LostReasonDialog'

export default LostReasonDialog
