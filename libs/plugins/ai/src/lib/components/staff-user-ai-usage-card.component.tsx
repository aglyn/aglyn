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
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import { aiUsageMonthLabel } from '../usage/ai-usage-wire'

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

/**
 * ONE ACCOUNT'S AI USAGE ACROSS ORGANIZATIONS (AGL-2928), on the staff user
 * page: workspace, month, credits — every month kept, newest first.
 *
 * Read on mount, and it mounts only for a confirmed staff reader: the
 * `staffUser` zone sits inside the page's `StaffOnly`, which renders nothing
 * while the claim is still loading. The route records an access row about
 * this person on every open, so an open the page did not mean to make would
 * be an access nobody made.
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
  // One row per workspace per month kept, paged in memory over the one read.
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const visible = (rows ?? []).slice(page * pageSize, page * pageSize + pageSize)

  useEffect(() => {
    const user = userRef.current
    if (!uid || !signedInUid || !user) return undefined
    let active = true
    setReady(false)
    setError(null)
    setPage(0)
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
  }, [uid, signedInUid])

  return (
    <CardDisplay
      header={`${aiAddonName()} usage across organizations`}
      help={pluginDocsHelp('aiMonitoring', {
        anchor: '#one-account',
        excerpt:
          'This account’s AI credits in every workspace it belongs to, month by month. Opening it is recorded as a staff access about this person.',
      })}
      contentGutterX
      contentGutterY
    >
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
        <>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Organization'}</TableCell>
                <TableCell>{'Month'}</TableCell>
                <TableCell align="right">{'Credits'}</TableCell>
                <TableCell align="right">{'Requests'}</TableCell>
                <TableCell align="right">{'Refusals'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((row) => (
                <TableRow key={`${row.orgId}-${row.month}`}>
                  <TableCell>
                    <AppLink
                      href={buildRoute(Route.ADMIN_ORG_DETAIL, { orgId: row.orgId })}
                      color="primary"
                      underline="hover"
                    >
                      {row.orgName ?? row.orgId}
                    </AppLink>
                  </TableCell>
                  <TableCell>{aiUsageMonthLabel(row.month)}</TableCell>
                  <TableCell align="right">{row.credits.toLocaleString()}</TableCell>
                  <TableCell align="right">{row.requests.toLocaleString()}</TableCell>
                  <TableCell align="right">{row.refusals.toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <ListPagination
            page={page}
            pageSize={pageSize}
            rowCount={visible.length}
            count={rows.length}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size)
              setPage(0)
            }}
          />
        </>
      )}
    </CardDisplay>
  )
}
StaffUserAiUsageCard.displayName = 'StaffUserAiUsageCard'

export default StaffUserAiUsageCard
