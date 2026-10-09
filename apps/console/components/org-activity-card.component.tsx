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
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import {
  ListQueryNotices,
  listQueryRefusals,
} from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import {
  type ListFilterClause,
  type ListFilterOption,
  listFilterGridColumns,
  upsertListFilterClause,
} from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import {
  type ListQueryRefusal,
  type ListQuerySort,
  planListQuery,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import { useListColumnSort } from '@aglyn/shared-ui-jsx/hooks/use-list-column-sort'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import type { GridColDef } from '@mui/x-data-grid'
import { Alert, Button, Chip, Stack, Typography } from '@mui/material'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  activityActionLabel,
  activityActorLabel,
  activityHref,
} from '@aglyn/aglyn/app-utils/activity-presenter'
import { activityRowText, describeActivity } from '@aglyn/aglyn/app-utils/activity-labels'
import ActivityDetailsDialog, { type ActivityDetails } from '@aglyn/shared-ui-jsx/components/activity-details-dialog.component'
import { staffActivityLinks } from '../utils/activity-details'
import { listPluginActivityActions, listPluginActivityFilters } from '@aglyn/aglyn'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { docsHelp } from '../constants/docs-links'
import { TABLE_PAGE_SIZE_DEFAULT, TABLE_ROW_HEIGHT } from '../constants/shared'
import {
  ACTIVITY_LIST_SORT,
  ACTIVITY_SEARCH_HINT,
  ORG_ACTIVITY_FILTER_FIELDS,
  ORG_ACTIVITY_SELECT_FIELDS,
  SUBJECT_ACTIVITY_QUERY,
  SUBJECT_ACTIVITY_SORTS,
} from '../utils/activity-list-query'
import {
  ACTIVITY_LIST_FILTER_FIELDS,
  ACTIVITY_LIST_FILTER_HEADERS,
} from '../utils/list-filters'
import { formatWireTimestamp } from '../utils/staff-timestamps'

export interface OrgActivityCardProps {
  orgId: string
  header?: string
  /** Show only entries whose target is this id — changes made TO a
   * member/host/screen (AGL-389). Applied by the route, not here. */
  targetId?: string
  /**
   * Include the org's SITES, not just its org-level events.
   *
   * Off by default because "Changes to this member" filters org entries by
   * target, and folding site activity in would file a member's own page
   * edits under a heading about changes made TO them.
   *
   * The scope is a fan-out merged by date rather than one collection, so its
   * cursor is a timestamp plus the ids already shown at that instant — see
   * `readOrgWideActivity`. Opaque from here, like any other cursor.
   */
  orgWide?: boolean
  /**
   * The staff org page (AGL-3660): a row's details add the stored code and
   * path and link to the staff pages. The organization's own pages leave it
   * off.
   */
  staff?: boolean
}

/** Only the default order: the feeds whose query keeps newest first. */
const NEWEST_FIRST_ONLY: readonly ListQuerySort[] = [ACTIVITY_LIST_SORT]
const ORG_ACTIVITY_SORT_HEADERS = { action: 'Action', actorId: 'Who (then)', scopeId: 'Where' }

/** The choices the route lists for Who and Where, with the first page. */
interface OrgActivityFacets {
  actors: ListFilterOption[]
  sites: ListFilterOption[]
}

