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

import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
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
import { collection, getDocs } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'

interface OrgMemberOption {
  uid: string
  label: string
}

export interface StaffOrgOwnershipTransferProps {
  orgId: string
  /** The organization's name, for the confirmation. */
  orgName?: string | null
  ownerUid?: string | null
  /** Called once the transfer is recorded, so the page re-reads the owner. */
  onTransferred?: () => void
}

/**
 * Hand an organization to another of its members (AGL-390), from any staff
 * page that shows its owner (AGL-3379).
 *
 * Through `/api/orgs/settings` `transfer-ownership`, the owner-facing route,
 * which admits staff: the outgoing owner becomes an admin, the new one the
 * owner, and every site's access projection is re-synced. The route refuses
 * a transfer that would lock the organization out of its own SSO, and says
 * why — so the refusal is shown, not logged.
 *
 * The candidates are the organization's members, read whole: the target must
 * already be one, and a roster capped at a first page would leave someone
 * past it untransferable-to.
 */
export function StaffOrgOwnershipTransfer(props: StaffOrgOwnershipTransferProps) {
  const { orgId, orgName, ownerUid, onTransferred } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [members, setMembers] = useState<OrgMemberOption[]>([])
  const [target, setTarget] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!orgId) return undefined
    let active = true
    void getDocs(collection(firestore, 'orgs', orgId, 'members'))
      .then((snapshot) => {
        if (!active) return
        setMembers(
          snapshot.docs.map((docSnap) => ({
            uid: docSnap.id,
            label: String(docSnap.get('displayName') || docSnap.get('email') || docSnap.id),
          })),
        )
      })
      .catch((error) => console.error('[ownership transfer] members', error))
    return () => {
      active = false
    }
  }, [firestore, orgId])

  const candidates = useMemo(
    () =>
      members
        .filter((member) => member.uid !== ownerUid)
        .sort((a, b) => a.label.localeCompare(b.label)),
    [members, ownerUid],
  )
  const targetLabel = candidates.find((member) => member.uid === target)?.label ?? target

  const transfer = async () => {
    if (!target || busy) return
    setBusy(true)
    try {
      const response = await authorizedFetch(user, '/api/orgs/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, action: 'transfer-ownership', targetUid: target }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error ?? 'The transfer failed')
      enqueueSnackbar(`${targetLabel} now owns ${orgName ?? 'the organization'}`, {
        variant: 'success',
      })
      setTarget('')
      setConfirming(false)
      onTransferred?.()
    } catch (error) {
      enqueueSnackbar(error instanceof Error ? error.message : 'The transfer failed', {
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <TextField
          select
          size="small"
          label="Transfer organization ownership to"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          helperText={candidates.length ? undefined : 'No other members to transfer to'}
          disabled={!candidates.length}
          sx={{ flex: 1 }}
        >
          <MenuItem value="">{'Select a member…'}</MenuItem>
          {candidates.map((member) => (
            <MenuItem key={member.uid} value={member.uid}>
              {member.label}
            </MenuItem>
          ))}
        </TextField>
        <Button
          size="small"
          color="error"
          disabled={busy || !target}
          onClick={() => setConfirming(true)}
          sx={{ mt: 0.5 }}
        >
          {'Transfer'}
        </Button>
      </Stack>
      <Dialog open={confirming} onClose={() => (busy ? undefined : setConfirming(false))}>
        <DialogTitle>{'Transfer ownership?'}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {`${targetLabel} becomes the owner of ${orgName ?? 'this organization'} — its billing ` +
              'contact and the one account that can delete it. The current owner stays on as an ' +
              'admin. The change is recorded in the organization activity log.'}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setConfirming(false)}>
            {'Cancel'}
          </Button>
          <Button color="error" disabled={busy} onClick={() => void transfer()}>
            {busy ? 'Transferring…' : 'Transfer ownership'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

export default StaffOrgOwnershipTransfer
