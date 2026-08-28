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

import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import type { GridColDef } from '@mui/x-data-grid'
import {
  Alert,
  Button,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import {
  activityHref,
  activityTargetLabel,
} from '@aglyn/aglyn/app-utils/activity-presenter'
import { docsHelp } from '../constants/docs-links'
import { TABLE_PAGE_SIZE_DEFAULT } from '../constants/shared'
import { formatStaffTimestamp } from '../utils/staff-timestamps'

export interface HostActivityTableProps {
  hostId: string
}

/**
 * Paginated activity feed (AGL-249): the full `hosts/{hostId}/activity`
 * history on the Setup page — cursor pagination (newest first) instead of
 * the dashboard card's bounded window.
 */
export function HostActivityTable(props: HostActivityTableProps) {
  const { hostId } = props
  /*
   * The link context is the CUSTOMER route's params, and this table also
   * mounts on the staff host page (AGL-1488), whose route has neither. A
   * target with no route to it renders as plain text rather than as an
   * anchor to a URL with a hole in it — `activityHref` already answers
   * undefined for an incomplete context, so nothing here has to decide.
   */
  const { orgSlug, host } = useParams<{ orgSlug?: string; host?: string }>()
  const firestore = useFirestore()
  const [rows, setRows] = useState<any[]>([])
  // The console's shared default and the console's shared menu, so this feed
  // is the same control as every other list (AGL-693).
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const [cursors, setCursors] = useState<QueryDocumentSnapshot[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  /*
   * The `catch` below emptied `rows` and the render then claimed "No activity
   * yet" — a failed read presented as a proven-empty audit log, the same lie
   * the sibling `HostActivityCard` told for a different reason (AGL-2486).
   * "Found nothing" and "could not look" are now separate states.
   */
  const [unreadable, setUnreadable] = useState(false)

  const loadPage = useCallback(
    async (targetPage: number, cursor?: QueryDocumentSnapshot) => {
      setLoading(true)
      try {
        const base = collection(firestore, 'hosts', hostId, 'activity')
        // One extra row detects whether a next page exists.
        const snapshot = await getDocs(
          query(
            base,
            orderBy('createdAt', 'desc'),
            ...(cursor ? [startAfter(cursor)] : []),
            limit(pageSize + 1),
          ),
        )
        const docs = snapshot.docs.slice(0, pageSize)
        setUnreadable(false)
        setRows(docs.map((entry) => ({ $id: entry.id, ...entry.data() })))
        setHasMore(snapshot.docs.length > pageSize)
        setPage(targetPage)
        setCursors((previous) => {
          const next = previous.slice(0, targetPage)
          const last = docs[docs.length - 1]
          if (last) next[targetPage] = last
          return next
        })
      } catch (error) {
        console.error(error)
        setUnreadable(true)
        setRows([])
        setHasMore(false)
      } finally {
        setLoading(false)
      }
    },
    [firestore, hostId, pageSize],
  )

  useEffect(() => {
    void loadPage(0)
  }, [loadPage])

  /*
   * One row grammar, the console's (AGL-693) — the same table the artifact
   * lists use, minus the row click.
   */
  const activityColumns: GridColDef[] = useMemo(
    () => [
      { field: 'action', headerName: 'Action', flex: 1.2, minWidth: 180 },
      {
        field: 'target',
        headerName: 'Target',
        flex: 1.2,
        minWidth: 180,
        valueGetter: (_value, row: any) => activityTargetLabel(row.target),
        renderCell: ({ row }: any) => {
          /*
           * The link context is the CUSTOMER route's params, and this table
           * also mounts on the staff host page (AGL-1488), whose route has
           * neither. A target with no route to it renders as plain text
           * rather than as an anchor to a URL with a hole in it.
           */
          const href =
            orgSlug && host ? activityHref(row, { orgSlug, host }) : undefined
          const label = activityTargetLabel(row.target)
          return href ? (
            <AppLink href={href} color="primary" underline="hover">
              {label}
            </AppLink>
          ) : (
            label
          )
        },
      },
      {
        field: 'actorEmail',
        /*
         * "Who (then)", not "Who".
         *
         * `actorEmail` is a SNAPSHOT taken when the row was written, and an
         * account's address can change afterwards. The stored value is
         * evidence and must not be rewritten to match the current address —
         * an audit trail that mutates is worth less than one that is stale —
         * but a column headed "Who" presents that old address as the person's
         * address today, which is the reading a staffer acts on.
         *
         * So the header carries the tense and the data is left alone.
         */
        headerName: 'Who (then)',
        flex: 1,
        minWidth: 160,
        description:
          'The address this account had when the entry was written. It is ' +
          'not updated if the address changes later.',
        valueGetter: (_value, row: any) => row.actorEmail ?? 'Someone',
      },
      {
        field: 'createdAt',
        headerName: 'When',
        flex: 1,
        minWidth: 180,
        // Sorted on the instant, rendered as a local string: a grid sorting
        // the rendered text puts 12 January before 2 February.
        valueGetter: (_value, row: any) =>
          row.createdAt?.toDate?.()?.getTime?.() ?? 0,
        renderCell: ({ row }: any) =>
          formatStaffTimestamp(row.createdAt?.toDate?.() ?? null),
      },
    ],
    [orgSlug, host],
  )

  return (
    <CardDisplay
      header={'Activity'}
      help={docsHelp('inviteTeammates', {
        anchor: '#activity-log',
        excerpt:
          'Every change made to this site in the console — who did ' +
          'what, and when.',
      })}
      contentGutterX
      contentGutterY
      contentBordered="all"
    >
      <Stack spacing={1.5}>
        {unreadable && !loading ? (
          <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
            <Alert severity="warning" sx={{ width: '100%' }}>
              {'Could not read the activity log. This is NOT the same as ' +
                'nothing having happened — do not read this as an empty ' +
                'history.'}
            </Alert>
            <Button size="small" onClick={() => void loadPage(0)}>
              {'Try again'}
            </Button>
          </Stack>
        ) : rows.length === 0 && !loading ? (
          <Typography variant="body2" color="text.secondary">
            {'No activity yet — changes made in the console appear here.'}
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Action'}</TableCell>
                <TableCell>{'Target'}</TableCell>
                <TableCell>{'Who'}</TableCell>
                <TableCell>{'When'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((entry) => {
                const href =
                  orgSlug && host
                    ? activityHref(entry, { orgSlug, host })
                    : undefined
                const label = activityTargetLabel(entry.target)
                return (
                <TableRow key={entry.$id}>
                  <TableCell>{entry.action}</TableCell>
                  <TableCell>
                    {href ? (
                      <AppLink href={href} color="primary" underline="hover">
                        {label}
                      </AppLink>
                    ) : (
                      label
                    )}
                  </TableCell>
                  <TableCell>{entry.actorEmail ?? 'Someone'}</TableCell>
                  <TableCell>
                    {formatStaffTimestamp(
                      entry.createdAt?.toDate?.() ?? null,
                    )}
                  </TableCell>
                </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
        <ListPagination
          page={page}
          pageSize={pageSize}
          rowCount={rows.length}
          hasMore={hasMore}
          disabled={loading}
          onPageChange={(next) => {
            if (next === page) return
            // `cursors[i]` is the LAST row of page i, so page i+1 resumes
            // after `cursors[i]` and page i resumes after `cursors[i - 1]`.
            void loadPage(next, next > page ? cursors[page] : cursors[next - 1])
          }}
          onPageSizeChange={setPageSize}
        />
      </Stack>
    </CardDisplay>
  )
}
HostActivityTable.displayName = 'HostActivityTable'

export default HostActivityTable
