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
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
} from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import { useInviteResponse } from '../hooks/use-invite-response'
import {
  usePendingInvites,
  type InviteReviewTarget,
  type PendingInvite,
} from '../hooks/use-pending-invites'
import { inviteSentence } from './org-invites-banner.component'

export interface InviteResponseDialogProps {
  target: InviteReviewTarget | null
  onClose: () => void
}

/**
 * Accept or decline one invitation (AGL-3402): what clicking the invitee's
 * `team.invite` notification opens, and the confirmation behind the banner's
 * Decline.
 *
 * The list is re-read on open rather than trusted, because a notification
 * outlives its invitation — it may since have been accepted in another tab,
 * declined, or withdrawn by the org — and the dialog says so instead of
 * offering a choice the server would refuse.
 */
export function InviteResponseDialog({ target, onClose }: InviteResponseDialogProps) {
  const { invites, refresh } = usePendingInvites()
  const { respond, busyId } = useInviteResponse()
  // Which target the re-read below has finished for — keyed to the target so
  // a second invitation never inherits the first one's "checked".
  const [checkedFor, setCheckedFor] = useState<InviteReviewTarget | null>(null)
  // The decline confirmation, per target: a target opened from the banner's
  // Decline starts on it, and moving between the steps records a choice for
  // that target only.
  const [step, setStep] = useState<{
    target: InviteReviewTarget | null
    confirmingDecline: boolean
  }>({ target: null, confirmingDecline: false })
  // The last target stays in charge of the content through the exit
  // transition, so closing does not flip the dialog to another step.
  const lastTarget = useRef<InviteReviewTarget | null>(null)
  if (target) lastTarget.current = target
  const shown = target ?? lastTarget.current
  const confirmingDecline =
    shown !== null && step.target === shown
      ? step.confirmingDecline
      : Boolean(shown?.decline)
  const setConfirmingDecline = (confirming: boolean) =>
    setStep({ target: shown, confirmingDecline: confirming })

  const open = target !== null
  useEffect(() => {
    if (!target) return undefined
    let cancelled = false
    void refresh().finally(() => {
      if (!cancelled) setCheckedFor(target)
    })
    return () => {
      cancelled = true
    }
  }, [target, refresh])

  const found = target
    ? invites.find(
        (candidate) =>
          candidate.$id === target.inviteId && candidate.orgId === target.orgId,
      )
    : undefined
  // The invite leaves the list the moment an answer is recorded, and the
  // dialog is still on screen then — mid-request, and through its exit
  // transition. Holding the last one shown keeps it from flashing "no longer
  // pending" over the answer the person just gave.
  const lastShown = useRef<PendingInvite | undefined>(undefined)
  if (found) lastShown.current = found
  const checked = target !== null && checkedFor === target
  const busy = busyId !== null
  const invite = found ?? (busy || !open ? lastShown.current : undefined)
  const orgName = invite?.orgName ?? 'this organization'

  const answer = async (response: 'accept' | 'decline') => {
    if (!invite) return
    if (await respond(invite, response)) onClose()
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      {!invite ? (
        checked ? (
          <>
            <DialogTitle>{'Invitation no longer pending'}</DialogTitle>
            <DialogContent>
              <DialogContentText>
                {'This invitation has already been accepted or declined, or ' +
                  'the organization withdrew it. Ask one of its admins to ' +
                  'invite you again if you still need access.'}
              </DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={onClose}>{'Close'}</Button>
            </DialogActions>
          </>
        ) : (
          <DialogContent>
            <Stack sx={{ alignItems: 'center', py: 3 }}>
              <CircularProgress size={28} aria-label="Loading invitation" />
            </Stack>
          </DialogContent>
        )
      ) : confirmingDecline ? (
        <>
          <DialogTitle>{`Decline the invitation to ${orgName}?`}</DialogTitle>
          <DialogContent>
            <DialogContentText>
              {'The invitation is removed and its admins are told you ' +
                'declined. To join later, one of them will have to invite ' +
                'you again.'}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button
              disabled={busy}
              onClick={() =>
                shown?.decline ? onClose() : setConfirmingDecline(false)
              }
            >
              {shown?.decline ? 'Cancel' : 'Back'}
            </Button>
            <Button
              color="error"
              variant="contained"
              disabled={busy}
              onClick={() => void answer('decline')}
            >
              {busy ? 'Declining…' : 'Decline invitation'}
            </Button>
          </DialogActions>
        </>
      ) : (
        <>
          <DialogTitle>
            {invite?.handoff ? `Take over ${orgName}?` : `Join ${orgName}?`}
          </DialogTitle>
          <DialogContent>
            <DialogContentText>
              {inviteSentence(invite) +
                (invite?.handoff
                  ? ' Accepting makes you the owner of the workspace and every ' +
                    'site in it. ' +
                    (invite.handoff.previousOwner === 'stay'
                      ? 'The current owner stays on as an admin.'
                      : 'The current owner leaves the workspace.')
                  : ' Accepting adds the workspace to your account and opens it.')}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button disabled={busy} onClick={onClose}>
              {'Not now'}
            </Button>
            <Button
              color="error"
              disabled={busy}
              onClick={() => setConfirmingDecline(true)}
            >
              {'Decline'}
            </Button>
            <Button
              variant="contained"
              disabled={busy}
              onClick={() => void answer('accept')}
            >
              {busy ? 'Joining…' : 'Accept'}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  )
}
InviteResponseDialog.displayName = 'InviteResponseDialog'

export default InviteResponseDialog
