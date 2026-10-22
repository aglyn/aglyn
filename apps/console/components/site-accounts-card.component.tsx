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

import { pluginRecordByEmailHref } from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { mdiAccountArrowRight } from '@aglyn/shared-data-mdi'
import { CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import RowActionsMenu from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import ListQueryNotices, {
  listQueryRefusals,
} from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import { hiddenFilterVisibility } from '@aglyn/shared-ui-jsx/const/list-filter'
import { listFilterGridColumns } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListColumnSort } from '@aglyn/shared-ui-jsx/hooks/use-list-column-sort'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import type { ListQuerySort } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { Box, Chip, Stack, Typography } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { collection } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { useListQuery } from '@aglyn/tenant-feature-instance/hooks/use-list-query'
import { docsHelp } from '../constants/docs-links'
import { useOrgSlug } from '../hooks/use-org-scope'
import { useRecordRouteOwner } from '../hooks/use-record-route-owner'
import { useHostSubdomain } from './host-id-provider'
import {
  SITE_MEMBER_LIST_FILTER_FIELDS,
  SITE_MEMBER_LIST_FILTER_HEADERS,
  SITE_MEMBER_LIST_FILTER_OPTIONS,
} from '../utils/list-filters'
import {
  SITE_ACCOUNT_LIST_COLUMN_SORTS,
  SITE_ACCOUNT_LIST_QUERY,
} from '../utils/site-account-query'
import { TABLE_ROW_HEIGHT } from '../constants/shared'

import SiteMemberDrawer from './site-member-drawer.component'


/**
 * Site users section (AGL-350): the visitor accounts created through the
 * storefront sign-up (AGL-109), searchable and paged — previously only a
 * dashboard afterthought. Newest first. Rows open the member detail
 * drawer (AGL-546) with orders, subscriptions, the lifetime purchase
 * total, and suspend/reactivate; the old `purchaseCents` column read a
 * field nothing writes, so totals moved to the drawer where they are
 * computed from the order docs.
 */
/**
 * The filterable fields that get a column. The rest of
 * `SITE_MEMBER_LIST_FILTER_FIELDS` still reaches the filter panel, hidden.
 */
const MEMBER_FILTER_COLUMNS = ['email', 'displayName', 'createdAt', 'suspended']

