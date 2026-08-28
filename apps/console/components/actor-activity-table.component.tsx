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

import { activityTargetLabel } from '@aglyn/aglyn/app-utils/activity-presenter'
import { type HelpTipContent } from '@aglyn/shared-ui-jsx'
import {
  gridFilterRequest,
  listFilterColumn,
  type ListFilterRequest,
} from '@aglyn/shared-ui-jsx/const/list-filter'
import { ACTIVITY_LIST_FILTER_FIELDS } from '../utils/list-filters'
import type { GridColDef } from '@mui/x-data-grid'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Chip } from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ActivityTable from './activity-table.component'
import { formatWireTimestamp } from '../utils/staff-timestamps'
import { TABLE_PAGE_SIZE_DEFAULT } from '../constants/shared'

export interface ActorActivityEntry {
  $id: string
  scopeType: 'host' | 'org' | 'unknown'
  scopeId: string
  action?: string
  target?: Record<string, unknown> | null
  createdAt?: { seconds: number } | null
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
   * Render an Actor column that says the actor was NOT RECORDED (AGL-118).
   *
   * Only the unattributed section passes it. The attributed table needs no
   * such column — every row there is the person whose page it is, which the
   * heading already says.
   *
   * It exists because an empty cell reads as a rendering fault, and a reader
   * who assumes the column is broken falls back on the nearest available
   * explanation: that the actor is the person whose page they are looking at.
   * Saying "not recorded" is the entire point of the section.
   */
  actorNotRecorded?: boolean
}

/**
 * What one person did, paginated (AGL-1488).
 *
 * The CARD, the grid, the toolbar, the empty and unreadable states and the
 * footer are `ActivityTable`'s (AGL-693) — this owns the columns and the
 * cursor walk, which is the half that is actually about one person's
 * activity.
 *
 * Forward-only, because that is what the underlying query is: a
 * collection-group walk resumed from a document path. `HostActivityTable`
 * keeps every cursor it has seen and can therefore go back; this one is
 * filtered server-side, so the page a cursor lands on is not necessarily the
 * page it produced, and offering Previous would be offering a promise the
 * query cannot keep. A visited cursor stack gives Back honestly instead.
 *
 * "Found nothing" and "could not look" are separate states, for the same
 * reason the host table separates them: a failed read rendered as an empty
 * audit log is a lie with a clean-looking face.
 */