/**
 * Org-level counterpart to `HostActivityTable` (AGL-118): the newest-first
 * activity of one organization, read through `/api/orgs/activity`.
 *
 * ## An ordered PAGE, not a window
 *
 * The feed was once `limit(200)` with no `orderBy` — Firestore then answers
 * in document-id order, and `logOrgActivity` writes with `.add()`, so the 200
 * rows were a pseudo-random sample sorted to look like the newest page
 * (AGL-2292). The route orders the query and serves a cursor page, so the
 * reader walks back through the whole history and each step costs
 * `pageSize + 1` reads.
 *
 * ## The toolbar filters and searches the whole log
 *
 * Every clause in the grid's Filters panel and the search word go to the
 * route, which puts them all on its query (AGL-3321, see
 * `utils/activity-list-query.ts`): Action, and on the org-wide log Who and
 * Where, from pickers, When as a date or a range, and the search over the
 * written `searchTokens`. What the route could not put on the query it says,
 * and the card shows (`ListQueryNotices`) rather than narrowing the page. A
 * change to any of them is a different query, so the walk starts again at
 * page one with no cursor.
 *
 * ## Every header sorts (AGL-3680)
 *
 * The organization's own feed asks the route for When either way and for
 * Action (`SUBJECT_ACTIVITY_SORTS`: one collection, no base, single-field
 * indexes). The changes to one member and the org-wide merge keep newest
 * first — a target base would cost a composite per order, and the merge
 * pages by the clock — so their Action sorts the page. Who and Where are
 * resolved per row and always sort the page, saying so.
 */
