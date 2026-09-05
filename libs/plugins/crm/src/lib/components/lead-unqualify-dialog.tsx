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

import type { CrmLeadFields } from '@aglyn/aglyn'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from '@mui/material'
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'

const REASON_MAX = 500

export interface LeadUnqualifyDialogProps {
  open: boolean
  onClose: () => void
  hostId: string
  leadId: string
  /** How the lead reads in the title — its name, else its address. */
  leadLabel: string
}

/**
 * Close a lead without converting it, with the reason why (AGL-2608).
 *
 * The reason is REQUIRED. An unqualified lead with no reason is a row that
 * says only "somebody gave up", and the one thing a report on lost leads
 * wants to count is why. A client-direct write: `hosts/{hostId}/leads` is
 * not in the catch-all's update exclusions, so a site admin, editor or
 * author may update it, and nothing here needs the server.
 */
export function LeadUnqualifyDialog(props: LeadUnqualifyDialogProps) {
  const { open, onClose, hostId, leadId, leadLabel } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) setReason('')
  }, [open])

  const submit = async () => {
    const trimmed = reason.trim()
    if (!trimmed) return
    setBusy(true)
    try {
      const fields: Required<Pick<CrmLeadFields, 'status' | 'unqualifiedReason'>> = {
        status: 'unqualified',
        unqualifiedReason: trimmed.slice(0, REASON_MAX),
      }
      await updateDoc(doc(firestore, 'hosts', hostId, 'leads', leadId), {
        ...fields,
        updatedAt: serverTimestamp(),
      })
      enqueueSnackbar('Lead marked unqualified', { variant: 'success', persist: false })
      onClose()
    } catch (error) {
      enqueueSnackbar(
        error instanceof Error ? error.message : 'The lead could not be updated.',
        { variant: 'error' },
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{`Unqualify ${leadLabel}?`}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          {'The lead stays on file and drops out of the open list. Say why, ' +
            'so the reason can be counted later.'}
        </DialogContentText>
        <TextField
          label="Reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          multiline
          minRows={2}
          fullWidth
          autoFocus
          slotProps={{ htmlInput: { maxLength: REASON_MAX } }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {'Cancel'}
        </Button>
        <Button
          variant="contained"
          color="warning"
          onClick={() => void submit()}
          disabled={busy || !reason.trim()}
        >
          {'Unqualify'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
LeadUnqualifyDialog.displayName = 'LeadUnqualifyDialog'

export default LeadUnqualifyDialog
