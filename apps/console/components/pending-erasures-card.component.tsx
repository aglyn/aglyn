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
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'

import { docsHelp } from '../constants/docs-links'

/**
 * The erasure queue: see it, and run it (AGL-2165).
 *
 * `POST /api/admin/run-erasures` executes the GDPR erasures whose 7-day hold
 * has expired, and until this it was reachable from nothing a staff member
 * has. It was cron-secret-only, so a browser could not call it at all, and
 * `staff-org-actions.component.tsx` describes it as the operator's escape
 * hatch while itself only calling `erasure-request` — which *queues* an
 * erasure. Staff could ask for a workspace to be erased and then had no way
 * to run it, to see what was pending, or to find out why one had not gone
 * through, short of hand-dispatching a GitHub workflow.
 *
 * That matters more here than on most cron routes, because the thing being
 * waited on is a **statutory deadline**. "It runs at 04:00 UTC" is not an
 * answer a data-protection request can be closed with, and the person holding
 * the deadline had no way to check.
 *
 * This is the AGL-2062 `ScopeDriftCard` shape, for the same reason: a route
 * with two intended callers where only the scheduler was ever built.
 *
 * The read and the run are the SAME route the runbook documents; nothing here
 * re-implements erasure, and every irreversible decision stays with
 * `eraseOrg` — which re-verifies the hold itself, so this card cannot make it
 * delete something early even if the list is stale.
 */

interface PendingErasure {
  orgId: string
  name: string
  slug: string
  requestedAtMs: number | null
  holdExpiresAtMs: number | null
  due: boolean
}

interface PendingResponse {
  pending: PendingErasure[]
  dueCount: number
  maxPerRun: number
  truncated: boolean
}

interface RunResponse {
  erased: string[]
  skipped: Array<{ orgId: string; reason?: string }>
  scanned: number
}

const formatWhen = (ms: number | null): string =>
  ms ? new Date(ms).toLocaleString() : '—'

export function PendingErasuresCard() {
  const { data: user } = useUser()
  const [pending, setPending] = useState<PendingResponse | null>(null)
  const [ran, setRan] = useState<RunResponse | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const call = useCallback(
    async (method: 'GET' | 'POST', body?: unknown) => {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/admin/run-erasures', {
        method,
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
      return payload
    },
    [user],
  )

  const refresh = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      setPending((await call('GET')) as PendingResponse)
    } catch (refreshError) {
      setError(String((refreshError as Error).message))
    } finally {
      setBusy(false)
    }
  }, [call])

  // GET is read-only since AGL-2165 (it used to be an alias for POST and
  // ERASED), so loading the queue on mount is safe — and a queue you have to
  // press a button to see is a queue nobody looks at.
  useEffect(() => {
    if (user) void refresh()
  }, [refresh, user])

  const run = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const result = (await call('POST', {
        reason: reason.trim(),
      })) as RunResponse
      setRan(result)
      setReason('')
      await refresh()
    } catch (runError) {
      setError(String((runError as Error).message))
    } finally {
      setBusy(false)
    }
  }, [call, reason, refresh])

  const dueCount = pending?.dueCount ?? 0
  const reasonTooShort = reason.trim().length < 8

  return (
    <CardDisplay
      header={'Pending erasures'}
      // Whoever lands here is being asked to permanently delete a customer's
      // workspace, probably for the first time, against a statutory clock.
      help={docsHelp('platformHealth', {
        anchor: '#pending-erasures',
        excerpt:
          'The queue is read-only; running it early is a deliberate act and ' +
          'is audited with your reason. The 7-day hold is re-verified by the ' +
          'eraser itself, not by this list.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'Erasure requests wait out a 7-day hold and are then executed by ' +
            'the 04:00 UTC job. This is that queue. Running it early is for ' +
            'when a deadline will not wait for the schedule — it deletes ' +
            'workspaces permanently and cannot be undone.'}
        </Typography>

        {error ? <Alert severity="warning">{error}</Alert> : null}

        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Chip
            size="small"
            color={dueCount > 0 ? 'warning' : 'default'}
            label={`${dueCount} due now`}
          />
          <Chip
            size="small"
            label={`${pending?.pending.length ?? 0} in the queue`}
          />
          <Button size="small" disabled={busy} onClick={() => void refresh()}>
            {busy ? 'Working…' : 'Refresh'}
          </Button>
        </Stack>

        {/* A cap that is not stated reads as a total. */}
        {pending?.truncated ? (
          <Alert severity="info">
            {'More requests are queued than are listed here — this is a ' +
              'floor, not the total.'}
          </Alert>
        ) : null}

        {pending && pending.pending.length > 0 ? (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Organization'}</TableCell>
                <TableCell>{'Requested'}</TableCell>
                <TableCell>{'Hold expires'}</TableCell>
                <TableCell>{'State'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pending.pending.map((row) => (
                <TableRow key={row.orgId}>
                  <TableCell>{row.name || row.slug || row.orgId}</TableCell>
                  <TableCell>{formatWhen(row.requestedAtMs)}</TableCell>
                  <TableCell>{formatWhen(row.holdExpiresAtMs)}</TableCell>
                  <TableCell>
                    {/* The only question a staff member has: is this waiting
                        on the hold, or waiting on us? */}
                    <Chip
                      size="small"
                      color={row.due ? 'warning' : 'default'}
                      label={row.due ? 'Due' : 'Holding'}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {pending ? 'Nothing queued.' : 'Loading…'}
          </Typography>
        )}

        <TextField
          size="small"
          label="Reason (recorded on the audit trail)"
          placeholder="e.g. DSAR deadline 2026-08-20, cannot wait for 04:00 UTC"
          value={reason}
          error={reason.length > 0 && reasonTooShort}
          helperText={
            'Required. The route refuses a staff-triggered run without one.'
          }
          onChange={(event) => setReason(event.target.value)}
        />

        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Button
            size="small"
            variant="contained"
            color="error"
            // Disabled on an empty queue as well as an empty reason: a run
            // with nothing due is harmless but writes an audit row claiming
            // someone deleted workspaces early, which is worse than useless.
            disabled={busy || reasonTooShort || dueCount === 0}
            onClick={() => void run()}
          >
            {busy
              ? 'Working…'
              : `Run ${Math.min(dueCount, pending?.maxPerRun ?? 5)} due erasure(s) now`}
          </Button>
          {pending && dueCount > (pending.maxPerRun ?? 5) ? (
            <Typography variant="caption" color="text.secondary">
              {`Batched ${pending.maxPerRun} per run — irreversible work is ` +
                'bounded. Run again for the rest.'}
            </Typography>
          ) : null}
        </Stack>

        {ran ? (
          <Alert severity={ran.skipped.length ? 'warning' : 'success'}>
            {`Erased ${ran.erased.length} of ${ran.scanned} scanned.`}
            {ran.skipped.length
              ? ` Skipped ${ran.skipped.length}: ${ran.skipped
                  .map((entry) => `${entry.orgId} (${entry.reason ?? 'unknown'})`)
                  .join(', ')}. A skip is a durable \`org.erase-failed\` audit row, not a retry.`
              : ''}
          </Alert>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}

export default PendingErasuresCard
