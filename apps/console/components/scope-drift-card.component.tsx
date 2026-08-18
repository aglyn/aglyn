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
import { Alert, Button, Stack, Typography } from '@mui/material'
import { useCallback, useState } from 'react'

import { docsHelp } from '../constants/docs-links'

/**
 * Scope drift: find it, and repair it (AGL-2062).
 *
 * `POST /api/admin/backfill-scope` has always had two callers by design —
 * the scheduler, which is FORCED to a dry run and holds no identity, and a
 * verified staff token, the only caller that may pass `dryRun: false` and
 * actually stamp the missing `visibleTo` tokens. Only the first was ever
 * built. The staff half's entire interface was a curl in
 * `docs/SCOPE_DRIFT.md` needing a hand-harvested `$STAFF_ID_TOKEN`.
 *
 * So the weekly job detected drift and notified staff, the route's own
 * comment said "Notified, not repaired — the repair is a human act", and
 * there was nowhere for that human to act. This is the place.
 *
 * Both buttons drive the SAME route the runbook documents; nothing here
 * re-implements the backfill, and the dry-run/write decision stays the
 * route's. The card's job is the cursor loop and an honest report.
 */

/**
 * Ceiling on pages per run. `ORGS_PER_RUN` bounds one response, so a full
 * pass is a loop — and a loop driven by a server-supplied cursor needs a
 * bound that does not depend on the server ever saying stop. Reported when
 * it is hit rather than silently ending, for the same reason
 * `legacyScanTruncated` is reported: a partial answer that looks complete
 * is worse than no answer.
 */
const MAX_PAGES = 40

interface DriftReport {
  /** Documents the backfill would stamp, summed across every page. */
  planned: number
  /** Unstamped documents per scoped collection, summed. */
  byCollection: Record<string, number>
  /** Member docs whose `scopeTokens` projection is stale. */
  members: number
  /** Pages actually fetched. */
  pages: number
  /** True when {@link MAX_PAGES} stopped the loop before `done`. */
  bounded: boolean
  /**
   * `null` when no page reported on it. `true` means the legacy count is a
   * FLOOR, not the answer — the migrate-or-delete call needs to know which
   * of the two it is reading.
   */
  legacyScanTruncated: boolean | null
}

const EMPTY: DriftReport = {
  planned: 0,
  byCollection: {},
  members: 0,
  pages: 0,
  bounded: false,
  legacyScanTruncated: null,
}

