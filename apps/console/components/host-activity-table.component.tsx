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
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import {
  ListQueryNotices,
  listQueryRefusals,
} from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import { listFilterGridColumns } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { planListQuery } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import { useListColumnSort } from '@aglyn/shared-ui-jsx/hooks/use-list-column-sort'
import type { ListQuerySort } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { listQueryConstraints } from '@aglyn/tenant-feature-instance/hooks/use-list-query'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import type { GridColDef } from '@mui/x-data-grid'
import { Alert, Button, Stack, Typography } from '@mui/material'
import {
  collection,
  limit,
  query,
  startAfter,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { getDocsBounded } from '@aglyn/tenant-feature-instance/hooks/firebase/firestore-bounded-read'
import { useResolvedActivityActors } from '@aglyn/tenant-feature-instance/hooks/use-resolved-activity-actors'
import {
  activityActionLabel,
  activityActorLabel,
  activityHref,
  activityTargetLabel,
} from '@aglyn/aglyn/app-utils/activity-presenter'
import { docsHelp } from '../constants/docs-links'
import { TABLE_PAGE_SIZE_DEFAULT, TABLE_ROW_HEIGHT } from '../constants/shared'
import {
  ACTIVITY_LIST_FILTER_FIELDS,
  ACTIVITY_LIST_FILTER_HEADERS,
} from '../utils/list-filters'
import {
  ACTIVITY_LIST_SORT,
  ACTIVITY_SEARCH_HINT,
  SUBJECT_ACTIVITY_QUERY,
  SUBJECT_ACTIVITY_SORTS,
} from '../utils/activity-list-query'
import { formatStaffTimestamp } from '../utils/staff-timestamps'

/*
 * What the log's Filters panel and search box offer (AGL-3317, AGL-3321):
 * only what the feed's own query can serve, over the whole log — Action,
 * When and the search, every one on the query through `planListQuery`
 * (`ACTIVITY_LIST_QUERY`). The feed is ordered `createdAt` DESC and its
 * cursor is a document in that order, so the plan keeps that order: an
 * action equality (or `in`), a range over the sort field itself, and the
 * `searchTokens` word, each served by its `(field, createdAt DESC)` index.
 *
 * EVERY HEADER SORTS (AGL-3680). When (either way) and Action are the
 * query's order over the whole log (`SUBJECT_ACTIVITY_SORTS`, single-field
 * indexes on a collection with no base); the cursor is a document, so it
 * pages any order. Target and Who are drawn from the row — a label of an
 * object, an address resolved after the read — so they sort the page and
 * say so.
 */

/** Target and Who are derived per row, so they sort the page on screen. */
const HOST_ACTIVITY_PAGE_SORTS = {
  target: (row: any) => activityTargetLabel(row.target) || null,
  actorEmail: (row: any) => activityActorLabel(row) || null,
}
const HOST_ACTIVITY_SORT_HEADERS = { target: 'Target', actorEmail: 'Who (then)' }

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
   * mounts on the staff host page, whose route has neither. A
   * target with no route to it renders as plain text rather than as an
   * anchor to a URL with a hole in it — `activityHref` already answers
   * undefined for an incomplete context, so nothing here has to decide.
   */
  const { orgSlug, host } = useParams<{ orgSlug?: string; host?: string }>()
  const firestore = useFirestore()
  const [rows, setRows] = useState<any[]>([])
  // A uid recorded without an address, named by the address it holds now.
  const shownRows = useResolvedActivityActors(hostId, rows)
  // The console's shared default and the console's shared menu, so this feed
  // is the same control as every other list (AGL-2501).
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
  const gridFilter = useListGridFilter()
  const { clauses, searchWords } = gridFilter
  /*
   * Every clause and the search word as ONE query — or as much of it as one
   * query holds, with the rest refused by name and shown, never matched over
   * the page already read.
   */
  // The header order asked; the plan says which order the query reads in.
  const [askedSort, setAskedSort] = useState<ListQuerySort | null>(ACTIVITY_LIST_SORT)
  const requestKey = JSON.stringify({ clauses, searchWords, askedSort })
  const plan = useMemo(
    () =>
      planListQuery(
        SUBJECT_ACTIVITY_QUERY,
        { clauses, search: searchWords, sort: askedSort },
        nameSearchNormalizers,
      ),
    // The request is data; its JSON is its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requestKey],
  )
  const planConstraints = useMemo(() => listQueryConstraints(plan), [plan])

  const loadPage = useCallback(
    async (targetPage: number, cursor?: QueryDocumentSnapshot) => {
      setLoading(true)
      try {
        const base = collection(firestore, 'hosts', hostId, 'activity')
        // One extra row detects whether a next page exists.
        // Bounded (AGL-3373): a stalled client answers from the cache after
        // a few seconds and is asked to recover, instead of holding `loading`
        // forever.
        const { snapshot } = await getDocsBounded(
          query(
            base,
            // Every predicate, then the plan's one order.
            ...planConstraints,
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
    [firestore, hostId, pageSize, planConstraints],
  )

  useEffect(() => {
    void loadPage(0)
  }, [loadPage])

  /*
   * One row grammar, the console's (AGL-2501) — the same table the artifact
   * lists use, minus the row click.
   */
  const activityColumns: GridColDef[] = useMemo(
    () => [
      {
        field: 'action',
        headerName: 'Action',
        flex: 1.2,
        minWidth: 180,
        // The STORED action stays the cell's value, so the grid sorts on it;
        // what is drawn is its label, so a plugin's code (`ai.job.output`)
        // reads as the sentence its catalog declares.
        renderCell: ({ row }: any) => activityActionLabel(row.action) || '—',
      },
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
          'not updated if the address changes later. An entry that recorded ' +
          'only the account shows the address that account has now.',
        valueGetter: (_value, row: any) => activityActorLabel(row),
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
  const filterColumns = useMemo(
    () =>
      listFilterGridColumns(
        activityColumns,
        ACTIVITY_LIST_FILTER_FIELDS,
        {},
        ACTIVITY_LIST_FILTER_HEADERS,
      ),
    [activityColumns],
  )
  const columnSort = useListColumnSort<any>({
    sorts: SUBJECT_ACTIVITY_SORTS,
    defaultSort: ACTIVITY_LIST_SORT,
    sort: askedSort,
    onSortChange: setAskedSort,
    orderBy: plan.orderBy,
    rows: shownRows,
    pageSorts: HOST_ACTIVITY_PAGE_SORTS,
    headers: HOST_ACTIVITY_SORT_HEADERS,
  })
  const searching = searchWords.some((word) => word.trim())
  const filtered = clauses.length > 0 || searching

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
        <ListFilterChips
          fields={ACTIVITY_LIST_FILTER_FIELDS}
          headers={ACTIVITY_LIST_FILTER_HEADERS}
          clauses={clauses}
          onChange={gridFilter.setClauses}
        />
        <ListQueryNotices
          refused={listQueryRefusals(plan.refused, {
            fields: ACTIVITY_LIST_FILTER_FIELDS,
            headers: ACTIVITY_LIST_FILTER_HEADERS,
          })}
          notices={[...plan.notices, ...columnSort.notices]}
        />
        {searching ? (
          <Typography variant="caption" color="text.secondary">
            {ACTIVITY_SEARCH_HINT}
          </Typography>
        ) : null}
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
        ) : rows.length === 0 && !loading && !filtered ? (
          <Typography variant="body2" color="text.secondary">
            {'No activity yet — changes made in the console appear here.'}
          </Typography>
        ) : (
          <ListTable
            aria-label="Activity"
            rows={columnSort.rows}
            columns={filterColumns}
            /*
             * NO `onOpen`. An audit row is not a record you open: what is worth
             * reaching is its target, which is already a link in the row.
             */
            hideFooter
            rowHeight={TABLE_ROW_HEIGHT}
            /*
             * The grid holds ONE page of a cursor feed, so it must not filter,
             * search or re-sort that page and call it the answer. The panel's
             * clauses and the search word go onto the feed's query instead
             * (see the plan above); a header asks the query for its order, or
             * sorts the page and says so (`columnSort`).
             */
            filterMode="server"
            filterModel={gridFilter.filterModel}
            onFilterModelChange={gridFilter.onFilterModelChange}
            quickFilter
            columnSort={columnSort}
            loading={loading}
            noRowsLabel="No activity matches these filters"
          />
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
