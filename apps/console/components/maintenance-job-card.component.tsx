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

/**
 * ONE MAINTENANCE JOB, WITH ITS SAFETY RAILS (AGL-1949).
 *
 * ## Preview, then arm
 *
 * The real run is unreachable until a dry run has been read in this session.
 * Not a nag: for two of these jobs the preview IS the list of things about to
 * be destroyed permanently, and "show what would happen first" is worth
 * nothing if the button next to it can be pressed without looking.
 *
 * Any change to the reason or the phrase after a preview does NOT clear it —
 * but running the job does, so a second real run needs a second look. The
 * preview is also invalidated by the job having just run, because the plan it
 * showed is now stale by construction.
 *
 * ## The typed phrase is not this component's rule
 *
 * It comes from the descriptor and is enforced by the ROUTE. This renders it
 * and disables the button, which is a courtesy — a control that exists only
 * in the UI is not a control, and the server refuses the same request whether
 * or not this component is in the page.
 */

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  AlertTitle,
  Button,
  Chip,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useState } from 'react'

import { docsHelp } from '../constants/docs-links'
import {
  MAINTENANCE_REASON_MIN,
  type MaintenanceJobDescriptor,
} from '../utils/maintenance-jobs'

/** A result worth reading, reduced to lines. Shapes differ per job. */
function summarize(payload: Record<string, unknown>): string[] {
  const lines: string[] = []
  const num = (key: string): number | null => {
    const value = payload[key]
    return typeof value === 'number' ? value : null
  }
  const add = (key: string, word: string) => {
    const value = num(key)
    if (value !== null) lines.push(`${value} ${word}`)
  }
  add('archived', 'audit rows')
  add('batches', 'batches')
  add('scanned', 'objects scanned')
  add('orphans', 'orphaned objects')
  add('deleted', 'objects deleted')
  add('bytesReclaimable', 'bytes reclaimable')
  add('kept', 'objects kept')
  add('tooNew', 'objects too new to reap')
  add('skipped', 'versions already current')
  add('downloaded', 'versions downloaded')
  add('deferredByCap', 'deferred by the per-run cap')
  const needsStaff = payload['needsStaff']
  if (Array.isArray(needsStaff)) {
    lines.push(
      needsStaff.length === 0
        ? 'no live version fails the verifier'
        : `${needsStaff.length} LIVE version(s) now fail the verifier`,
    )
  }
  const erasureDue = payload['erasureDue']
  if (Array.isArray(erasureDue) && erasureDue.length) {
    lines.push(`${erasureDue.length} erasure(s) past the hold`)
  }
  return lines
}

