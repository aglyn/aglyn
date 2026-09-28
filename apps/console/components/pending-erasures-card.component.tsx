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
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import {
  ListQueryNotices,
  listQueryRefusals,
} from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import { listFilterGridColumns } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import type { GridColDef } from '@mui/x-data-grid'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import {
  Alert,
  Button,
  Chip,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { docsHelp } from '../constants/docs-links'
import { TABLE_ROW_HEIGHT } from '../constants/shared'
import useStaffListQuery from '../hooks/use-staff-list-query'
import {
  ERASURE_FILTER_FIELDS,
  ERASURE_FILTER_HEADERS,
  ERASURE_FILTER_OPTIONS,
  ERASURE_SEARCH_HINT,
  ERASURE_SELECT_FIELDS,
} from '../utils/pending-erasures-list-query'
import StaffListPaginationControls from './staff-list-pagination.component'

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

/** The figures over the whole queue, from `?view=summary`. */
interface QueueSummary {
  queued: number
  dueCount: number
  maxPerRun: number
  /**
   * The PEOPLE waiting (AGL-2623) — erasure requests a workspace admin filed
   * for one person, drained by the same run. Null when the count could not
   * be taken, which is not the same as none.
   */
  people?: { pending: number; truncated: boolean; maxPerRun: number } | null
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
  const [pending, setPending] = useState<QueueSummary | null>(null)
  const [ran, setRan] = useState<RunResponse | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /*
   * The queue, every Filters-panel clause and the search word SERVED by the
   * route on one query (AGL-3321), oldest request first; each page the
   * footer turns is a page of the narrowed queue. See
   * `utils/pending-erasures-list-query.ts`.
   */
  const gridFilter = useListGridFilter({ selectFields: ERASURE_SELECT_FIELDS })
  const onListError = useCallback(
    (listError: unknown) =>
      setError(
        listError instanceof Error && listError.message
          ? listError.message
          : 'The erasure queue could not be read',
      ),
    [],
  )
  const queue = useStaffListQuery<PendingErasure>({
    endpoint: '/api/admin/run-erasures',
    clauses: gridFilter.clauses,
    search: gridFilter.searchWords,
    onError: onListError,
  })
  const { refresh: refreshQueue } = queue

  const call = useCallback(
    async (method: 'GET' | 'POST', body?: unknown) => {
      const path =
        method === 'GET' ? '/api/admin/run-erasures?view=summary' : '/api/admin/run-erasures'
      const response = await authorizedFetch(user, path, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
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
      setPending((await call('GET')) as QueueSummary)
    } catch (refreshError) {
      setError(String((refreshError as Error).message))
    } finally {
      setBusy(false)
    }
  }, [call])

  const reload = useCallback(async () => {
    refreshQueue()
    await refresh()
  }, [refresh, refreshQueue])

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
      await reload()
    } catch (runError) {
      setError(String((runError as Error).message))
    } finally {
      setBusy(false)
    }
  }, [call, reason, reload])

  const dueCount = pending?.dueCount ?? 0
  const peopleWaiting = pending?.people?.pending ?? 0
  const reasonTooShort = reason.trim().length < 8

  /* One row grammar, the console's (AGL-2501). */
  const erasureColumns: GridColDef[] = useMemo(
    () => listFilterGridColumns([
      {
        field: 'name',
        headerName: 'Organization',
        flex: 1.4,
        minWidth: 200,
        valueGetter: (_value, row: any) => row.name || row.slug || row.orgId,
      },
      {
        field: 'requestedAtMs',
        headerName: 'Requested',
        flex: 1,
        minWidth: 170,
        // Sorted on the instant, rendered as a date — a grid sorting the
        // rendered text would order it alphabetically.
        valueGetter: (_value, row: any) => row.requestedAtMs ?? 0,
        renderCell: ({ row }: any) => formatWhen(row.requestedAtMs),
      },
      {
        field: 'holdExpiresAtMs',
        headerName: 'Hold expires',
        flex: 1,
        minWidth: 170,
        valueGetter: (_value, row: any) => row.holdExpiresAtMs ?? 0,
        renderCell: ({ row }: any) => formatWhen(row.holdExpiresAtMs),
      },
      {
        field: 'due',
        headerName: 'State',
        flex: 0.7,
        minWidth: 120,
        // The only question a staff member has: is this waiting on the hold,
        // or waiting on us?
        // The select's value, so a sort and an export read its choices.
        valueGetter: (_value, row: any) => (row.due ? 'due' : 'holding'),
        renderCell: ({ row }: any) => (
          <Chip
            size="small"
            color={row.due ? 'warning' : 'default'}
            label={row.due ? 'Due' : 'Holding'}
          />
        ),
      },
    ], ERASURE_FILTER_FIELDS, ERASURE_FILTER_OPTIONS, ERASURE_FILTER_HEADERS),
    [],
  )

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
          {/* Counted over the whole queue, not the page on screen. */}
          <Chip
            size="small"
            color={dueCount > 0 ? 'warning' : 'default'}
            label={`${dueCount} due now`}
          />
          <Chip size="small" label={`${pending?.queued ?? 0} in the queue`} />
          {/*
            The people beside the workspaces: a person's request has no hold
            and runs with the next scheduled run, so the number is the whole
            fact and needs no "due" split.
          */}
          {pending?.people ? (
            <Chip
              size="small"
              color={pending.people.pending > 0 ? 'warning' : 'default'}
              label={`${pending.people.truncated ? 'at least ' : ''}${pending.people.pending} ${
                pending.people.pending === 1 ? 'person' : 'people'
              } waiting`}
            />
          ) : null}
          <Button size="small" disabled={busy} onClick={() => void reload()}>
            {busy ? 'Working…' : 'Refresh'}
          </Button>
        </Stack>

        {pending && pending.queued === 0 && !queue.filtering ? (
          <Typography variant="body2" color="text.secondary">
            {'Nothing queued.'}
          </Typography>
        ) : pending ? (
          <>
            <ListFilterChips
              fields={ERASURE_FILTER_FIELDS}
              headers={ERASURE_FILTER_HEADERS}
              options={ERASURE_FILTER_OPTIONS}
              clauses={gridFilter.clauses}
              onChange={gridFilter.setClauses}
            />
            <ListQueryNotices
              refused={listQueryRefusals(queue.refused, {
                fields: ERASURE_FILTER_FIELDS,
                headers: ERASURE_FILTER_HEADERS,
                options: ERASURE_FILTER_OPTIONS,
              })}
              notices={queue.notices}
            />
            {gridFilter.searchWords.join('').trim() ? (
              <Typography variant="caption" color="text.secondary">
                {ERASURE_SEARCH_HINT}
              </Typography>
            ) : null}
            <ListTable
              aria-label="Pending erasures"
              rows={queue.rows}
              columns={erasureColumns}
              loading={queue.loading}
              filterMode="server"
              quickFilter
              filterModel={gridFilter.filterModel}
              onFilterModelChange={gridFilter.onFilterModelChange}
              noRowsLabel="No requests match these filters"
              getRowId={(row: PendingErasure) => row.orgId}
              rowHeight={TABLE_ROW_HEIGHT}
              /*
               * One page of a cursor walk, turned by the console's shared
               * footer below. This queue is longest exactly when a statutory
               * deadline is being missed, which is when a fixed window would
               * hide the requests past it.
               *
               * A row here has no detail page of its own, which is why
               * nothing navigates. That is a statement about the ROW and was
               * never a reason to withhold the pager.
               */
              hideFooter
              // The rows keep the queue's order; a header sort would order
              // only the page on screen.
              disableColumnSorting
            />
            <StaffListPaginationControls
              pagination={queue}
              shown={queue.rows.length}
              sizeMenu={false}
            />
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {'Loading…'}
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
            // A person waiting counts as due — their request has no hold.
            disabled={busy || reasonTooShort || (dueCount === 0 && peopleWaiting === 0)}
            onClick={() => void run()}
          >
            {busy
              ? 'Working…'
              : dueCount > 0
                ? `Run ${Math.min(dueCount, pending?.maxPerRun ?? 5)} due erasure(s) now` +
                  (peopleWaiting > 0 ? ` and ${peopleWaiting} waiting person(s)` : '')
                : `Run ${peopleWaiting} waiting person erasure(s) now`}
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
