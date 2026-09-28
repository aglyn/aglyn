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
import { useUser } from '@aglyn/tenant-feature-instance'
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
import { useCallback, useEffect, useState } from 'react'

/** The shortest note a review request takes, matching the server. */
export const REVIEW_NOTE_MIN = 10
const REVIEW_NOTE_MAX = 2000

export interface RequestReviewDialogProps {
  /** The notice to ask about; the dialog is open while one is set. */
  noticeId: string | null
  /** The workspace the notice belongs to. */
  orgId: string
  /** What the request is about, shown at the top: the notice title or the page's name. */
  title: string | null
  onClose: () => void
  /** After the request went through. */
  onSent?: (reference: string | null) => void
}

/**
 * REQUEST A REVIEW (AGL-3368): a note to our review team on the case a
 * notice is about, from Settings → Holds & reviews and from the banner on a
 * held page (AGL-3374). It appends a note to the case; it never releases
 * anything, and nothing here offers to.
 */
export default function RequestReviewDialog(props: RequestReviewDialogProps) {
  const { noticeId, orgId, title, onClose, onSent } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!noticeId) setNote('')
  }, [noticeId])

  const submit = useCallback(async () => {
    if (!noticeId || note.trim().length < REVIEW_NOTE_MIN) return
    setSending(true)
    try {
      const response = await authorizedFetch(user, '/api/orgs/risk-notices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, noticeId, note: note.trim() }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? `Failed (${response.status})`)
      enqueueSnackbar(
        `Review requested${payload.reference ? ` — reference ${payload.reference}` : ''}. We’ll email you when it’s done.`,
        { variant: 'success' },
      )
      setNote('')
      onClose()
      onSent?.(payload.reference ?? null)
    } catch (caught: any) {
      enqueueSnackbar(caught?.message ?? 'The review request did not send', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setSending(false)
    }
  }, [noticeId, note, orgId, user, enqueueSnackbar, onClose, onSent])

  return (
    <Dialog
      open={Boolean(noticeId)}
      onClose={() => (sending ? undefined : onClose())}
      fullWidth
      maxWidth="sm"
    >
      <DialogTitle>{'Request a review'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {title ? <Typography variant="body2">{title}</Typography> : null}
          <Typography variant="body2" color="text.secondary">
            {
              'Tell us what this is for and why it is genuine. A person reads every request, on the same case our team already has open. Requesting a review does not release anything by itself.'
            }
          </Typography>
          <TextField
            label="Your note"
            multiline
            minRows={4}
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, REVIEW_NOTE_MAX))}
            helperText={
              note.trim().length < REVIEW_NOTE_MIN
                ? 'At least a sentence, please.'
                : `${note.length}/${REVIEW_NOTE_MAX}`
            }
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={sending} onClick={onClose}>
          {'Cancel'}
        </Button>
        <Button
          variant="contained"
          disabled={sending || note.trim().length < REVIEW_NOTE_MIN}
          onClick={() => void submit()}
        >
          {'Send request'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