export function MaintenanceJobCard({
  job,
}: {
  job: MaintenanceJobDescriptor
}) {
  const { data: user } = useUser()
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [reason, setReason] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const call = useCallback(
    async (body: Record<string, unknown> | null) => {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch(job.path, {
        method: body ? 'POST' : 'GET',
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(String(payload?.error ?? `HTTP ${response.status}`))
      }
      return payload as Record<string, unknown>
    },
    [job.path, user],
  )

  // A bare GET is the dry run (`isCronDryRun` keys the default on the METHOD),
  // so the preview cannot accidentally become a real run.
  const runPreview = useCallback(async () => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      setPreview(await call(null))
    } catch (previewError) {
      setPreview(null)
      setError(String((previewError as Error).message))
    } finally {
      setBusy(false)
    }
  }, [call])

  const runForReal = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const payload = await call({
        dryRun: false,
        reason: reason.trim(),
        ...(job.confirmPhrase ? { confirm } : {}),
      })
      setResult(payload)
      // The plan that was previewed is stale the moment it is executed, so a
      // second real run has to be armed from a fresh look.
      setPreview(null)
      setConfirm('')
      setReason('')
    } catch (runError) {
      setError(String((runError as Error).message))
    } finally {
      setBusy(false)
    }
  }, [call, confirm, job.confirmPhrase, reason])

  const reasonOk = reason.trim().length >= MAINTENANCE_REASON_MIN
  const confirmOk = !job.confirmPhrase || confirm === job.confirmPhrase
  const armed = Boolean(preview) && reasonOk && confirmOk && !busy

  return (
    <CardDisplay
      header={job.label}
      help={docsHelp('maintenance', {
        anchor: '#running-a-job-by-hand',
        excerpt:
          'Preview first — for the destructive jobs the preview is the list ' +
          'of what is about to be destroyed. Every run by hand is recorded ' +
          'in the audit log with your reason.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          {job.destructive ? (
            <Chip size="small" color="error" label="Destroys data" />
          ) : (
            <Chip size="small" label="Reversible" />
          )}
          <Chip
            size="small"
            variant="outlined"
            label={job.path}
            sx={{ fontFamily: 'monospace' }}
          />
        </Stack>

        <Typography variant="body2" color="text.secondary">
          {job.what}
        </Typography>

        {error ? <Alert severity="warning">{error}</Alert> : null}

        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Button
            size="small"
            variant="outlined"
            disabled={busy}
            onClick={() => void runPreview()}
          >
            {busy ? 'Working…' : 'Preview (dry run)'}
          </Button>
          <Typography variant="caption" color="text.secondary">
            {job.previewShows}
          </Typography>
        </Stack>

        {preview ? (
          <Alert severity="info">
            <AlertTitle>{'What a real run would do'}</AlertTitle>
            <Stack component="ul" sx={{ pl: 2, m: 0 }} spacing={0.25}>
              {summarize(preview).map((line) => (
                <Typography component="li" variant="body2" key={line}>
                  {line}
                </Typography>
              ))}
            </Stack>
          </Alert>
        ) : null}

        {result ? (
          <Alert severity="success">
            <AlertTitle>{'Run complete'}</AlertTitle>
            <Stack component="ul" sx={{ pl: 2, m: 0 }} spacing={0.25}>
              {summarize(result).map((line) => (
                <Typography component="li" variant="body2" key={line}>
                  {line}
                </Typography>
              ))}
            </Stack>
          </Alert>
        ) : null}

        {/*
          The consequence sits immediately above the arming controls, not in
          a tooltip. Whoever is here is about to do this, probably for the
          first time, and the sentence they need is the one about what does
          not come back.
        */}
        <Alert severity={job.destructive ? 'error' : 'warning'}>
          {job.consequence}
        </Alert>

        <TextField
          size="small"
          fullWidth
          label={`Reason (at least ${MAINTENANCE_REASON_MIN} characters)`}
          helperText={
            'Recorded in the audit log with your account. Say why this could ' +
            'not wait for the schedule.'
          }
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />

        {job.confirmPhrase ? (
          <TextField
            size="small"
            fullWidth
            label={`Type "${job.confirmPhrase}" to arm`}
            helperText={
              'Compared exactly — case and spacing included. The server ' +
              'refuses the run without it.'
            }
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        ) : null}

        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Button
            size="small"
            variant="contained"
            color={job.destructive ? 'error' : 'primary'}
            disabled={!armed}
            onClick={() => void runForReal()}
          >
            {busy ? 'Working…' : 'Run for real'}
          </Button>
          {/*
            Say WHY it is disabled. A greyed button with no explanation is
            how someone concludes the page is broken and goes back to curl —
            which is the situation this whole issue is about.
          */}
          {!preview ? (
            <Typography variant="caption" color="text.secondary">
              {'Preview first — the real run stays locked until you have ' +
                'read what it would do.'}
            </Typography>
          ) : !reasonOk ? (
            <Typography variant="caption" color="text.secondary">
              {'A reason is required.'}
            </Typography>
          ) : !confirmOk ? (
            <Typography variant="caption" color="text.secondary">
              {'The confirmation phrase does not match yet.'}
            </Typography>
          ) : null}
        </Stack>
      </Stack>
    </CardDisplay>
  )
}

MaintenanceJobCard.displayName = 'MaintenanceJobCard'

export default MaintenanceJobCard
