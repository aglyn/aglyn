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

import type { AglynOrgBilling } from '@aglyn/aglyn'
import { describeBundle } from '@aglyn/aglyn/app-utils/bundle-intent'
import {
  readUpgradeProposal,
  UPGRADE_PROPOSAL_NOTE_MAX,
  upgradeProposalSummary,
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
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import {
  bundleDraftBody,
  DEFAULT_BUNDLE_DRAFT,
  StaffBundleFields,
  type BundleDraft,
} from './staff-bundle-fields.component'

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
  const [draft, setDraft] = useState<BundleDraft>(DEFAULT_BUNDLE_DRAFT)
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
    const bundle = bundleDraftBody(draft)
    const payload = await call({ action: 'propose', ...bundle, note })
    if (!payload) return
    const what = describeBundle(bundle)
    enqueueSnackbar(
      payload['emailed']
        ? `Proposed ${what} — the owner was emailed`
        : `Proposed ${what} — no email went out; they will see it in the console`,
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
            {`Proposed: ${upgradeProposalSummary(standing)}` +
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
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{'Ask to upgrade'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <DialogContentText>
              {"The owner is emailed, and the workspace's billing managers see " +
                'the plan, with its add-ons, cadence and coupon, on the org ' +
                'home and on Billing, preselected, until a subscription is ' +
                'live. A sales-trial comp clears itself when they subscribe.'}
            </DialogContentText>
            <StaffBundleFields value={draft} onChange={setDraft} disabled={busy} />
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
