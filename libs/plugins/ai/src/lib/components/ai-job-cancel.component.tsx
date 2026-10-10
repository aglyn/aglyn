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

import type { MaybeTokenSource } from '@aglyn/shared-util-http/authorized-token'
import {
  Alert,
  Box,
  Button,
  type ButtonProps,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Tooltip,
} from '@mui/material'
import { type ReactNode, useCallback, useRef, useState } from 'react'
import {
  AI_JOB_CANCEL_CONFIRM_COPY,
  AI_JOB_CANCEL_TITLE,
  aiJobCancelBlockedReason,
} from '../model/ai-job-cancel-copy'
import { AI_JOB_TERMINAL_STATUSES, type AiJobSummary } from '../model/ai-jobs.types'
import { cancelAiJobRequest } from './ai-job-requests'

/**
 * Cancel an AI job, after saying what it does (AGL-3616). One confirm dialog
 * and one request for every surface that offers Cancel — the job's page, a
 * row of the site's AI jobs list, and the AI jobs list the top-bar chip
 * opens — through the cancel door the Assist panel's list always used.
 *
 * `useAiJobCancel` owns the dialog: `ask(job)` opens it, Keep building
 * closes it, and Cancel job posts the cancel and hands the job the door
 * answered with to `onJob`, so the surface shows "Stopping…" or "Canceled"
 * without waiting for its stream. A refusal stays in the dialog, in the
 * door's own words.
 */
export function useAiJobCancel({
  user,
  orgId,
  onJob,
}: {
  user: MaybeTokenSource
  orgId: string | null
  onJob?: (job: AiJobSummary) => void
}): { ask: (job: AiJobSummary) => void; busyJobId: string | null; dialog: ReactNode } {
  const [target, setTarget] = useState<AiJobSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const onJobRef = useRef(onJob)
  onJobRef.current = onJob

  const ask = useCallback((job: AiJobSummary) => {
    if (aiJobCancelBlockedReason(job)) return
    setError(null)
    setTarget(job)
  }, [])
  const close = useCallback(() => {
    if (busy) return
    setTarget(null)
    setError(null)
  }, [busy])
  const confirm = useCallback(async () => {
    if (!target || !orgId) return
    setBusy(true)
    setError(null)
    const { job, error: refused } = await cancelAiJobRequest(user, orgId, target.id)
    setBusy(false)
    if (job) onJobRef.current?.(job)
    if (refused) {
      setError(refused)
      return
    }
    setTarget(null)
  }, [target, orgId, user])

  const dialog = (
    <Dialog open={target !== null} onClose={close} aria-labelledby="ai-job-cancel-title" maxWidth="xs" fullWidth>
      <DialogTitle id="ai-job-cancel-title">{AI_JOB_CANCEL_TITLE}</DialogTitle>
      <DialogContent>
        <DialogContentText>{AI_JOB_CANCEL_CONFIRM_COPY}</DialogContentText>
        {error ? (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {error}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={busy}>
          {'Keep building'}
        </Button>
        <Button color="error" variant="contained" onClick={() => void confirm()} disabled={busy || !orgId}>
          {busy ? 'Canceling…' : 'Cancel job'}
        </Button>
      </DialogActions>
    </Dialog>
  )
  return { ask, busyJobId: busy ? (target?.id ?? null) : null, dialog }
}

/**
 * The Cancel button: enabled while the job can still be stopped, and
 * disabled with the reason as its tooltip once it is done, failed, canceled
 * or already stopping.
 */
export function AiJobCancelButton({
  job,
  user,
  orgId,
  onJob,
  size = 'medium',
  variant = 'outlined',
}: {
  job: AiJobSummary
  user: MaybeTokenSource
  orgId: string | null
  onJob?: (job: AiJobSummary) => void
  size?: ButtonProps['size']
  variant?: ButtonProps['variant']
}) {
  const { ask, busyJobId, dialog } = useAiJobCancel({ user, orgId, onJob })
  const blocked = aiJobCancelBlockedReason(job)
  const stopping = Boolean(job.cancelRequested) && !AI_JOB_TERMINAL_STATUSES.includes(job.status)
  const button = (
    <Button
      size={size}
      variant={variant}
      color="error"
      disabled={Boolean(blocked) || busyJobId === job.id || !orgId}
      onClick={() => ask(job)}
    >
      {stopping ? 'Stopping…' : 'Cancel'}
    </Button>
  )
  return (
    <>
      {blocked ? (
        <Tooltip title={blocked}>
          {/* A disabled button fires no pointer events; the span carries the tooltip. */}
          <Box component="span" sx={{ display: 'inline-flex' }}>
            {button}
          </Box>
        </Tooltip>
      ) : (
        button
      )}
      {dialog}
    </>
  )
}
