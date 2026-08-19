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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import { useStaffRole } from '../hooks/use-is-staff'

/**
 * Staff erasure of a PERSON's account (AGL-1977).
 *
 * `eraseUser` has been implemented, guarded, audited and spec-covered since
 * AGL-1140, and nothing in the console called it. The only way to reach it was
 * to hand-craft an authenticated `POST /api/admin/users/manage` carrying a
 * super-staff ID token — at the moment somebody is trying to honour a
 * statutory deadline. Worse, `tools/scripts/lib/erase-org-cli.mjs` told
 * operators to use "staff console → Users → Erase", a button that did not
 * exist. A capability that exists only as a route is not shipped (AGL-1900).
 *
 * This is the fallback for what self-serve cannot reach: a person who lost
 * access to their account, an SSO user whose IdP is gone, a request arriving
 * by email from someone who will never sign in again. Those are exactly the
 * shapes a DSAR arrives in.
 *
 * ## Two ways this deliberately differs from the org Erasure button
 *
 * 1. **There is no hold.** `/admin/orgs` → Erasure only sets
 *    `erasureRequestedAt` and the daily cron executes it after seven days,
 *    with a Cancel erasure button for the whole window. `eraseUser` deletes
 *    immediately and nothing can cancel it. An operator arriving here from
 *    the org flow will assume the hold applies, so the card says otherwise in
 *    the largest words on it rather than leaving them to find out.
 * 2. **It is gated on `staffRole === 'super'`**, matching the route. A button
 *    that 403s is worse than no button — it teaches an operator that the
 *    console is broken at the exact moment they need to trust it.
 *
 * The confirmation weight matches `close-account-card.component.tsx`: a typed
 * `DELETE` plus a reason. The route independently demands the reason (it is
 * what answers "who asked for this" a year later, when the uid is all that is
 * left to identify the person by), so asking for it here keeps the UI and the
 * route agreeing instead of surfacing a 400.
 */

export interface StaffUserEraseBlocker {
  orgId: string
  orgName: string
  hasLiveSubscription: boolean
  otherMembers: number
}

export interface StaffUserEraseCardProps {
  /** The account being erased. */
  uid: string
  /** For the confirmation copy — an email means more to a human than a uid. */
  subjectLabel: string
  /**
   * Whether this row is the signed-in staff member. The route refuses
   * self-erasure with a 400; refusing here too means the operator never sees
   * a button that cannot work.
   */
  isSelf: boolean
  /** Performs the POST; throws with the endpoint's own message on failure. */
  onErase: (reason: string) => Promise<unknown>
}

