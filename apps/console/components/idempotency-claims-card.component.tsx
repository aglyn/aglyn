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
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import { TABLE_ROW_HEIGHT } from '../constants/shared'
import useStaffListQuery from '../hooks/use-staff-list-query'
import {
  CLAIM_FILTER_FIELDS,
  CLAIM_FILTER_HEADERS,
  CLAIM_FILTER_OPTIONS,
  CLAIM_SELECT_FIELDS,
} from '../utils/idempotency-claims-list-query'
import StaffListPaginationControls from './staff-list-pagination.component'

export interface IdempotencyClaim {
  id: string
  kind: string | null
  scopeId: string | null
  orgId: string | null
  createdAtMs: number | null
  ageMs: number | null
  stranded: boolean
}

/** The two figures over the whole pending set, from `?view=summary`. */
interface ClaimSummary {
  pending: number
  stranded: number
  /** Pending claims with no claim time, which the age-ordered list cannot show. */
  untimed: number
  strandedAfterMs: number
}

const NO_SEARCH: readonly string[] = []

/** Minutes and hours, because "8100000 ms" is not an operator's unit. */
export function formatAge(ageMs: number | null): string {
  if (ageMs == null || !Number.isFinite(ageMs)) return 'unknown'
  const minutes = Math.floor(ageMs / 60000)
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)} days`
}

/**
 * IDEMPOTENCY CLAIMS THAT NEVER SETTLED (AGL-2329, item 3).
 *
 * `api-idempotency.ts` writes `status: 'pending'` at claim and `'done'` at
 * settlement, and names the failure in its own docblock: *"A process killed
 * between the claim and the record leaves a key stuck here."* Only
 * `response`, `responseStatus` and `expiresAt` were ever read — and
 * `expiresAt` is a TTL policy, not code — so `status`, the one field that
 * answers "which keys are stuck", was queried by nothing.
 *
 * What that costs is small and invisible, which is why it survived: the
 * customer's next attempt uses a fresh key and works, so the only trace is a
 * refused attempt and a ticket that reads "it said it was busy". This card
 * turns that into a number an operator can look at on a bad day, beside the
 * other probes on this page.
 *
 * READ-ONLY, deliberately, and there is no delete button. Releasing a claim
 * whose request is genuinely in flight is a duplicate charge — the exact
 * outcome the module fails closed to prevent — so the decision stays with a
 * human who can check Stripe first.
 */
export default function IdempotencyClaimsCard() {
  const { data: user } = useUser()
  const [summary, setSummary] = useState<ClaimSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!user) return
    let active = true
    void (async () => {
      try {
        const response = await authorizedFetch(
          user,
          '/api/admin/idempotency-claims?view=summary',
        )
        const body = await response.json().catch(() => null)
        if (!active) return
        if (!response.ok) {
          setError(body?.error ?? 'Idempotency claim lookup failed')
          return
        }
        setSummary(body as ClaimSummary)
      } catch {
        if (active) setError('Idempotency claim lookup failed')
      }
    })()
    return () => {
      active = false
    }
  }, [user, reloadKey])

  /*
   * The Filters panel, SERVED by the route (AGL-3321): every clause is on
   * one query over the pending claims, oldest first, and each page the
   * footer turns is a page of the narrowed list. See
   * `utils/idempotency-claims-list-query.ts`.
   */
  const gridFilter = useListGridFilter({ selectFields: CLAIM_SELECT_FIELDS })
  const onError = useCallback(
    (reason: unknown) =>
      setError(
        reason instanceof Error && reason.message
          ? reason.message
          : 'Idempotency claim lookup failed',
      ),
    [],
  )
  const claims = useStaffListQuery<IdempotencyClaim>({
    endpoint: '/api/admin/idempotency-claims',
    clauses: gridFilter.clauses,
    // No search box: every value on a claim is an identifier, which the
    // panel's exact filters match (`utils/idempotency-claims-list-query.ts`).
    search: NO_SEARCH,
    onError,
  })
  const { refresh } = claims
  const reload = useCallback(() => {
    setError(null)
    setReloadKey((key) => key + 1)
    refresh()
  }, [refresh])

  /* One row grammar, the console's (AGL-2501). */
  const claimColumns: GridColDef[] = useMemo(
    () => listFilterGridColumns([
      {
        field: 'kind',
        headerName: 'Operation',
        flex: 1,
        minWidth: 160,
        // `kind` and `scopeId` say WHICH operation is stuck and for whom.
        // Both were written at claim time and read by nothing until this
        // card — a hex digest names no incident.
        valueGetter: (_value, row: any) => row.kind ?? '—',
      },
      {
        field: 'scopeId',
        headerName: 'Scope',
        flex: 1,
        minWidth: 160,
        valueGetter: (_value, row: any) => row.scopeId ?? '—',
        renderCell: ({ row }: any) => (
          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
            {row.scopeId ?? '—'}
          </Typography>
        ),
      },
      {
        field: 'orgId',
        headerName: 'Org',
        flex: 1,
        minWidth: 150,
        valueGetter: (_value, row: any) => row.orgId ?? '—',
        renderCell: ({ row }: any) => (
          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
            {row.orgId ?? '—'}
          </Typography>
        ),
      },
      {
        field: 'ageMs',
        headerName: 'Age',
        flex: 0.6,
        minWidth: 110,
        align: 'right',
        headerAlign: 'right',
        // Sorted on the number, rendered as a duration — sorting the
        // rendered text would put "9m" after "10h".
        valueGetter: (_value, row: any) => row.ageMs ?? 0,
        renderCell: ({ row }: any) => formatAge(row.ageMs),
      },
      {
        field: 'stranded',
        headerName: 'State',
        flex: 0.7,
        minWidth: 120,
        align: 'right',
        headerAlign: 'right',
        // The select's value, so a sort and an export read its choices.
        valueGetter: (_value, row: any) =>
          row.stranded ? 'stranded' : 'inFlight',
        renderCell: ({ row }: any) => (
          <Chip
            size="small"
            variant="outlined"
            color={row.stranded ? 'warning' : 'default'}
            label={row.stranded ? 'stranded' : 'in flight'}
          />
        ),
      },
    ], CLAIM_FILTER_FIELDS, CLAIM_FILTER_OPTIONS, CLAIM_FILTER_HEADERS),
    [],
  )

  return (
    <CardDisplay
      header={'Idempotency claims'}
      help={docsHelp('platformHealth', {
        anchor: '#idempotency-claims',
        excerpt:
          'A claim still held long after its work should have finished is a process that died between claiming and releasing — the operation it guards is blocked, because every retry finds the claim and backs off.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Stack
          useFlexGap
          direction="row"
          spacing={2}
          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
            {'A claim is taken before a payment call and settled after it. One ' +
              'that never settled is a key the customer cannot reuse until it ' +
              'expires — their retry with a fresh key works, so the only ' +
              'symptom is a refused attempt.'}
          </Typography>
          <Button size="small" onClick={reload}>
            {'Refresh'}
          </Button>
        </Stack>

        {error ? <Alert severity="error">{error}</Alert> : null}
        {!summary && !error ? (
          <Typography variant="body2" color="text.secondary">
            {'Loading…'}
          </Typography>
        ) : null}

        {summary ? (
          <Stack useFlexGap direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            {/*
              Two numbers, not one. A pending claim is ordinary traffic and
              a stranded one is a stuck key; a single "pending" figure makes
              a busy minute and a dead process look identical. Both are
              counted over every pending claim, not over a page of them.
            */}
            <Chip size="small" label={`${summary.pending} in flight or stuck`} />
            <Chip
              size="small"
              color={summary.stranded > 0 ? 'warning' : 'success'}
              label={`${summary.stranded} stranded over ${formatAge(
                summary.strandedAfterMs,
              )}`}
            />
          </Stack>
        ) : null}

        {summary && summary.untimed > 0 ? (
          <Alert severity="warning">
            {`${summary.untimed} pending ${
              summary.untimed === 1 ? 'claim carries' : 'claims carry'
            } no claim time, so ${
              summary.untimed === 1 ? 'it has' : 'they have'
            } no age and ${
              summary.untimed === 1 ? 'is' : 'are'
            } not listed below. Each is a key that was taken without the ` +
              'time it was taken, by a writer that predates this card.'}
          </Alert>
        ) : null}

        {summary && summary.pending === 0 && !claims.filtering ? (
          <Typography variant="body2" color="text.secondary">
            {'Nothing pending. Every claim taken has settled or been released.'}
          </Typography>
        ) : (
          <>
            <ListFilterChips
              fields={CLAIM_FILTER_FIELDS}
              headers={CLAIM_FILTER_HEADERS}
              options={CLAIM_FILTER_OPTIONS}
              clauses={gridFilter.clauses}
              onChange={gridFilter.setClauses}
            />
            <ListQueryNotices
              refused={listQueryRefusals(claims.refused, {
                fields: CLAIM_FILTER_FIELDS,
                headers: CLAIM_FILTER_HEADERS,
                options: CLAIM_FILTER_OPTIONS,
              })}
              notices={claims.notices}
            />
            <ListTable
              aria-label="Idempotency claims"
              rows={claims.rows}
              columns={claimColumns}
              loading={claims.loading}
              filterMode="server"
              filterModel={gridFilter.filterModel}
              onFilterModelChange={gridFilter.onFilterModelChange}
              noRowsLabel="No claims match these filters"
              getRowId={(row: IdempotencyClaim) => row.id}
              rowHeight={TABLE_ROW_HEIGHT}
              /*
               * One page of a cursor walk, turned by the console's shared
               * footer below: the grid neither slices it nor filters it. This
               * list is at its longest during the incident it exists to
               * describe, which is precisely when a window would hide the
               * claims past it.
               *
               * A claim has no page of its own, which is a fact about the
               * ROW and was never a reason to withhold the pager.
               */
              hideFooter
              // The rows keep the query's order; a header sort would order
              // only the page on screen.
              disableColumnSorting
            />
            <StaffListPaginationControls
              pagination={claims}
              shown={claims.rows.length}
              sizeMenu={false}
            />
          </>
        )}
      </Stack>
    </CardDisplay>
  )
}
