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
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'

/** Mirrors `MAX_REASON_LENGTH` in `server/report.ts`. */
const MAX_REASON_LENGTH = 1000

export interface ReportTargetProps {
  listingId: string
  /**
   * Reporting a REVIEW rather than the listing itself. Omitted, the report is
   * filed against the listing — the same fork `report.ts` takes to set
   * `targetType`.
   */
  reviewUid?: string
  /** What the reporter is looking at, for the dialog copy. */
  label: string
}

/**
 * "Report" — the only way anything reaches the staff abuse queue (AGL-658).
 *
 * WHY THIS EXISTS. `POST marketplace/report` has been registered, rule-complete
 * and unreachable: it verifies the reporter's ID token, derives a deterministic
 * doc id so one account cannot inflate a queue by reporting twice, resolves the
 * listing name and publisher org, and writes `marketplaceReports/{id}`.
 * `/admin/marketplace-reports` reads that collection and can triage it. Nothing
 * in the product ever POSTed to the route, so the queue could never receive a
 * single report and the whole pipeline was staff-side machinery attached to
 * nothing.
 *
 * Pre-publication review is plugin-only by design — a template is inert until
 * installed — so after-the-fact reporting is the entire safety net for every
 * other artifact type. It was not connected.
 *
 * SIGNED-IN ONLY, and said rather than hidden. The route answers 401 without a
 * bearer token; a button that silently did nothing would teach a reporter that
 * reporting does not work, which is worse than the absence it replaces.
 */
export function ReportTarget(props: ReportTargetProps) {
  const { listingId, reviewUid, label } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = useCallback(async () => {
    const trimmed = reason.trim()
    // The server refuses an empty reason with a 400; refusing here as well
    // keeps a reporter from losing what they typed to a round trip.
    if (!trimmed) return
    setBusy(true)
    try {
      const response = await authorizedFetch(user, '/api/marketplace/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId,
          ...(reviewUid ? { reviewUid } : {}),
          reason: trimmed,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        return void enqueueSnackbar(
          payload?.error || 'Could not send that report',
          { variant: 'error', persist: false },
        )
      }
      setOpen(false)
      setReason('')
      // Says what happens next. "Reported" alone leaves someone wondering
      // whether anybody will look, and the honest answer — a human reads it —
      // is the reason to file one at all.
      enqueueSnackbar('Thanks — staff will review this report', {
        variant: 'success',
        persist: false,
      })
    } catch {
      enqueueSnackbar('Could not send that report', {
        variant: 'error',
        persist: false,
      })
    } finally {
      setBusy(false)
    }
  }, [enqueueSnackbar, listingId, reason, reviewUid, user])

  return (
    <>
      <Button
        size="small"
        color="inherit"
        sx={{ alignSelf: 'flex-start' }}
        onClick={() => setOpen(true)}
      >
        {'Report'}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{`Report ${label}`}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              {'Tell us what is wrong with this ' +
                (reviewUid ? 'review' : 'listing') +
                '. A staff member reads every report.'}
            </Typography>
            <TextField
              autoFocus
              multiline
              minRows={3}
              size="small"
              label="Reason"
              value={reason}
              onChange={(event) =>
                setReason(event.target.value.slice(0, MAX_REASON_LENGTH))
              }
              slotProps={{ htmlInput: { maxLength: MAX_REASON_LENGTH } }}
            />
            {/* The route requires a verified token. Saying so beats a 401
                the reporter cannot act on. */}
            {user ? null : (
              <Typography variant="caption" color="warning.main">
                {'Sign in to send a report.'}
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary">
              {'Reporting again updates your report rather than adding ' +
                'another one.'}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            disabled={busy || !reason.trim() || !user}
            onClick={() => void submit()}
          >
            {'Send report'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

ReportTarget.displayName = 'ReportTarget'

export default ReportTarget
