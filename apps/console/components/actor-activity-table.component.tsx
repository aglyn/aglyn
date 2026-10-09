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

import { activityActorLabel } from '@aglyn/aglyn/app-utils/activity-presenter'
import { describeActivity } from '@aglyn/aglyn/app-utils/activity-labels'
import { listPluginActivityFilters } from '@aglyn/aglyn'
import { type HelpTipContent } from '@aglyn/shared-ui-jsx'
import {
  type ListFilterClause,
  listFilterGridColumns,
  upsertListFilterClause,
} from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import type { ListQueryRefusal } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import { useListColumnSort } from '@aglyn/shared-ui-jsx/hooks/use-list-column-sort'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import {
  ListQueryNotices,
  listQueryRefusals,
} from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import {
  ACTIVITY_LIST_FILTER_FIELDS,
  ACTIVITY_LIST_FILTER_HEADERS,
} from '../utils/list-filters'
import {
  ACTIVITY_LIST_SORT,
  ACTIVITY_SEARCH_HINT,
} from '../utils/activity-list-query'
import type { GridColDef } from '@mui/x-data-grid'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { Chip, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ActivityTable from './activity-table.component'
import { staffActivityLinks } from '../utils/activity-details'
import { formatWireTimestamp } from '../utils/staff-timestamps'
import { TABLE_PAGE_SIZE_DEFAULT } from '../constants/shared'

export interface ActorActivityEntry {
  $id: string
  scopeType: 'host' | 'org' | 'unknown'
  scopeId: string
  action?: string
  target?: Record<string, unknown> | null
  actorId?: string | null
  actorEmail?: string | null
  /** The address `actorId` holds now, for a row that recorded none (AGL-3369). */
  actorEmailNow?: string | null
  apiKeyName?: string
  createdAt?: { seconds: number } | null
  /** The site's or organization's name, where the route resolved it (AGL-3660). */
  scopeName?: string | null
}

/*
 * EVERY HEADER SORTS (AGL-3680). When is the route's own order, newest
 * first, over the whole feed — the only order either route reads: the staff
 * feed is a collection-group query on `actorId`, where any other order would
 * cost a composite per direction, and the member feed merges its subjects by
 * the clock. Action, Target, Who and Where sort the page on screen and say
 * so: Where is the document's path, Target and Who are drawn from the row,
 * and Action on the query is not worth two collection-group composites on
 * one person's log.
 */
const ACTOR_ACTIVITY_SORTS = [ACTIVITY_LIST_SORT]
const ACTOR_ACTIVITY_SORT_HEADERS = {
  action: 'Action',
  target: 'Target',
  actorEmail: 'Who (then)',
  scopeId: 'Where',
}

export interface ActorActivityTableProps {
  /** The route to page through. The component appends `cursor`/`pageSize`. */
  endpoint: string
  header: string
  /** The card's `?`. Passed in because the docs topic differs by surface. */
  help?: HelpTipContent
  description?: string
  /** Site name by host id, so a row can say where rather than which id. */
  scopeNames?: Record<string, string | undefined>
  /**
   * The staff user page (AGL-3660): a row's details add the stored code and
   * path and link to the staff pages. The team member page leaves it off.
   */
  staff?: boolean
}

/**
 * What one person did, paginated.
 *
 * The CARD, the grid, the toolbar, the empty and unreadable states and the
 * footer are `ActivityTable`'s (AGL-2501) — this owns the columns and the
 * cursor walk, which is the half that is actually about one person's
 * activity.
 *
 * Paged by the cursor the route hands back — a document path on the staff
 * feed, a merge position on the member feed — and a visited cursor stack
 * gives Back.
 *
 * Every clause in the grid's Filters panel, every group chip and the search
 * box go to the route, which puts them all on its query (AGL-3321); a change
 * to any of them is a different query, so the walk starts again at page one.
 * What the route could not put on the query it says, and the table shows.
 *
 * "Found nothing" and "could not look" are separate states, for the same
 * reason the host table separates them: a failed read rendered as an empty
 * audit log is a lie with a clean-looking face.
 */
export function ActorActivityTable(props: ActorActivityTableProps) {
  const { endpoint, header, help, description, scopeNames, staff = false } = props
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  const uid = (user as { uid?: string } | undefined)?.uid ?? null

  const [rows, setRows] = useState<ActorActivityEntry[]>([])
  // Shared default, shared menu (AGL-2501).
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const [cursors, setCursors] = useState<Array<string | null>>([null])
  const [page, setPage] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [unreadable, setUnreadable] = useState(false)
  const [refused, setRefused] = useState<ListQueryRefusal[]>([])
  const [notices, setNotices] = useState<string[]>([])

  /*
   * The grid's Filters panel and search box, bound to clauses the list
   * holds. `action` stays a typed field, not a select: most actions are the
   * prose sentence their writer stored, so there is no catalog to pick
   * from; the group chips above are the named slices that DO have one.
   */
  const [clauses, setClauses] = useState<ListFilterClause[]>([])
  const [searchWords, setSearchWords] = useState<string[]>([])
  const gridFilter = useListGridFilter({
    clauses,
    onChange: setClauses,
    search: { words: searchWords, onChange: setSearchWords },
  })
  const search = searchWords.join(' ').trim()

  /*
   * Only the newest request may write: two page clicks in quick succession,
   * or a page change racing the reload a filter change triggers, otherwise
   * land in whatever order the network returns them.
   */
  const requestRef = useRef(0)
  const loadPage = useCallback(
    async (targetPage: number, cursor: string | null) => {
      const request = (requestRef.current += 1)
      const current = () => requestRef.current === request
      setLoading(true)
      try {
        const url = new URL(endpoint, window.location.origin)
        url.searchParams.set('pageSize', String(pageSize))
        if (clauses.length) {
          url.searchParams.set(
            'filters',
            JSON.stringify(clauses.map(({ field, op, value }) => ({ field, op, value }))),
          )
        }
        if (search) url.searchParams.set('search', search)
        // The cursor is where the route's walk under this same query ended.
        // Every change of query resets the cursors and asks for page 0 with
        // none, so a cursor never crosses from one query's walk to another.
        if (cursor) url.searchParams.set('cursor', cursor)
        const response = await authorizedFetch(userRef.current, url.toString())
        if (!current()) return
        if (!response.ok) {
          setUnreadable(true)
          setRows([])
          return
        }
        const payload = (await response.json()) as {
          entries?: ActorActivityEntry[]
          nextCursor?: string | null
          refused?: ListQueryRefusal[]
          notices?: string[]
        }
        if (!current()) return
        setUnreadable(false)
        setRows(payload?.entries ?? [])
        setNextCursor(payload?.nextCursor ?? null)
        setRefused(payload?.refused ?? [])
        setNotices(payload?.notices ?? [])
        setPage(targetPage)
      } catch {
        if (!current()) return
        setUnreadable(true)
        setRows([])
      } finally {
        if (current()) setLoading(false)
      }
    },
    [endpoint, pageSize, clauses, search],
  )

  // A new filter, search or page size is a different query: page one, no
  // cursor.
  useEffect(() => {
    if (!uid) return
    setCursors([null])
    void loadPage(0, null)
  }, [uid, loadPage])

  /*
   * One chip per plugin-declared action group (AGL-2929, AGL-2940): a
   * plugin's rows are stored as catalog codes, so a chip is Action `is any
   * of` those codes — a clause like any other, on the route's query, shown
   * with the others and removed like them.
   */
  const groupFilters = listPluginActivityFilters()
  const actionClause = clauses.find((clause) => clause.field === 'action')
  const groupValue = (actions: readonly string[]) => actions.join(',')

  const describe = (entry: ActorActivityEntry) =>
    describeActivity(entry, {
      hosts:
        entry.scopeType === 'host'
          ? { [entry.scopeId]: entry.scopeName ?? scopeNames?.[entry.scopeId] }
          : {},
    })

  // The site's or organization's name where the route resolved it
  // (AGL-3660); a site the route could not name keeps its id.
  const scopeLabel = (entry: ActorActivityEntry): string => {
    if (entry.scopeType === 'org') {
      return entry.scopeName ? `${entry.scopeName} (organization)` : 'Organization'
    }
    if (entry.scopeType === 'host') {
      return entry.scopeName ?? scopeNames?.[entry.scopeId] ?? entry.scopeId
    }
    return '—'
  }

  /* One row grammar, the console's (AGL-2501) — the same table, no row click. */
  const activityColumns: GridColDef[] = useMemo(
    () => listFilterGridColumns([
      {
        field: 'action',
        headerName: 'Action',
        flex: 1.2,
        minWidth: 180,
        // The STORED action stays the cell's value — it is what the route's
        // equality filter compares — and the sentence is only what is drawn,
        // so an AI code reads as words without breaking the filter. The code
        // itself is the tooltip (AGL-3660).
        valueGetter: (_value, row: ActorActivityEntry) => row.action ?? '—',
        renderCell: ({ row }: any) => {
          const described = describe(row)
          return (
            <span title={described.code ?? undefined}>{described.action}</span>
          )
        },
      },
      {
        field: 'target',
        headerName: 'Target',
        flex: 1.2,
        minWidth: 180,
        // A rendered summary of an object, not a stored scalar — there is
        // nothing for a query to compare.
        filterable: false,
        valueGetter: (_value, row: ActorActivityEntry) => describe(row).target,
      },
      {
        field: 'actorEmail',
        /*
         * Every row here is this account's, but not under one address: the
         * address is a snapshot of the one it had when the row was written,
         * and a key the account holds writes under the key's name (AGL-3376).
         */
        headerName: 'Who (then)',
        flex: 1,
        minWidth: 160,
        description:
          'The address this account had when the entry was written, or the ' +
          'API key it acted through.',
        valueGetter: (_value, row: ActorActivityEntry) => activityActorLabel(row),
      },
      {
        field: 'scopeId',
        headerName: 'Where',
        flex: 0.9,
        minWidth: 150,
        // Derived from the document's PATH, not stored on it, so no query can
        // narrow by site. Filtering here would mean writing the scope onto
        // every entry.
        filterable: false,
        valueGetter: (_value, row: ActorActivityEntry) => scopeLabel(row),
        renderCell: ({ row }: any) => (
          <Chip size="small" variant="outlined" label={scopeLabel(row)} />
        ),
      },
      {
        field: 'createdAt',
        headerName: 'When',
        flex: 1,
        minWidth: 180,
        // `type: 'date'` is what gives the panel a date PICKER rather than a
        // free-text box for a value the route parses as a day.
        type: 'date',
        // Sorted on the instant the wire carried, rendered as a local
        // string: a grid sorting the rendered text orders it alphabetically.
        valueGetter: (_value, row: ActorActivityEntry) =>
          row.createdAt?.seconds ? new Date(row.createdAt.seconds * 1000) : null,
        renderCell: ({ row }: any) => formatWireTimestamp(row.createdAt),
      },
    ], ACTIVITY_LIST_FILTER_FIELDS),
    // `scopeLabel` closes over `scopeNames`, which is the only thing that
    // moves it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopeNames],
  )

  const pageSorts = useMemo(
    () => ({
      action: (row: ActorActivityEntry) => describe(row).action || null,
      target: (row: ActorActivityEntry) => describe(row).target || null,
      actorEmail: (row: ActorActivityEntry) => activityActorLabel(row) || null,
      scopeId: (row: ActorActivityEntry) => scopeLabel(row),
    }),
    // `scopeLabel` closes over `scopeNames`, which is the only thing that
    // moves it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopeNames],
  )
  const columnSort = useListColumnSort<ActorActivityEntry>({
    sorts: ACTOR_ACTIVITY_SORTS,
    defaultSort: ACTIVITY_LIST_SORT,
    rows,
    pageSorts,
    headers: ACTOR_ACTIVITY_SORT_HEADERS,
  })

  const filtering = clauses.length > 0 || Boolean(search)
  const refusals = listQueryRefusals(refused, {
    fields: ACTIVITY_LIST_FILTER_FIELDS,
    headers: ACTIVITY_LIST_FILTER_HEADERS,
  })
  return (
    <ActivityTable
      header={header}
      help={help}
      description={description}
      toolbar={groupFilters.map(({ group, actions }) => {
        const pressed =
          actionClause?.op === 'isAnyOf' && actionClause.value === groupValue(actions)
        return (
          <Chip
            key={group.id}
            size="small"
            label={group.label}
            clickable
            color={pressed ? 'primary' : 'default'}
            variant={pressed ? 'filled' : 'outlined'}
            aria-pressed={pressed}
            onClick={() =>
              setClauses((current) =>
                upsertListFilterClause(
                  current,
                  'action',
                  pressed
                    ? null
                    : { field: 'action', op: 'isAnyOf', value: groupValue(actions) },
                ),
              )
            }
          />
        )
      })}
      filterChips={
        <ListFilterChips
          fields={ACTIVITY_LIST_FILTER_FIELDS}
          headers={ACTIVITY_LIST_FILTER_HEADERS}
          clauses={clauses}
          onChange={setClauses}
        />
      }
      filterNotices={
        refusals.length || notices.length || columnSort.notices.length || search ? (
          <Stack spacing={1}>
            <ListQueryNotices
              refused={refusals}
              notices={[...notices, ...columnSort.notices]}
            />
            {search ? (
              <Typography variant="caption" color="text.secondary">
                {ACTIVITY_SEARCH_HINT}
              </Typography>
            ) : null}
          </Stack>
        ) : null
      }
      filtering={filtering}
      columns={activityColumns}
      rows={rows}
      getRowId={(row: any) => `${row.scopeId}:${row.$id}`}
      staff={staff}
      details={(row: ActorActivityEntry) => {
        const described = describe(row)
        return {
          description: described,
          who: activityActorLabel(row),
          when: formatWireTimestamp(row.createdAt),
          where: scopeLabel(row),
          ...(staff ? { links: staffActivityLinks(described) } : {}),
        }
      }}
      loading={loading}
      unreadable={unreadable}
      /*
       * The grid must NOT also filter or search. The feed is paged, so a
       * client-side pass would narrow the rows on screen and call that the
       * answer — on an audit log, "nothing happened" is the wrong answer to
       * give about everything that is not on this page. Passing a handler is
       * what puts the grid in server-filter mode. A header sorts the route's
       * order or the page, saying which (`columnSort`).
       */
      filterModel={gridFilter.filterModel}
      onFilterModelChange={gridFilter.onFilterModelChange}
      quickFilter
      columnSort={columnSort}
      page={page}
      pageSize={pageSize}
      hasMore={Boolean(nextCursor)}
      paginationDisabled={loading}
      onPageChange={(next) => {
        if (next === page) return
        if (next > page) {
          const cursor = nextCursor
          setCursors((current) => [...current.slice(0, next), cursor])
          void loadPage(next, cursor)
          return
        }
        const previous = cursors[next] ?? null
        setCursors((current) => current.slice(0, next + 1))
        void loadPage(next, previous)
      }}
      onPageSizeChange={setPageSize}
    />
  )
}
ActorActivityTable.displayName = 'ActorActivityTable'

export default ActorActivityTable
