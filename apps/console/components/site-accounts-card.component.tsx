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

import { crmContactByEmailHref } from '@aglyn/aglyn/app-utils/console-record-links'
import { mdiAccountArrowRight } from '@aglyn/shared-data-mdi'
import { CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import RowActionsMenu from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import ListQueryNotices from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import { hiddenFilterVisibility } from '@aglyn/shared-ui-jsx/const/list-filter'
import { listFilterGridColumns } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import { Box, Chip, Stack, Typography } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { collection } from 'firebase/firestore'
import { useMemo, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { useListQuery } from '@aglyn/tenant-feature-instance/hooks/use-list-query'
import { docsHelp } from '../constants/docs-links'
import { useOrgPermissions } from '../hooks/use-org-permissions'
import { useOrgSlug } from '../hooks/use-org-scope'
import { useReleaseFlag } from '../hooks/use-release-flags'
import { useHostSubdomain } from './host-id-provider'
import {
  SITE_MEMBER_LIST_FILTER_FIELDS,
  SITE_MEMBER_LIST_FILTER_HEADERS,
  SITE_MEMBER_LIST_FILTER_OPTIONS,
} from '../utils/list-filters'
import { listQueryRefusalNotices } from '../utils/list-query-refusals'
import { SITE_ACCOUNT_LIST_QUERY } from '../utils/site-account-query'
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
  const listRequest = useMemo(
    () => ({ clauses: gridFilter.clauses, search: gridFilter.searchWords }),
    [gridFilter.clauses, gridFilter.searchWords],
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

  const visible = memberDocs

  /*
   * Where an account's CONTACT is (AGL-2622). A sign-up updated a person in
   * the CRM by the account's address, and the row links there by that
   * address; the Contacts list holds the id nothing here does and opens the
   * record on one match. Offered under the CRM's own gate — released for
   * the viewer, and with the permission its rules read for — because a row
   * action that lands on a hub the shell refuses is a link to a 404. The
   * app may not import the plugin, so the address comes from the shared
   * builder the plugin's own routes are pinned against.
   */
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const contactsFlag = useReleaseFlag('release_crm')
  const permissions = useOrgPermissions()
  const crmReachable =
    Boolean(orgSlug && host) &&
    contactsFlag.ready &&
    contactsFlag.visible &&
    permissions.loaded &&
    permissions.can('data.manage')

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
          ...(crmReachable
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
                            key: 'crm',
                            label: 'Open in CRM',
                            icon: <MdiIcon path={mdiAccountArrowRight.path} size={0.8} />,
                            ...(row.email
                              ? {
                                  href: crmContactByEmailHref(
                                    { orgSlug, host: String(host) },
                                    String(row.email),
                                  ),
                                }
                              : {
                                  disabled: true,
                                  disabledReason:
                                    'This account has no email address, so no contact was updated.',
                                }),
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
    [crmReachable, orgSlug, host],
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
        refused={listQueryRefusalNotices(
          plan.refused,
          SITE_MEMBER_LIST_FILTER_HEADERS,
          SITE_MEMBER_LIST_FILTER_OPTIONS,
        )}
        notices={plan.notices}
      />
      {visible.length || filtering ? (
        <Stack spacing={1}>
          <ListTable
            aria-label="Site users"
            rows={visible}
            columns={memberColumns}
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