export function OrgActivityCard(props: OrgActivityCardProps) {
  const { orgId, header = 'Recent Activity', targetId, orgWide, staff = false } = props
  const [opened, setOpened] = useState<ActivityDetails | null>(null)
  const { orgSlug } = useParams<{ orgSlug: string }>()
  const { data: user } = useUser()
  // The user object's IDENTITY changes on every render of the provider above,
  // so depending on it re-runs the effect, which sets state, which renders,
  // which re-runs the effect — a fetch loop that only shows up under load.
  // The effect keys on the UID and reads the live object through a ref.
  const userRef = useRef(user)
  userRef.current = user
  const uid = (user as { uid?: string } | undefined)?.uid ?? null

  // Who and Where belong to the org-wide log; one member's changes and the
  // organization's own feed each read one collection.
  const fields = orgWide ? ORG_ACTIVITY_FILTER_FIELDS : ACTIVITY_LIST_FILTER_FIELDS
  const [clauses, setClauses] = useState<ListFilterClause[]>([])
  const [searchWords, setSearchWords] = useState<string[]>([])
  const gridFilter = useListGridFilter({
    selectFields: ORG_ACTIVITY_SELECT_FIELDS,
    clauses,
    onChange: setClauses,
    search: { words: searchWords, onChange: setSearchWords },
  })
  const search = searchWords.join(' ').trim()
  /*
   * The header order: asked of the route on the organization's own feed,
   * the one read whose declaration offers more than newest first.
   */
  const querySorted = !orgWide && !targetId
  const sorts = querySorted ? SUBJECT_ACTIVITY_SORTS : NEWEST_FIRST_ONLY
  const [askedSort, setAskedSort] = useState<ListQuerySort | null>(ACTIVITY_LIST_SORT)
  const routeSort = querySorted ? askedSort : null
  // Which order the route will read in — a filter or the search sets an
  // `alone` order aside — so the header shows the rows' real order.
  const orderBy = useMemo(
    () =>
      querySorted
        ? planListQuery(
            SUBJECT_ACTIVITY_QUERY,
            { clauses, search: searchWords, sort: askedSort },
            nameSearchNormalizers,
          ).orderBy
        : ACTIVITY_LIST_SORT,
    [querySorted, clauses, searchWords, askedSort],
  )
  const [facets, setFacets] = useState<OrgActivityFacets | null>(null)
  const facetsRef = useRef(facets)
  facetsRef.current = facets

  const [entries, setEntries] = useState<any[] | null>(null)
  const [cursors, setCursors] = useState<Array<string | null>>([null])
  const [page, setPage] = useState(0)
  /*
   * The console's shared default, not a number this card picked. Every list
   * starts at the smallest option — it is what a reader learns once, and on a
   * feed whose query is bounded by it, the smallest page is also the smallest
   * bill (AGL-2501/AGL-703).
   */
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  /*
   * Only the newest request may write. Two page clicks in quick succession,
   * or a page change racing the reload a filter change triggers, otherwise
   * land in whatever order the network returns them — and the loser
   * overwrites the winner, leaving the footer on one page and the rows on
   * another.
   */
  const requestRef = useRef(0)
  /*
   * "Could not look" is not "found nothing" (AGL-2486). A denial IS a real
   * answer — this member's role does not carry `org.auditLog` — and reads as
   * an empty feed, because it truthfully is one for them. A read that FAILED
   * says so instead of presenting itself as a clean record.
   */
  const [unreadable, setUnreadable] = useState(false)
  /** What the route could not put on its query, and what it said about it. */
  const [refused, setRefused] = useState<ListQueryRefusal[]>([])
  const [notices, setNotices] = useState<string[]>([])

  /*==========================================
   * READ THROUGH THE ROUTE, not the client SDK (AGL-2444).
   *
   * `/api/orgs/activity` checks `org.auditLog` with the Admin SDK and the
   * security rule denies members outright, which is what turns the
   * permission into enforcement rather than a hidden card.
   *=========================================*/
  const loadPage = useCallback(
    async (targetPage: number, cursor: string | null) => {
      const request = (requestRef.current += 1)
      const current = () => requestRef.current === request
      setLoading(true)
      try {
        const url = new URL('/api/orgs/activity', window.location.origin)
        url.searchParams.set('orgId', orgId)
        url.searchParams.set('pageSize', String(pageSize))
        if (orgWide) url.searchParams.set('scope', 'org-wide')
        else if (targetId) url.searchParams.set('targetId', targetId)
        if (clauses.length) {
          url.searchParams.set(
            'filters',
            JSON.stringify(clauses.map(({ field, op, value }) => ({ field, op, value }))),
          )
        }
        if (search) url.searchParams.set('search', search)
        if (routeSort && routeSort !== ACTIVITY_LIST_SORT) {
          url.searchParams.set('sort', `${routeSort.path}:${routeSort.direction}`)
        }
        // The Who and Where choices, once.
        if (orgWide && !facetsRef.current) url.searchParams.set('facets', '1')
        if (cursor) url.searchParams.set('cursor', cursor)
        const response = await authorizedFetch(userRef.current, url.toString())
        if (!response.ok) {
          // 403 is the permission answering, and the honest render of it is
          // an empty feed. Anything else means the read broke.
          if (!current()) return
          setUnreadable(response.status !== 403)
          setEntries([])
          setNextCursor(null)
          return
        }
        const payload = (await response.json()) as {
          entries?: any[]
          nextCursor?: string | null
          facets?: OrgActivityFacets
          refused?: ListQueryRefusal[]
          notices?: string[]
        }
        if (!current()) return
        if (payload?.facets) setFacets(payload.facets)
        setRefused(payload?.refused ?? [])
        setNotices(payload?.notices ?? [])
        setUnreadable(false)
        setEntries(payload?.entries ?? [])
        setNextCursor(payload?.nextCursor ?? null)
        setPage(targetPage)
      } catch {
        if (!current()) return
        setUnreadable(true)
        setEntries([])
        setNextCursor(null)
      } finally {
        if (current()) setLoading(false)
      }
    },
    [orgId, orgWide, pageSize, targetId, clauses, search, routeSort],
  )

  // A new filter, search or page size is a different query: page one, no
  // cursor.
  useEffect(() => {
    setCursors([null])
    void loadPage(0, null)
  }, [uid, loadPage])

  /*
   * The pickers' choices. Action is the plugin-declared catalog of coded
   * actions this log records (AGL-2940); most core actions are the sentence
   * their writer stored and have no code to pick, so they are reached by
   * the date range, Who and Where. Who and Where are the organization's
   * members and subjects, as the route lists them.
   */
  const options = useMemo(
    (): Record<string, readonly ListFilterOption[]> => ({
      action: listPluginActivityActions()
        .filter((action) =>
          [action.scope].flat().some((scope) => scope === 'org' || scope === 'host'),
        )
        .map((action) => ({ value: action.key, label: activityActionLabel(action.key) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      ...(facets ? { actorId: facets.actors, scopeId: facets.sites } : {}),
    }),
    [facets],
  )
  /*
   * One chip per plugin-declared action group (AGL-2929, AGL-2940): a
   * plugin's rows are stored as catalog codes, so a chip is an Action
   * `is any of` those codes — served like any other clause, across the log.
   */
  const groups = useMemo(
    () => (fields.some((field) => field.column === 'action') ? listPluginActivityFilters() : []),
    [fields],
  )
  const actionClause = clauses.find((clause) => clause.field === 'action')
  const groupValue = (actions: readonly string[]) => actions.join(',')

  const siteLabel = useCallback(
    (row: any): string =>
      facets?.sites.find((site) => site.value === row.scopeId)?.label ??
      (row.scopeType === 'org' ? 'Organization' : String(row.scopeId ?? '—')),
    [facets],
  )
  const columns = useMemo((): GridColDef[] => {
    const shown: GridColDef[] = [
      {
        field: 'action',
        headerName: 'Action',
        flex: 1.6,
        minWidth: 220,
        // The STORED action stays the cell's value — it is what the route's
        // equality compares — and the sentence is only what is drawn.
        valueGetter: (_value, row: any) => row.action ?? '',
        renderCell: ({ row }: any) => {
          const href = activityHref(row, { orgSlug })
          const label = activityRowText(row)
          // The stored code, where it is one, is the tooltip (AGL-3660).
          const code = describeActivity(row).code ?? undefined
          return (
            <span title={code}>
              {href ? (
                <AppLink href={href} color="inherit" underline="hover">
                  {label}
                </AppLink>
              ) : (
                label
              )}
            </span>
          )
        },
      },
      {
        field: 'actorId',
        /*
         * "Who (then)": the address is a snapshot taken when the entry was
         * written, and is never rewritten to match a later one.
         */
        headerName: 'Who (then)',
        flex: 1,
        minWidth: 160,
        valueGetter: (_value, row: any) => activityActorLabel(row),
      },
      ...(orgWide
        ? [
            {
              field: 'scopeId',
              headerName: 'Where',
              flex: 0.8,
              minWidth: 140,
              valueGetter: (_value: unknown, row: any) => siteLabel(row),
            } satisfies GridColDef,
          ]
        : []),
      {
        field: 'createdAt',
        headerName: 'When',
        flex: 1,
        minWidth: 180,
        // `type: 'date'` gives the panel a date picker for a value the
        // route reads as a day.
        type: 'date',
        valueGetter: (_value, row: any) =>
          row.createdAt?.seconds ? new Date(row.createdAt.seconds * 1000) : null,
        renderCell: ({ row }: any) => formatWireTimestamp(row.createdAt),
      },
    ]
    return listFilterGridColumns(shown, fields, options, ACTIVITY_LIST_FILTER_HEADERS)
  }, [orgSlug, orgWide, siteLabel, fields, options])

  const rows = entries ?? []
  const pageSorts = useMemo(
    () => ({
      ...(querySorted ? {} : { action: (row: any) => activityRowText(row) || null }),
      actorId: (row: any) => activityActorLabel(row) || null,
      ...(orgWide ? { scopeId: (row: any) => siteLabel(row) } : {}),
    }),
    [querySorted, orgWide, siteLabel],
  )
  const columnSort = useListColumnSort<any>({
    sorts,
    defaultSort: ACTIVITY_LIST_SORT,
    sort: askedSort,
    onSortChange: setAskedSort,
    orderBy,
    rows,
    pageSorts,
    headers: ORG_ACTIVITY_SORT_HEADERS,
  })
  const filtering = clauses.length > 0 || Boolean(search)
  // A pager on a single-page feed is furniture. It appears once there is
  // somewhere to go.
  const paged = page > 0 || Boolean(nextCursor)

  return (
    <CardDisplay
      header={header}
      help={docsHelp('inviteTeammates', {
        anchor: '#activity-log',
        excerpt:
          'Who changed what in this organization — settings, members, ' +
          'invites, and site-level changes.',
      })}
      contentGutterX
      contentGutterY
      contentBordered="all"
    >
      <Stack spacing={1.5}>
        {groups.length ? (
          <Stack useFlexGap direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            {groups.map(({ group, actions }) => {
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
          </Stack>
        ) : null}
        <ListFilterChips
          fields={fields}
          headers={ACTIVITY_LIST_FILTER_HEADERS}
          options={options}
          clauses={clauses}
          onChange={setClauses}
        />
        <ListQueryNotices
          refused={listQueryRefusals(refused, {
            fields,
            headers: ACTIVITY_LIST_FILTER_HEADERS,
            options,
          })}
          notices={[...notices, ...columnSort.notices]}
        />
        {search ? (
          <Typography variant="caption" color="text.secondary">
            {ACTIVITY_SEARCH_HINT}
          </Typography>
        ) : null}
        {unreadable ? (
          <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
            <Alert severity="warning" sx={{ width: '100%' }}>
              {'Could not read the activity log. This is NOT the same as ' +
                'nothing having happened — do not read this as an empty ' +
                'history.'}
            </Alert>
            <Button size="small" onClick={() => void loadPage(page, cursors[page] ?? null)}>
              {'Try again'}
            </Button>
          </Stack>
        ) : rows.length === 0 && !filtering ? (
          <Typography variant="body2" color="text.secondary">
            {loading
              ? 'Loading…'
              : 'No activity yet — changes made in the console appear here.'}
          </Typography>
        ) : (
          <ListTable
            aria-label={header}
            rows={columnSort.rows}
            columns={columns}
            getRowId={(row: any) => `${row.scopePath ?? ''}:${row.$id}`}
            // Every row opens the shared details dialog (AGL-3660).
            onOpen={(_id: string, row: any) => {
              const where = orgWide ? siteLabel(row) : null
              const described = describeActivity(row, {
                hosts: row.scopeType === 'host' && where ? { [row.scopeId]: where } : {},
              })
              const href = orgSlug ? activityHref(row, { orgSlug }) : undefined
              setOpened({
                description: { ...described, action: activityRowText(row) },
                who: activityActorLabel(row),
                when: formatWireTimestamp(row.createdAt),
                where,
                links: [
                  ...(href ? [{ label: 'Open', href }] : []),
                  ...(staff ? staffActivityLinks({ ...described, orgId: described.orgId ?? orgId }) : []),
                ],
              })
            }}
            hideFooter
            rowHeight={TABLE_ROW_HEIGHT}
            /*
             * The grid holds ONE page of a cursor feed, so it must not filter,
             * search or re-sort that page and call it the answer: the panel's
             * clauses and the search words go to the route, which puts them
             * on its query, and a header asks the route for its order or
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
        {paged ? (
          <ListPagination
            page={page}
            pageSize={pageSize}
            rowCount={rows.length}
            hasMore={Boolean(nextCursor)}
            disabled={loading}
            onPageChange={(next) => {
              if (next === page) return
              if (next > page) {
                const cursor = nextCursor
                setCursors((current) => {
                  const grown = [...current]
                  grown[next] = cursor
                  return grown
                })
                void loadPage(next, cursor)
                return
              }
              const previous = cursors[next] ?? null
              setCursors((current) => current.slice(0, next + 1))
              void loadPage(next, previous)
            }}
            // The reload runs from the effect, which keys on `loadPage` and
            // so on the size — one path into the query rather than two.
            onPageSizeChange={setPageSize}
          />
        ) : null}
      </Stack>
      <ActivityDetailsDialog details={opened} staff={staff} onClose={() => setOpened(null)} />
    </CardDisplay>
  )
}
OrgActivityCard.displayName = 'OrgActivityCard'

export default OrgActivityCard