export function ActorActivityTable(props: ActorActivityTableProps) {
  const { endpoint, header, help, description, scopeNames, actorNotRecorded } =
    props
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  const uid = (user as { uid?: string } | undefined)?.uid ?? null

  const [rows, setRows] = useState<ActorActivityEntry[]>([])
  // Shared default, shared menu (AGL-693).
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const [cursors, setCursors] = useState<Array<string | null>>([null])
  const [page, setPage] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [unreadable, setUnreadable] = useState(false)

  /*
   * The filter the next request carries, in a ref.
   *
   * `loadPage` is a `useCallback` dependency of the effect that starts the
   * feed, so a filter held in state alone would rebuild it and restart the
   * walk. Written by the grid's change handler BEFORE it asks for page 0 —
   * during render is a tick too late, and the request would carry the filter
   * from before the reader changed it.
   */
  const filterRef = useRef<ListFilterRequest | null>(null)

  const loadPage = useCallback(
    async (targetPage: number, cursor: string | null) => {
      setLoading(true)
      try {
        const idToken = await (
          userRef.current as { getIdToken?: () => Promise<string> } | undefined
        )?.getIdToken?.()
        if (!idToken) return
        const url = new URL(endpoint, window.location.origin)
        url.searchParams.set('pageSize', String(pageSize))
        const filter = filterRef.current
        if (filter) {
          url.searchParams.set('filterField', filter.field)
          url.searchParams.set('filterOp', filter.op)
          url.searchParams.set('filterValue', filter.value)
        }
        // A narrowed feed is a different query, not a page of the old one, so
        // it carries no cursor — resuming one would page the UNFILTERED feed.
        if (cursor && !filter) url.searchParams.set('cursor', cursor)
        const response = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${idToken}` },
        })
        if (!response.ok) {
          setUnreadable(true)
          setRows([])
          return
        }
        const payload = (await response.json()) as {
          entries?: ActorActivityEntry[]
          nextCursor?: string | null
        }
        setUnreadable(false)
        setRows(payload?.entries ?? [])
        setNextCursor(payload?.nextCursor ?? null)
        setPage(targetPage)
      } catch {
        setUnreadable(true)
        setRows([])
      } finally {
        setLoading(false)
      }
    },
    [endpoint, pageSize],
  )

  useEffect(() => {
    if (!uid) return
    setCursors([null])
    void loadPage(0, null)
  }, [uid, loadPage])

  const scopeLabel = (entry: ActorActivityEntry): string => {
    if (entry.scopeType === 'org') return 'Organization'
    if (entry.scopeType === 'host') {
      return scopeNames?.[entry.scopeId] ?? entry.scopeId
    }
    return '—'
  }

  /* One row grammar, the console's (AGL-693) — the same table, no row click. */
  const activityColumns: GridColDef[] = useMemo(
    () => [
      {
        field: 'action',
        headerName: 'Action',
        flex: 1.2,
        minWidth: 180,
        ...listFilterColumn(ACTIVITY_LIST_FILTER_FIELDS, 'action'),
        valueGetter: (_value, row: ActorActivityEntry) => row.action ?? '—',
      },
      {
        field: 'target',
        headerName: 'Target',
        flex: 1.2,
        minWidth: 180,
        // A rendered summary of an object, not a stored scalar — there is
        // nothing for a query to compare.
        filterable: false,
        valueGetter: (_value, row: ActorActivityEntry) =>
          activityTargetLabel(row.target as never) || '—',
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
      ...(actorNotRecorded
        ? [
            {
              field: 'actor',
              headerName: 'Actor',
              flex: 0.9,
              minWidth: 150,
              // Nothing stored to compare: the rows in this table are exactly
              // the ones whose `actorId` is null.
              filterable: false,
              sortable: false,
              valueGetter: () => 'not recorded',
              renderCell: () => (
                <Chip
                  size="small"
                  variant="outlined"
                  color="warning"
                  label="not recorded"
                />
              ),
            } as GridColDef,
          ]
        : []),
      {
        field: 'createdAt',
        headerName: 'When',
        flex: 1,
        minWidth: 180,
        // `type: 'date'` is what gives the panel a date PICKER rather than a
        // free-text box for a value the route parses as a day.
        type: 'date',
        ...listFilterColumn(ACTIVITY_LIST_FILTER_FIELDS, 'createdAt'),
        // Sorted on the instant the wire carried, rendered as a local
        // string: a grid sorting the rendered text orders it alphabetically.
        valueGetter: (_value, row: ActorActivityEntry) =>
          row.createdAt?.seconds ? new Date(row.createdAt.seconds * 1000) : null,
        renderCell: ({ row }: any) => formatWireTimestamp(row.createdAt),
      },
    ],
    // `scopeLabel` closes over `scopeNames`, which is the only thing that
    // moves it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopeNames, actorNotRecorded],
  )

  return (
    <ActivityTable
      header={header}
      help={help}
      description={description}
      columns={activityColumns}
      rows={rows}
      getRowId={(row: any) => `${row.scopeId}:${row.$id}`}
      loading={loading}
      unreadable={unreadable}
      /*
       * The grid must NOT also filter. The feed is paged, so a client-side
       * pass would narrow the rows on screen and call that the answer — on an
       * audit log, "nothing happened" is the wrong answer to give about
       * everything that is not on this page. Passing a handler is what puts
       * the grid in server-filter mode.
       */
      onFilterModelChange={(model) => {
        filterRef.current = gridFilterRequest(model)
        setCursors([null])
        void loadPage(0, null)
      }}
      page={page}
      pageSize={pageSize}
      hasMore={Boolean(nextCursor)}
      paginationDisabled={loading}
      onPageChange={(next) => {
        if (next === page) return
        if (next > page) {
          const cursor = nextCursor
          setCursors((current) => [...current, cursor])
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
