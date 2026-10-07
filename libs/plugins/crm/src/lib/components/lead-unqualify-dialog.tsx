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

import { type CrmLeadFields, crmLeadStatusLabelFor, crmLeadStatusOptions } from '@aglyn/aglyn'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material'
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { useCrmScope } from '../hooks/use-crm-scope'
import { useCrmSharingFollowUp } from '../hooks/use-crm-sharing'
import { useLeadStatusPicklist } from '../hooks/use-lead-status-picklist'
import { UNQUALIFY_REASON_MAX } from '../model/lead-status-choices'

export { UNQUALIFY_REASON_MAX } from '../model/lead-status-choices'

const REASON_MAX = UNQUALIFY_REASON_MAX

export interface LeadUnqualifyDialogProps {
  open: boolean
  onClose: () => void
  /**
   * The lead's own site, or `null` at the organization level (AGL-3278).
   * The write is an org-scoped one-field update; the site is read for the
   * org root, which the mount answers without one.
   */
  hostId: string | null
  leadId: string
  /** How the lead reads in the title — its name, else its address. */
  leadLabel: string
  /**
   * The Unqualified value the lead is closed as, when the reader already
   * picked one (AGL-3512); the meaning's default label otherwise.
   */
  statusLabel?: string | null
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
  const { open, onClose, hostId, leadId, leadLabel, statusLabel } = props
  // The lead's collection is the org's now (AGL-3275); the site still names
  // the surface, and the scope hook resolves the org from it.
  const { orgId } = useCrmScope({ hostId })
  const followUpSharing = useCrmSharingFollowUp(hostId, orgId)
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  // The org's Unqualified values (AGL-3512): a choice only when it keeps several.
  const statuses = useLeadStatusPicklist(orgId)
  const closedAs = crmLeadStatusOptions(statuses.picklist, ['unqualified'])
  const [label, setLabel] = useState('')

  useEffect(() => {
    if (!open) return
    setReason('')
    setLabel(statusLabel || crmLeadStatusLabelFor(statuses.picklist, 'unqualified'))
    // Seeded as the dialog opens; the list arriving later does not reset a pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, statusLabel])

  const submit = async () => {
    const trimmed = reason.trim()
    if (!trimmed) return
    if (!orgId) {
      enqueueSnackbar('Still loading this workspace — try again in a moment.', {
        variant: 'warning',
        persist: false,
      })
      return
    }
    setBusy(true)
    try {
      const fields: Required<Pick<CrmLeadFields, 'status' | 'statusLabel' | 'unqualifiedReason'>> = {
        status: 'unqualified',
        // The meaning and the org's label for it, always together (AGL-3512).
        statusLabel: label || crmLeadStatusLabelFor(statuses.picklist, 'unqualified'),
        unqualifiedReason: trimmed.slice(0, REASON_MAX),
      }
      await updateDoc(doc(firestore, 'orgs', orgId, 'leads', leadId), {
        ...fields,
        updatedAt: serverTimestamp(),
      })
      // A rule may share by status (AGL-3336).
      followUpSharing('leads', [leadId])
      enqueueSnackbar(`Lead marked ${fields.statusLabel}`, { variant: 'success', persist: false })
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
        <Stack spacing={2}>
          {closedAs.length > 1 ? (
            <TextField
              select
              size="small"
              label="Status"
              value={closedAs.some((option) => option.label === label) ? label : ''}
              onChange={(event) => setLabel(String(event.target.value))}
              fullWidth
            >
              {closedAs.map((option) => (
                <MenuItem key={option.label} value={option.label}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
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
        </Stack>
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
