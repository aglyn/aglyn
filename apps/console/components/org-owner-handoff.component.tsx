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

import type { OwnerHandoffPreviousOwner } from '@aglyn/aglyn'
import {
  OWNER_HANDOFF_PREVIOUS_OWNER,
  OWNER_HANDOFF_PREVIOUS_OWNER_LABELS,
} from '@aglyn/aglyn/app-utils/organizations'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
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
import { useState } from 'react'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** What the outgoing owner keeps, said once for every surface that asks. */
export const OWNER_HANDOFF_HINT =
  'They become the owner once they accept. Nothing changes until then, and ' +
  'the invitation reserves no seat.'

/**
 * The outgoing owner's choice for an owner handoff (AGL-3466): stay on as an
 * admin, or leave. The Team page's invite row and the staff dialog below
 * both draw it, so the two cannot word the choice differently.
 */
export function OwnerHandoffPreviousOwnerField(props: {
  value: OwnerHandoffPreviousOwner
  onChange: (value: OwnerHandoffPreviousOwner) => void
  disabled?: boolean
}) {
  const { value, onChange, disabled } = props
  return (
    <TextField
      size="small"
      select
      label="Current owner"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as OwnerHandoffPreviousOwner)}
      sx={{ minWidth: 280 }}
    >
      {OWNER_HANDOFF_PREVIOUS_OWNER.map((option) => (
        <MenuItem key={option} value={option}>
          {OWNER_HANDOFF_PREVIOUS_OWNER_LABELS[option]}
        </MenuItem>
      ))}
    </TextField>
  )
}

/**
 * Send an owner handoff through `/api/orgs/invites` (AGL-3466). Resolves the
 * route's answer so each surface can word its own confirmation; a refusal is
 * returned, not thrown, because the seat refusal is an expected answer that
 * names its own way out.
 */
export async function sendOwnerHandoff(
  user: Parameters<typeof authorizedFetch>[0],
  options: { orgId: string; email: string; previousOwner: OwnerHandoffPreviousOwner },
): Promise<{ ok: boolean; emailed?: boolean; error?: string }> {
  const response = await authorizedFetch(user, '/api/orgs/invites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orgId: options.orgId,
      action: 'create',
      email: options.email.trim().toLowerCase(),
      role: 'owner',
      handoff: { previousOwner: options.previousOwner },
    }),
  })
  const payload = await response.json().catch(() => ({}))
  return response.ok
    ? { ok: true, emailed: payload?.emailed === true }
    : { ok: false, error: payload?.error ?? 'The handoff could not be sent' }
}

export interface StaffOrgOwnerHandoffProps {
  orgId: string
  /** The organization's name, for the dialog. */
  orgName?: string | null
  /** Called once the invitation is sent. */
  onSent?: () => void
}

/**
 * Hand a workspace to a client from the staff pages (AGL-3466): the staff
 * organization page and the staff site page, beside the ownership transfer.
 *
 * A transfer moves the workspace to somebody already on its roster. A
 * handoff invites an address — the client the site was built for usually
 * has no account yet — and moves the workspace when they accept. Staff take
 * no seat, so a Free workspace staff built needs no override for it.
 */
export function StaffOrgOwnerHandoff(props: StaffOrgOwnerHandoffProps) {
  const { orgId, orgName, onSent } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [previousOwner, setPreviousOwner] =
    useState<OwnerHandoffPreviousOwner>('stay')
  const [busy, setBusy] = useState(false)
  const emailValid = EMAIL_PATTERN.test(email.trim())

  const send = async () => {
    if (!emailValid || busy) return
    setBusy(true)
    try {
      const result = await sendOwnerHandoff(user, { orgId, email, previousOwner })
      if (!result.ok) {
        enqueueSnackbar(result.error, { variant: 'warning', persist: false })
        return
      }
      enqueueSnackbar(
        result.emailed
          ? `Handoff sent to ${email.trim()} — email sent`
          : `Handoff sent to ${email.trim()} — they'll see it when they sign in`,
        { variant: 'success' },
      )
      setOpen(false)
      setEmail('')
      onSent?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        onClick={() => setOpen(true)}
        sx={{ alignSelf: 'flex-start' }}
      >
        {'Hand off to a new owner'}
      </Button>
      <Dialog
        open={open}
        onClose={() => (busy ? undefined : setOpen(false))}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{`Hand off ${orgName ?? 'this workspace'}`}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <DialogContentText>{OWNER_HANDOFF_HINT}</DialogContentText>
            <TextField
              size="small"
              label="New owner's email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              error={Boolean(email.trim()) && !emailValid}
              helperText={
                Boolean(email.trim()) && !emailValid
                  ? 'Enter a valid email address'
                  : undefined
              }
              autoFocus
            />
            <OwnerHandoffPreviousOwnerField
              value={previousOwner}
              onChange={setPreviousOwner}
              disabled={busy}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setOpen(false)}>
            {'Cancel'}
          </Button>
          <Button
            variant="contained"
            disabled={busy || !emailValid}
            onClick={() => void send()}
          >
            {busy ? 'Sending…' : 'Send handoff'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

export default StaffOrgOwnerHandoff