export function StaffUserEraseCard({
  uid,
  subjectLabel,
  isSelf,
  onErase,
}: StaffUserEraseCardProps) {
  const staffRole = useStaffRole()
  const { enqueueSnackbar } = useSnackbar()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [blockers, setBlockers] = useState<StaffUserEraseBlocker[] | null>(null)
  const [erased, setErased] = useState(false)

  const reset = useCallback(() => {
    setOpen(false)
    setReason('')
    setConfirm('')
    setBlockers(null)
  }, [])

  const erase = useCallback(async () => {
    setBusy(true)
    setBlockers(null)
    try {
      await onErase(reason.trim())
      setErased(true)
      setOpen(false)
      enqueueSnackbar('Account erased (audited)', {
        variant: 'success',
        persist: false,
      })
    } catch (error) {
      // `owns-orgs` is not a failure, it is an answer: the route returns the
      // blocking workspaces precisely so a caller can name them. Rendering
      // them inline is the difference between "transfer ownership" — useless
      // advice when you do not know which of eleven workspaces — and a list.
      const detail = error as {
        message?: string
        skippedReason?: string
        blockers?: StaffUserEraseBlocker[]
      }
      if (detail?.skippedReason === 'owns-orgs') {
        setBlockers(detail.blockers ?? [])
        return
      }
      enqueueSnackbar(detail?.message ?? 'Erasing the account failed', {
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }, [onErase, reason, enqueueSnackbar])

  // `null` while the claim is still resolving — rendering the refusal in that
  // window would flash at every super-staff member on every page load.
  if (staffRole === null) return null
  if (staffRole !== 'super') {
    return (
      <CardDisplay
        header={'Erase account'}
        // Same card, role-refused branch. See the org publish panel: the
        // state that explains itself least is the one a reader reaches
        // BECAUSE they do not have what it takes.
        help={docsHelp('staffConsole', {
          anchor: '#whats-there',
          excerpt:
            'Erasing an account is super-staff only. The page explains who ' +
            'holds the role and what the account holder can do themselves.',
        })}
        contentGutterX
        contentGutterY
      >
        <Typography variant="body2" color="text.secondary">
          {'Erasing an account requires the super staff role. Ask someone who ' +
            'holds it, or use the account holder’s own Close account.'}
        </Typography>
      </CardDisplay>
    )
  }

  const canSubmit =
    confirm.trim().toUpperCase() === 'DELETE' && reason.trim().length > 0 && !busy

  return (
    <CardDisplay
      header={'Erase account'}
      contentGutterX
      contentGutterY
      help={docsHelp('staffConsole', {
        anchor: '#whats-there',
        excerpt:
          'Permanently erase a person’s account when self-serve cannot reach ' +
          'them. Immediate, super-staff only, and audited with the reason.',
      })}
    >
      <Stack spacing={2}>
        {/* The single most important sentence on the card. An operator who
            arrives from /admin/orgs has just used a button with a seven-day
            hold and a Cancel control, and will carry that model here. */}
        <Alert severity="warning">
          <AlertTitle>{'There is no 7-day hold on a person'}</AlertTitle>
          <Typography variant="body2">
            {'Unlike organization erasure, this deletes immediately and ' +
              'nothing can cancel it. There is no copy, and support cannot ' +
              'restore it.'}
          </Typography>
        </Alert>
        <Typography variant="body2" color="text.secondary">
          {'Offer the account holder’s own Close account first — it verifies ' +
            'itself and cannot act on the wrong account. Use this only when ' +
            'they cannot sign in: a lost account, a departed SSO user, or a ' +
            'request by email from someone who will never sign in again.'}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {'Workspaces they solely own are not deleted, and block the erasure ' +
            'until they are handed over — deleting a workspace as a side ' +
            'effect of closing a personal account is consent nobody gave.'}
        </Typography>
        {erased ? (
          <Alert severity="success">
            {`Erased. ${subjectLabel} no longer has an account; this page is a record of a uid that is gone.`}
          </Alert>
        ) : (
          <Box>
            <Button
              color="error"
              variant="outlined"
              disabled={isSelf}
              onClick={() => setOpen(true)}
            >
              {'Erase account'}
            </Button>
            {isSelf ? (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', pt: 1 }}
              >
                {'You cannot erase your own staff account from here — use ' +
                  'Manage Account → Close account.'}
              </Typography>
            ) : null}
          </Box>
        )}
      </Stack>

      <Dialog open={open} onClose={busy ? undefined : reset} maxWidth="sm" fullWidth>
        <DialogTitle>{`Erase ${subjectLabel}?`}</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <DialogContentText>
              {'This permanently deletes their profile, avatar, sign-in and ' +
                'every org membership. It runs now — there is no hold — and ' +
                'no action can undo it.'}
            </DialogContentText>
            <Typography variant="caption" color="text.secondary">
              {`uid ${uid}`}
            </Typography>

            {blockers !== null && (
              <Alert severity="warning">
                <AlertTitle>
                  {blockers.length === 1
                    ? 'One workspace still needs an owner'
                    : `${blockers.length} workspaces still need an owner`}
                </AlertTitle>
                <Typography variant="body2">
                  {'Nothing was erased. Hand these over or delete them first:'}
                </Typography>
                <List dense disablePadding>
                  {blockers.map((blocker) => (
                    <ListItem key={blocker.orgId} disableGutters>
                      <ListItemText
                        primary={blocker.orgName}
                        secondary={[
                          blocker.hasLiveSubscription
                            ? 'has an active subscription'
                            : null,
                          blocker.otherMembers === 1
                            ? '1 other member'
                            : blocker.otherMembers > 1
                              ? `${blocker.otherMembers} other members`
                              : 'no other members',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      />
                    </ListItem>
                  ))}
                </List>
              </Alert>
            )}

            <TextField
              label="Why — a ticket or DSAR reference"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              helperText={
                'Required. The uid is all that will be left to identify them ' +
                'by, so this is what answers “who asked for this” later.'
              }
              fullWidth
            />
            <TextField
              label="Type DELETE to confirm"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={reset} disabled={busy}>
            {'Cancel'}
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={!canSubmit}
            onClick={() => void erase()}
          >
            {busy ? 'Erasing…' : 'Erase permanently'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}

export default StaffUserEraseCard
