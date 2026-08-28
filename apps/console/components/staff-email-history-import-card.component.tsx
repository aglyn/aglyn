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
import { Alert, Button, LinearProgress, Stack, Typography } from '@mui/material'
import { useCallback, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../constants/docs-links'

interface ImportResult {
  scanned: number
  recorded: number
  pages: number
  nextCursor: string | null
  truncated: boolean
}

/**
 * IMPORTS ALREADY-SENT MAIL INTO THE DELIVERY LOG.
 *
 * ## Why this exists as a control rather than a runbook command
 *
 * The delivery log is written from delivery-webhook events, which exist only
 * for mail sent after the webhook was connected. Everything before that is
 * absent — so the staff Email delivery card said "no delivery events recorded"
 * for a person the sending dashboard plainly showed two delivered emails to.
 * That is worse than no card: it reads as "we never wrote to them".
 *
 * Closing that gap needs a sweep of the provider's own history, and a sweep
 * somebody has to run with `curl` is a capability the product does not
 * actually have. It is here instead.
 *
 * ## It resumes rather than running to completion
 *
 * The route is bounded by pages so a large history cannot hold a request open
 * until it times out, losing every page it had already written. When it stops
 * early it returns a cursor, and this card sends it straight back — so a long
 * import is a sequence of requests that each keep their work, and the
 * progress the operator sees is real rather than a spinner over one call that
 * may be about to fail.
 */
export function StaffEmailHistoryImportCard() {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [busy, setBusy] = useState(false)
  const [totals, setTotals] = useState<{ scanned: number; recorded: number } | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async () => {
    setBusy(true)
    setError(null)
    let scanned = 0
    let recorded = 0
    let cursor: string | null = null
    try {
      const idToken = await (user as any)?.getIdToken?.()
      // A bounded number of round trips, not `while (true)`: a provider that
      // never stops returning a cursor must not turn this button into an
      // unbounded loop against somebody's API quota.
      for (let pass = 0; pass < 25; pass += 1) {
        const response: Response = await fetch(
          '/api/admin/emails/import-history',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
            },
            body: JSON.stringify({ cursor }),
          },
        )
        const payload = (await response.json().catch(() => ({}))) as
          | ImportResult
          | { error?: string }
        if (!response.ok) {
          // The endpoint's own message, never a generic one: "set
          // RESEND_READ_API_KEY" is the entire remedy and the operator has to
          // read it verbatim.
          throw new Error(
            (payload as { error?: string })?.error ?? 'Import failed',
          )
        }
        const result = payload as ImportResult
        scanned += result.scanned
        recorded += result.recorded
        setTotals({ scanned, recorded })
        cursor = result.nextCursor
        if (!result.truncated || !cursor) break
      }
      enqueueSnackbar(
        `Imported ${recorded} delivery record(s) from ${scanned} message(s).`,
        { variant: 'success', persist: false },
      )
    } catch (caught) {
      setError((caught as Error)?.message ?? 'Import failed')
    } finally {
      setBusy(false)
    }
  }, [user, enqueueSnackbar])

  return (
    <CardDisplay
      header="Import delivery history"
      help={docsHelp('staffConsole', {
        anchor: '#email-delivery',
        excerpt:
          'Fills the per-person delivery log with mail sent before the ' +
          'delivery feed was connected.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'The Email delivery card on a user reads a log written from live ' +
            'delivery events, so it knows nothing about mail sent before that ' +
            'feed was connected. This reads the sending provider’s own history ' +
            'and files it under each recipient.'}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {'Safe to run more than once: a message the live feed already ' +
            'recorded is left alone, and no open or click counts are invented ' +
            '— the provider’s history reports only a final status per message.'}
        </Typography>
        {error ? <Alert severity="warning">{error}</Alert> : null}
        {busy ? <LinearProgress /> : null}
        {totals ? (
          <Typography variant="body2">
            {`${totals.recorded} record(s) written from ${totals.scanned} message(s).`}
          </Typography>
        ) : null}
        <Stack direction="row">
          <Button variant="outlined" onClick={run} disabled={busy}>
            {busy ? 'Importing…' : 'Import history'}
          </Button>
        </Stack>
      </Stack>
    </CardDisplay>
  )
}

export default StaffEmailHistoryImportCard
