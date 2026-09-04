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
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import type { GridColDef } from '@mui/x-data-grid'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
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
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import { TABLE_ROW_HEIGHT } from '../constants/shared'

export interface IdempotencyClaim {
  id: string
  kind: string | null
  scopeId: string | null
  orgId: string | null
  createdAtMs: number | null
  ageMs: number | null
  stranded: boolean
}

interface ClaimReport {
  claims: IdempotencyClaim[]
  pending: number
  stranded: number
  strandedAfterMs: number
  truncated: boolean
}

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
  const [report, setReport] = useState<ClaimReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const reload = useCallback(() => setReloadKey((key) => key + 1), [])

  useEffect(() => {
    if (!user) return
    let active = true
    void (async () => {
      try {
        const response = await authorizedFetch(
          user,
          '/api/admin/idempotency-claims',
        )
        const body = await response.json().catch(() => null)
        if (!active) return
        if (!response.ok) {
          setError(body?.error ?? 'Idempotency claim lookup failed')
          return
        }
        setError(null)
        setReport(body as ClaimReport)
      } catch {
        if (active) setError('Idempotency claim lookup failed')
      }
    })()
    return () => {
      active = false
    }
  }, [user, reloadKey])

  /* One row grammar, the console's (AGL-2501). */
  const claimColumns: GridColDef[] = useMemo(
    () => [
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
        valueGetter: (_value, row: any) =>
          row.stranded ? 'stranded' : 'in flight',
        renderCell: ({ row }: any) => (
          <Chip
            size="small"
            variant="outlined"
            color={row.stranded ? 'warning' : 'default'}
            label={row.stranded ? 'stranded' : 'in flight'}
          />
        ),
      },
    ],
    [],
  )

  const countPrefix = report?.truncated ? 'at least ' : ''

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

        {report ? (
          <>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
              {/*
                "at least", or nothing at all. Both figures are counted over
                the scan window, so once the probe finds a claim past it they
                are lower bounds — and a lower bound printed as a total is
                what makes a fleet-wide outage read as a quiet minute. Keyed
                on the probe rather than on the window's length, because a
                scan that returned exactly the ceiling is complete and its
                numbers are exact.
              */}
              <Chip
                size="small"
                label={`${countPrefix}${report.pending} in flight or stuck`}
              />
              {/*
                Two numbers, not one. A pending claim is ordinary traffic and
                a stranded one is a stuck key; a single "pending" figure makes
                a busy minute and a dead process look identical.
              */}
              <Chip
                size="small"
                color={report.stranded > 0 ? 'warning' : 'success'}
                label={`${countPrefix}${report.stranded} stranded over ${formatAge(
                  report.strandedAfterMs,
                )}`}
              />
            </Stack>

            {report.truncated ? (
              <Alert severity="warning">
                {'More pending claims than this read returns — the figures ' +
                  'above are floors, and the rows are a sample of the ' +
                  'fleet rather than all of it.'}
              </Alert>
            ) : null}

            {report.claims.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {'Nothing pending. Every claim taken has settled or been released.'}
              </Typography>
            ) : (
              <ListTable
                rows={report.claims}
                columns={claimColumns}
                getRowId={(row: any) => row.id}
                /*
                 * The grid's own footer, which is the console's one footer
                 * (AGL-2501). The route reads a ceiling with a probe and
                 * hands the whole window over, so the page is a client slice
                 * — and this list is at its longest during the incident it
                 * exists to describe, which is precisely when the claims
                 * past the tenth were reachable by nothing.
                 *
                 * A claim has no page of its own, which is a fact about the
                 * ROW and was never a reason to withhold the pager.
                 */
                rowHeight={TABLE_ROW_HEIGHT}
              />
            )}
          </>
        ) : error ? null : (
          <Typography variant="body2" color="text.secondary">
            {'Loading…'}
          </Typography>
        )}
      </Stack>
    </CardDisplay>
  )
}
