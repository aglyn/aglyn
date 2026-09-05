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
import {
  gridFilterRequest,
  hiddenFilterColumns,
  hiddenFilterVisibility,
  listFilterColumn,
  type ListFilterRequest,
} from '@aglyn/shared-ui-jsx/const/list-filter'
import { Box, Chip, Stack, Typography } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { collection, limit, orderBy, query } from 'firebase/firestore'
import { useMemo, useState } from 'react'
import {
  listFilterConstraints,
  useFirestore,
  usePagedCollection,
} from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../constants/docs-links'
import { useOrgPermissions } from '../hooks/use-org-permissions'
import { useOrgSlug } from '../hooks/use-org-scope'
import { useReleaseFlag } from '../hooks/use-release-flags'
import { useHostSubdomain } from './host-id-provider'
import {
  SITE_MEMBER_LIST_FILTER_FIELDS,
  SITE_MEMBER_LIST_FILTER_HEADERS,
} from '../utils/list-filters'
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
const MEMBER_FILTER_COLUMNS = ['email', 'displayName', 'createdAt']

export function SiteAccountsCard(props: { hostId: string }) {
  const { hostId } = props
  const firestore = useFirestore()
  const [filter, setFilter] = useState<ListFilterRequest | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /*
   * The console's shared paging (AGL-2501). "Load more" decided there was more
   * from `length >= limit`, which is wrong exactly when the count is an even
   * multiple of the page size: a site with precisely fifty accounts offered a
   * button that fetched nothing, and one with fifty-one looked the same.
   */
  const {
    rows: memberDocs,
    hasMore,
    page,
    setPage,
    pageSize,
    setPageSize,
  } = usePagedCollection<any>(
    (pageLimit) => {
      /*
       * THE FILTER IS THE QUERY (AGL-2501).
       *
       * This card narrowed the rows it had fetched — ten by default — so a
       * name that sat on page four answered "no site users match", which
       * reads as the member not existing rather than as the search not
       * reaching them. The predicate goes into the query instead, so it
       * covers the whole collection.
       *
       * No `fixedOrderBy`: the window here is a growing `limit`, not a
       * document cursor, so a filter that needs its own ordering can have
       * one — nothing is holding a position in the old sort. Unfiltered, the
       * card keeps its newest-first order.
       */
      const constraints = listFilterConstraints(
        SITE_MEMBER_LIST_FILTER_FIELDS,
        filter,
      )
      return query(
        collection(firestore, 'hosts', hostId, 'siteMembers'),
        ...(constraints ?? [orderBy('createdAt', 'desc')]),
        limit(pageLimit),
      )
    },
    [firestore, hostId, filter],
    { idField: '$id' },
  )

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
  const contactsFlag = useReleaseFlag('release_contacts')
  const permissions = useOrgPermissions()
  const crmReachable =
    Boolean(orgSlug && host) &&
    contactsFlag.ready &&
    contactsFlag.visible &&
    permissions.loaded &&
    permissions.can('data.manage')

  /* One row grammar, the console's (AGL-2501) — the same table everywhere. */
  const memberColumns: GridColDef[] = useMemo(
    () => [
      {
        field: 'email',
        headerName: 'Email',
        flex: 1.4,
        minWidth: 220,
        ...listFilterColumn(SITE_MEMBER_LIST_FILTER_FIELDS, 'email'),
        valueGetter: (_value, row: any) => String(row.email ?? row.$id),
      },
      {
        field: 'displayName',
        headerName: 'Name',
        flex: 1,
        minWidth: 160,
        ...listFilterColumn(SITE_MEMBER_LIST_FILTER_FIELDS, 'displayName'),
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
        ...listFilterColumn(SITE_MEMBER_LIST_FILTER_FIELDS, 'createdAt'),
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
        /*
         * Not filterable, and not an oversight. `suspended` is written only
         * when a member IS suspended, so `is false` would return nothing
         * rather than everyone else — a filter that lies in exactly one
         * direction. It needs the writers to store `false` explicitly first.
         */
        filterable: false,
        valueGetter: (_value, row: any) =>
          row.suspended === true ? 'Suspended' : 'Active',
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
      ...hiddenFilterColumns(
        SITE_MEMBER_LIST_FILTER_FIELDS,
        MEMBER_FILTER_COLUMNS,
        SITE_MEMBER_LIST_FILTER_HEADERS,
      ),
    ],
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
      {visible.length ? (
        <Stack spacing={1}>
          <ListTable
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
            onFilterModelChange={(model) => setFilter(gridFilterRequest(model))}
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
          {filter
            ? 'No site users match the filter.'
            : 'No site accounts yet — they appear when visitors sign up ' +
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