export function ScopeDriftCard() {
  const { data: user } = useUser()
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<DriftReport | null>(null)
  const [stamped, setStamped] = useState<DriftReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  /**
   * One full pass, following `nextCursor` until the route says `done`.
   *
   * `dryRun` is passed through rather than defaulted, because the route
   * treats an ABSENT `dryRun` as a dry run — the write needs an explicit
   * `false`. Restating that here as a default would put a second, weaker
   * copy of the rule in the client.
   */
  const run = useCallback(
    async (dryRun: boolean): Promise<DriftReport> => {
      const idToken = await (user as any)?.getIdToken?.()
      const totals: DriftReport = { ...EMPTY, byCollection: {} }
      let cursor: string | null = null
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const response = await fetch('/api/admin/backfill-scope', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ dryRun, ...(cursor ? { cursor } : {}) }),
        })
        const payload = await response.json().catch(() => ({}))
        // 207 is the route's "finished, and a human must look" — drift was
        // found. It is not an error and must not be thrown away as one.
        if (!response.ok && response.status !== 207) {
          throw new Error(payload?.error ?? `Request failed (${response.status})`)
        }
        totals.pages += 1
        totals.planned += Number(payload?.planned ?? 0)
        totals.members += Number(payload?.drift?.members ?? 0)
        for (const [collection, count] of Object.entries(
          (payload?.drift?.byCollection ?? {}) as Record<string, number>,
        )) {
          totals.byCollection[collection] =
            (totals.byCollection[collection] ?? 0) + Number(count ?? 0)
        }
        if (payload?.legacyScanTruncated === true) {
          totals.legacyScanTruncated = true
        } else if (
          payload?.legacyScanTruncated === false &&
          totals.legacyScanTruncated === null
        ) {
          totals.legacyScanTruncated = false
        }
        cursor = payload?.nextCursor ?? null
        if (payload?.done === true || !cursor) return totals
      }
      totals.bounded = true
      return totals
    },
    [user],
  )

  const scan = useCallback(async () => {
    setBusy(true)
    setError(null)
    setStamped(null)
    try {
      setReport(await run(true))
    } catch (caught) {
      setReport(null)
      setError(caught instanceof Error ? caught.message : 'Scan failed')
    } finally {
      setBusy(false)
    }
  }, [run])

  const stamp = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await run(false)
      setStamped(result)
      // The scan that justified the write is now spent — the counts it
      // showed describe a state that no longer exists. Clearing it forces
      // a fresh scan before another write, rather than leaving a stale
      // number on screen next to an enabled button.
      setReport(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Backfill failed')
    } finally {
      setBusy(false)
    }
  }, [run])

  const rows = report ? Object.entries(report.byCollection) : []

  return (
    <CardDisplay
      header={'Sharing-scope drift'}
      // A repair affordance is the worst kind of card to ship without a route
      // into the docs (AGL-2095): whoever lands here is being asked to perform
      // a corrective action they have almost certainly never performed before,
      // and the two buttons are not equally reversible.
      help={docsHelp('platformHealth', {
        anchor: '#sharing-scope-drift',
        excerpt:
          'Scan is always a dry run; stamping is a deliberate act. A ' +
          'truncated legacy scan makes the count a floor, not the total.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'A document with no sharing scope is invisible to every scoped ' +
            'read — both enforcement layers fail closed on it. The weekly ' +
            'job only reports; stamping is a deliberate act and happens here.'}
        </Typography>

        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          <Button
            size="small"
            variant="outlined"
            disabled={busy}
            onClick={() => void scan()}
          >
            {busy ? 'Working…' : 'Scan for drift'}
          </Button>
          {/* Enabled only by a scan that actually planned writes. The route
              refuses a write without an explicit opt-out of the dry run, and
              this must not become a second, weaker gate in front of it —
              only a narrower one. */}
          <Button
            size="small"
            color="warning"
            variant="outlined"
            disabled={busy || !report || report.planned === 0}
            onClick={() => void stamp()}
          >
            {'Stamp the missing scopes'}
          </Button>
        </Stack>

        {error ? <Alert severity="error">{error}</Alert> : null}

        {stamped ? (
          <Alert severity="success">
            {`Stamped ${stamped.planned} document(s) across ${stamped.pages} ` +
              `page(s). Scan again to confirm it now reports none.`}
          </Alert>
        ) : null}

        {report ? (
          report.planned === 0 ? (
            <Alert severity="success">
              {`No drift — every scoped document across ${report.pages} ` +
                `page(s) carries a sharing scope.`}
            </Alert>
          ) : (
            <Stack spacing={1}>
              <Alert severity="warning">
                {`${report.planned} document(s) are missing their sharing ` +
                  'scope. Nothing has been changed.'}
              </Alert>
              {rows.map(([collection, count]) => (
                <Typography key={collection} variant="body2">
                  {`${collection}: ${count}`}
                </Typography>
              ))}
              {report.members > 0 ? (
                <Typography variant="body2">
                  {`members (stale scopeTokens projection): ${report.members}`}
                </Typography>
              ) : null}
            </Stack>
          )
        ) : null}

        {/* Surfaced, never swallowed: a truncated legacy scan makes the
            count above a FLOOR rather than the answer. */}
        {report?.legacyScanTruncated ? (
          <Alert severity="info">
            {'The legacy scan was truncated, so the counts above are a ' +
              'lower bound rather than the total.'}
          </Alert>
        ) : null}

        {report?.bounded ? (
          <Alert severity="info">
            {`Stopped after ${MAX_PAGES} pages before the route reported ` +
              'done — run the scan again to continue from the start.'}
          </Alert>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
ScopeDriftCard.displayName = 'ScopeDriftCard'

export default ScopeDriftCard
