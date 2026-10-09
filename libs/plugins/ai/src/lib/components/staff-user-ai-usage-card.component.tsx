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

import { aiAddonName } from '@aglyn/aglyn'
import { buildRoute, Route } from '@aglyn/aglyn/app-utils/console-routes'
import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { mdiOpenInNew } from '@aglyn/shared-data-mdi'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import {
  ListRowActions,
  ListTable,
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import { TABLE_ROW_HEIGHT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Alert, Typography } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { aiUsageMonthLabel } from '../usage/ai-usage-wire'
import type { StaffAiAccountAllowance } from '../usage/staff-org-ai'
import {
  StaffCreditReturnActions,
  StaffCreditReturnDialog,
} from './staff-ai-credit-return.component'

/** One row, as `/api/ai/admin/user` answers it. */
export interface StaffUserAiUsageRow {
  orgId: string
  orgName: string | null
  slug: string | null
  month: string
  credits: number
  requests: number
  refusals: number
}

const orgHref = (orgId: string) => buildRoute(Route.ADMIN_ORG_DETAIL, { orgId })

/** A row's id: one workspace's one month. */
const rowId = (row: StaffUserAiUsageRow) => `${row.orgId}:${row.month}`

/**
 * One row per workspace per month kept. The row opens the workspace; the
 * month sorts by its key, which orders chronologically.
 */
const COLUMNS: GridColDef<StaffUserAiUsageRow>[] = [
  {
    field: 'orgName',
    headerName: 'Organization',
    flex: 1,
    minWidth: 200,
    valueGetter: (_value, row) => row.orgName ?? row.orgId,
  },
  {
    field: 'month',
    headerName: 'Month',
    width: 140,
    valueFormatter: (value: string) => aiUsageMonthLabel(value),
  },
  {
    field: 'credits',
    headerName: 'Credits',
    type: 'number',
    align: 'right',
    headerAlign: 'right',
    width: 110,
    valueFormatter: (value: number) => value.toLocaleString(),
  },
  {
    field: 'requests',
    headerName: 'Requests',
    type: 'number',
    align: 'right',
    headerAlign: 'right',
    width: 110,
    valueFormatter: (value: number) => value.toLocaleString(),
  },
  {
    field: 'refusals',
    headerName: 'Refusals',
    type: 'number',
    align: 'right',
    headerAlign: 'right',
    width: 110,
    valueFormatter: (value: number) => value.toLocaleString(),
  },
  listActionsColumn((row: StaffUserAiUsageRow) => (
    <ListRowActions
      label={row.orgName ?? row.orgId}
      quick={{ icon: mdiOpenInNew.path, label: 'View organization', to: orgHref(row.orgId), newTab: true }}
      items={[]}
    />
  )),
]

/**
 * ONE ACCOUNT'S AI USAGE ACROSS ORGANIZATIONS (AGL-2928), on the staff user
 * page: workspace, month, credits — every month kept, newest first.
 *
 * Read on mount, and it mounts only for a confirmed staff reader: the
 * `staffUser` zone sits inside the page's `StaffOnly`, which renders nothing
 * while the claim is still loading. The route records an access row about
 * this person on every open, so an open the page did not mean to make would
 * be an access nobody made.
 *
 * Above the table, the account's own Free allowance this month — what every
 * free workspace it owns draws on — and in the header the two acts that give
 * credits back to it (AGL-3595).
 */
const StaffUserAiUsageCard = ({ uid }: { uid: string }) => {
  const { data: user } = useUser()
  // Keyed on who is signed in, not on the user object's identity (AGL-2928).
  const signedInUid = user?.uid ?? null
  const userRef = useRef(user)
  userRef.current = user
  const [rows, setRows] = useState<StaffUserAiUsageRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [allowance, setAllowance] = useState<StaffAiAccountAllowance | null>(null)
  // Bumped after a give-back, so the card re-reads the allowance it changed.
  const [version, setVersion] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [returning, setReturning] = useState<'give' | 'reset' | null>(null)
  const router = useRouter()

  useEffect(() => {
    const user = userRef.current
    if (!uid || !signedInUid || !user) return undefined
    let active = true
    setReady(false)
    setError(null)
    void (async () => {
      try {
        const response = await authorizedFetch(
          user,
          `/api/ai/admin/user?uid=${encodeURIComponent(uid)}`,
        )
        const payload = await response.json().catch(() => null)
        if (!active) return
        if (!response.ok) {
          setError(payload?.error ?? 'AI usage lookup failed')
          setRows(null)
        } else {
          setRows((payload?.rows ?? []) as StaffUserAiUsageRow[])
          // Absent from a route older than give-backs.
          setAllowance((payload?.allowance ?? null) as StaffAiAccountAllowance | null)
        }
      } catch {
        if (active) {
          setError('AI usage lookup failed')
          setRows(null)
        }
      } finally {
        if (active) setReady(true)
      }
    })()
    return () => {
      active = false
    }
  }, [uid, signedInUid, version])

  return (
    <CardDisplay
      header={`${aiAddonName()} usage across organizations`}
      help={pluginDocsHelp('aiMonitoring', {
        anchor: '#one-account',
        excerpt:
          'This account’s AI credits in every workspace it belongs to, month by month. Opening it is recorded as a staff access about this person.',
      })}
      HeaderProps={{
        action: (
          <StaffCreditReturnActions
            disabled={!allowance}
            onGive={() => setReturning('give')}
            onReset={() => setReturning('reset')}
          />
        ),
      }}
      contentGutterX
      contentGutterY
    >
      {allowance ? (
        <StaffCreditReturnDialog
          open={returning !== null}
          mode={returning ?? 'give'}
          target={{ uid }}
          workspace={null}
          account={{ used: allowance.usedCredits, limit: allowance.limitCredits }}
          onClose={() => setReturning(null)}
          onReturned={(message) => {
            setReturning(null)
            setNotice(message)
            setVersion((current) => current + 1)
          }}
        />
      ) : null}
      {notice ? (
        <Alert severity="success" onClose={() => setNotice(null)} sx={{ mb: 2 }}>
          {notice}
        </Alert>
      ) : null}
      {allowance ? (
        <Typography variant="body2" sx={{ mb: 1 }}>
          {`Free AI allowance this month: ${allowance.usedCredits.toLocaleString()} of ${allowance.limitCredits.toLocaleString()} credits used across the free workspaces this account owns` +
            (allowance.returnedCredits
              ? ` (${allowance.returnedCredits.toLocaleString()} given back)`
              : '') +
            '.'}
        </Typography>
      ) : null}
      {!ready ? (
        <Typography variant="body2" color="text.secondary">
          {'Loading…'}
        </Typography>
      ) : error || !rows ? (
        <Alert severity="warning">
          {`Could not read this account’s AI usage — ${error ?? 'a failed read'}, not zero usage.`}
        </Alert>
      ) : rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {'No AI usage attributed to this account in any workspace it belongs to.'}
        </Typography>
      ) : (
        // Every month kept is in hand — at most fifty workspaces times the
        // retention window — so the grid pages and sorts the one read, and
        // offers no filter or search: a bounded readout is read whole, not
        // narrowed over the rows it holds (AGL-3321).
        <ListTable
          rows={rows}
          columns={COLUMNS}
          getRowId={rowId}
          rowHeight={TABLE_ROW_HEIGHT}
          onOpen={(_id, row: StaffUserAiUsageRow) => router.push(orgHref(row.orgId))}
          disableColumnFilter
          quickFilter={false}
        />
      )}
    </CardDisplay>
  )
}
StaffUserAiUsageCard.displayName = 'StaffUserAiUsageCard'

export default StaffUserAiUsageCard
