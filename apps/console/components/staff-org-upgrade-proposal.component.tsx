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

import type { AglynOrgBilling, OrgPlan } from '@aglyn/aglyn'
import { PLAN_LABELS } from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  readUpgradeProposal,
  UPGRADE_PROPOSAL_NOTE_MAX,
  UPGRADE_PROPOSAL_PLANS,
} from '@aglyn/aglyn/app-utils/upgrade-proposal'
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
  Typography,
} from '@mui/material'
import { useState } from 'react'

export interface StaffOrgUpgradeProposalProps {
  orgId: string
  /** The org document as the staff page read it — the proposal rides on it. */
  org?: Partial<AglynOrgBilling> | null
  /** Called after a propose or withdraw, so the page re-reads the org. */
  onChanged?: () => void
}

/**
 * Ask a workspace to upgrade, or withdraw the ask (AGL-3466) — on the staff
 * organization page and the staff site page.
 *
 * The step after the evaluation: a client handed a workspace looks around
 * first, with no upgrade asked of them, and staff decide when to ask.
 * Proposing emails the owner and puts a card with the plan preselected in
 * front of the workspace's billing managers until a subscription is live.
 * A comp granted for the evaluation can stay on: the client can still start
 * the subscription for the very tier they are comped on, and the trial comp
 * clears itself when they do.
 */
export function StaffOrgUpgradeProposal(props: StaffOrgUpgradeProposalProps) {
  const { orgId, org, onChanged } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const standing = readUpgradeProposal(org)
  const [open, setOpen] = useState(false)
  const [plan, setPlan] = useState<OrgPlan>('starter')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const call = async (body: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
    setBusy(true)
    try {
      const response = await authorizedFetch(user, '/api/admin/org-upgrade-proposal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, ...body }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        enqueueSnackbar(payload?.error ?? 'The request failed', {
          variant: 'warning',
          persist: false,
        })
        return null
      }
      return payload
    } finally {
      setBusy(false)
    }
  }

  const propose = async () => {
    const payload = await call({ action: 'propose', plan, note })
    if (!payload) return
    enqueueSnackbar(
      payload['emailed']
        ? `Proposed ${PLAN_LABELS[plan]} — the owner was emailed`
        : `Proposed ${PLAN_LABELS[plan]} — no email went out; they will see it in the console`,
      { variant: 'success' },
    )
    setOpen(false)
    setNote('')
    onChanged?.()
  }

  const withdraw = async () => {
    if (!(await call({ action: 'withdraw' }))) return
    enqueueSnackbar('Proposal withdrawn', { variant: 'success' })
    onChanged?.()
  }

  return (
    <>
      {standing ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="body2" sx={{ flexGrow: 1 }}>
            {`Proposed: ${PLAN_LABELS[standing.plan]}` +
              (standing.proposedAt
                ? ` (${new Date(standing.proposedAt).toLocaleDateString()})`
                : '')}
          </Typography>
          <Button size="small" color="error" disabled={busy} onClick={() => void withdraw()}>
            {'Withdraw proposal'}
          </Button>
        </Stack>
      ) : (
        <Button
          size="small"
          variant="outlined"
          onClick={() => setOpen(true)}
          sx={{ alignSelf: 'flex-start' }}
        >
          {'Ask to upgrade'}
        </Button>
      )}
      <Dialog
        open={open}
        onClose={() => (busy ? undefined : setOpen(false))}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'Ask to upgrade'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <DialogContentText>
              {"The owner is emailed, and the workspace's billing managers see " +
                'the plan on the org home and on Billing, preselected, until ' +
                'a subscription is live. A sales-trial comp clears itself when ' +
                'they subscribe.'}
            </DialogContentText>
            <TextField
              select
              size="small"
              label="Plan"
              value={plan}
              onChange={(event) => setPlan(event.target.value as OrgPlan)}
            >
              {UPGRADE_PROPOSAL_PLANS.map((option) => (
                <MenuItem key={option} value={option}>
                  {PLAN_LABELS[option]}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              label="Note to the owner (optional)"
              value={note}
              onChange={(event) =>
                setNote(event.target.value.slice(0, UPGRADE_PROPOSAL_NOTE_MAX))
              }
              multiline
              minRows={2}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setOpen(false)}>
            {'Cancel'}
          </Button>
          <Button variant="contained" disabled={busy} onClick={() => void propose()}>
            {busy ? 'Sending…' : 'Propose plan'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

export default StaffOrgUpgradeProposal