export function SiteAccountsCard(props: { hostId: string }) {
  const { hostId } = props
  const firestore = useFirestore()
  /*
   * EVERY CLAUSE AND THE SEARCH ARE THE QUERY'S (AGL-3321).
   *
   * The panel held one field clause at a time, with Status beside it, and
   * offered no search: the query served one predicate and there was no
   * loaded window for a second to narrow. Now the clauses the panel holds
   * and the search's word are planned together (`planListQuery` through
   * `useListQuery`) into one query beneath the list's newest-first order, and
   * a combination one query cannot hold is refused by name above the grid —
   * never applied to the rows that happen to be loaded. See
   * `SITE_ACCOUNT_LIST_QUERY` for the shapes and the indexes they read.
   */
  const gridFilter = useListGridFilter({ selectFields: ['suspended'] })
  const filtering =
    gridFilter.clauses.length > 0 ||
    gridFilter.searchWords.some((word) => word.trim() !== '')
  /*
   * The header the reader picked (AGL-3680): every column orders the QUERY,
   * so the whole list is in that order, not only the page on screen. See
   * `SITE_ACCOUNT_LIST_COLUMN_SORTS` for which hold under a filter.
   */
  const [askedSort, setAskedSort] = useState<ListQuerySort | null>(
    SITE_ACCOUNT_LIST_COLUMN_SORTS[0],
  )
  const listRequest = useMemo(
    () => ({ clauses: gridFilter.clauses, search: gridFilter.searchWords, sort: askedSort }),
    [gridFilter.clauses, gridFilter.searchWords, askedSort],
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /*
   * The console's shared paging (AGL-2501), over the plan's query. "Load
   * more" decided there was more from `length >= limit`, which is wrong
   * exactly when the count is an even multiple of the page size: a site with
   * precisely fifty accounts offered a button that fetched nothing, and one
   * with fifty-one looked the same.
   */
  const {
    rows: memberDocs,
    hasMore,
    page,
    setPage,
    pageSize,
    setPageSize,
    plan,
  } = useListQuery<any>({
    collection: collection(firestore, 'hosts', hostId, 'siteMembers'),
    declaration: SITE_ACCOUNT_LIST_QUERY,
    request: listRequest,
    deps: [firestore, hostId],
    idField: '$id',
  })

  const columnSort = useListColumnSort<any>({
    sorts: SITE_ACCOUNT_LIST_COLUMN_SORTS,
    defaultSort: SITE_ACCOUNT_LIST_COLUMN_SORTS[0],
    sort: askedSort,
    onSortChange: setAskedSort,
    orderBy: plan.orderBy,
    rows: memberDocs,
  })
  const visible = columnSort.rows

  /*
   * Where an account's CONTACT is (AGL-2622). A sign-up updated a person by
   * the account's address, and the row links there by that address; the
   * contacts list holds the id nothing here does and opens the record on one
   * match. The app may not import the plugin that keeps contacts, so the
   * address is the one that plugin publishes on the record-route seam, and
   * the action is offered only where that plugin's own gates would let this
   * reader in — on for the site, on the plan, and with the permission it
   * declares — because a row action that lands on a page the shell refuses
   * is a link to a page that says no.
   */
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const contactOwner = useRecordRouteOwner('contact')
  const contactsReachable = Boolean(orgSlug && host && contactOwner)

  /**
   * The row's "Open in …": the person's contact by the account's address,
   * or the reason there is none to open.
   */
  const contactLink = useCallback(
    (row: any): { href: string } | { disabled: true; disabledReason: string } => {
      if (!row.email) {
        return {
          disabled: true,
          disabledReason: 'This account has no email address, so no contact was updated.',
        }
      }
      const href =
        orgSlug && host
          ? pluginRecordByEmailHref('contact', { orgSlug, host: String(host) }, String(row.email))
          : null
      return href
        ? { href }
        : { disabled: true, disabledReason: 'Contacts are not available in this workspace.' }
    },
    [orgSlug, host],
  )

  /* One row grammar, the console's (AGL-2501) — the same table everywhere. */
  const memberColumns: GridColDef[] = useMemo(
    () =>
      listFilterGridColumns(
        [
          {
            field: 'email',
            headerName: 'Email',
            flex: 1.4,
            minWidth: 220,
            valueGetter: (_value, row: any) => String(row.email ?? row.$id),
          },
          {
            field: 'displayName',
            headerName: 'Name',
            flex: 1,
            minWidth: 160,
            valueGetter: (_value, row: any) =>
              String(row.displayName ?? row.name ?? ''),
            renderCell: ({ row }: any) => row.displayName ?? row.name ?? '—',
          },
          {
            field: 'createdAt',
            headerName: 'Joined',
            flex: 0.8,
            minWidth: 130,
            // `type: 'date'` is what gives the panel a date PICKER rather than a
            // free-text box for a value the query reads as a day.
            type: 'date',
            valueGetter: (_value, row: any) => row.createdAt?.toDate?.() ?? null,
            renderCell: ({ row }: any) =>
              row.createdAt?.toDate?.()
                ? row.createdAt.toDate().toLocaleDateString()
                : '—',
          },
          {
            field: 'suspended',
            headerName: 'Status',
            flex: 0.6,
            minWidth: 110,
            align: 'right',
            headerAlign: 'right',
            // The stored boolean, as the Status filter's choices spell it.
            valueGetter: (_value, row: any) => String(row.suspended === true),
            renderCell: ({ row }: any) =>
              row.suspended === true ? (
                <Chip label="Suspended" size="small" color="error" />
              ) : (
                <Chip label="Active" size="small" variant="outlined" />
              ),
          },
          ...(contactsReachable
            ? [
                {
                  field: 'actions',
                  headerName: '',
                  width: 56,
                  sortable: false,
                  filterable: false,
                  disableColumnMenu: true,
                  renderCell: ({ row }: any) => (
                    <Box
                      onClick={(event) => event.stopPropagation()}
                      sx={{ display: 'flex', alignItems: 'center', height: '100%' }}
                    >
                      <RowActionsMenu
                        label={String(row.email ?? row.$id)}
                        items={[
                          {
                            key: 'contact',
                            label: `Open in ${contactOwner?.displayName ?? 'contacts'}`,
                            icon: <MdiIcon path={mdiAccountArrowRight.path} size={0.8} />,
                            ...contactLink(row),
                          },
                        ]}
                      />
                    </Box>
                  ),
                } satisfies GridColDef,
              ]
            : []),
        ],
        SITE_MEMBER_LIST_FILTER_FIELDS,
        SITE_MEMBER_LIST_FILTER_OPTIONS,
        SITE_MEMBER_LIST_FILTER_HEADERS,
      ),
    [contactsReachable, contactOwner, contactLink],
  )

  // Resolved from the live docs so the drawer reflects rule-side updates.
  const selectedMember =
    memberDocs.find((member: any) => member.$id === selectedId) ?? null

  return (
    <CardDisplay
      header={'Site users'}
      help={docsHelp('members', {
        anchor: '#5-manage-members-from-the-console',
        excerpt:
          'Visitors who signed up on your live site — open a row for ' +
          'orders, subscriptions, and suspend/reactivate.',
      })}
      contentGutterX
      contentGutterY
    >
      <ListFilterChips
        fields={SITE_MEMBER_LIST_FILTER_FIELDS}
        headers={SITE_MEMBER_LIST_FILTER_HEADERS}
        clauses={gridFilter.clauses}
        onChange={gridFilter.setClauses}
        options={SITE_MEMBER_LIST_FILTER_OPTIONS}
      />
      <ListQueryNotices
        refused={listQueryRefusals(plan.refused, {
          fields: SITE_MEMBER_LIST_FILTER_FIELDS,
          headers: SITE_MEMBER_LIST_FILTER_HEADERS,
          options: SITE_MEMBER_LIST_FILTER_OPTIONS,
        })}
        notices={plan.notices}
      />
      {visible.length || filtering ? (
        <Stack spacing={1}>
          <ListTable
            aria-label="Site users"
            rows={visible}
            columns={memberColumns}
            // Every header orders the query (`columnSort`).
            columnSort={columnSort}
            onOpen={(id) => setSelectedId(id)}
            /*
             * The grid must NOT also filter. The query answers it, so a
             * second client-side pass could only drop rows that already
             * matched — it compares what a column DRAWS, and the query
             * compares what the document stores.
             */
            filterMode="server"
            filterModel={gridFilter.filterModel}
            onFilterModelChange={gridFilter.onFilterModelChange}
            // Served: the word is an `array-contains` on the name tokens.
            quickFilter
            noRowsLabel="No site users match these filters"
            // Paged by the footer below, so the grid must not also slice.
            hideFooter
            rowHeight={TABLE_ROW_HEIGHT}
            initialState={{
              columns: {
                columnVisibilityModel: hiddenFilterVisibility(
                  SITE_MEMBER_LIST_FILTER_FIELDS,
                  MEMBER_FILTER_COLUMNS,
                ),
              },
            }}
          />
          <ListPagination
            page={page}
            pageSize={pageSize}
            rowCount={visible.length}
            hasMore={hasMore}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {'No site accounts yet — they appear when visitors sign up ' +
            'on your site.'}
        </Typography>
      )}
      <SiteMemberDrawer
        hostId={hostId}
        member={selectedMember}
        onClose={() => setSelectedId(null)}
      />
    </CardDisplay>
  )
}
SiteAccountsCard.displayName = 'SiteAccountsCard'

export default SiteAccountsCard
