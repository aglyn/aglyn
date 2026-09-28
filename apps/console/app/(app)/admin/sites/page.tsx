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

import { PLAN_LABELS } from '@aglyn/aglyn'
import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import { AppLink, CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import {
  ListQueryNotices,
  listQueryRefusals,
} from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import {
  ListTable,
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import { hiddenFilterVisibility } from '@aglyn/shared-ui-jsx/const/list-filter'
import { listFilterGridColumns } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Chip, Stack, Typography } from '@mui/material'
import { type GridColDef } from '@mui/x-data-grid'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo } from 'react'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import StaffListPaginationControls from '../../../../components/staff-list-pagination.component'
import StaffOnly from '../../../../components/staff-only.component'
import {
  type StaffSiteRow,
  StaffSiteRowActions,
} from '../../../../components/staff-site-row-actions.component'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH, TABLE_ROW_HEIGHT } from '../../../../constants/shared'
import { useStaffListQuery } from '../../../../hooks/use-staff-list-query'
import {
  STAFF_SITE_LIST_FILTER_FIELDS,
  STAFF_SITE_LIST_FILTER_HEADERS,
  STAFF_SITE_LIST_FILTER_OPTIONS,
} from '../../../../utils/staff-site-list-query'

/**
 * The filterable fields that get a column of their own. The rest of
 * `STAFF_SITE_LIST_FILTER_FIELDS` still reach the Filters panel, as hidden
 * columns.
 */
const SITE_FILTER_COLUMNS = ['displayName', 'hasCustomDomain', 'createdAt']

/**
 * Staff site list (AGL-3378): every site on the platform, with its
 * organization and that organization's owner, filtered and searched on the
 * route's query.
 */
const AdminSites: NextPageWithLayout<Record<string, never>> = () => {
  const { enqueueSnackbar } = useSnackbar()
  const router = useRouter()
  const gridFilter = useListGridFilter({ selectFields: ['hasCustomDomain'] })
  const reportError = useCallback(() => {
    enqueueSnackbar('Could not load sites', { variant: 'error' })
  }, [enqueueSnackbar])
  /*
   * EVERY CLAUSE AND THE SEARCH ARE THE ROUTE'S QUERY (AGL-3321).
   *
   * `/api/admin/sites` plans them onto one Firestore query
   * (`STAFF_SITE_LIST_QUERY`) and pages the answer; a new clause or word
   * starts over at page one. A clause the query cannot hold alongside the
   * rest comes back refused and is named above the grid, not applied.
   */
  const pagination = useStaffListQuery<StaffSiteRow>({
    endpoint: '/api/admin/sites',
    clauses: gridFilter.clauses,
    search: gridFilter.searchWords,
    rowsKey: 'sites',
    onError: reportError,
  })
  const { rows: sites, loading, filtering } = pagination

  /*
   * One row grammar, the console's (AGL-2501): the primary cell is a real
   * anchor, and a `valueGetter` on every column that is not a plain string.
   */
  const columns: GridColDef[] = useMemo(
    () =>
      listFilterGridColumns(
        [
          {
            field: 'displayName',
            headerName: 'Site',
            flex: 1.3,
            minWidth: 200,
            valueGetter: (_value, row: StaffSiteRow) =>
              String(row.displayName ?? row.subdomain ?? row.$id),
            renderCell: ({ row }: { row: StaffSiteRow }) => (
              <Stack sx={{ justifyContent: 'center', height: '100%', lineHeight: 1.25 }}>
                <AppLink
                  href={buildRoute(Route.ADMIN_SITE_DETAIL, { hostId: row.$id })}
                  color="inherit"
                  underline="hover"
                  sx={{ lineHeight: 1.25 }}
                  onClick={(event: any) => event.stopPropagation()}
                >
                  {row.displayName || row.subdomain || row.$id}
                </AppLink>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontFamily: 'monospace', lineHeight: 1.25 }}
                  noWrap
                >
                  {row.subdomain ?? row.$id}
                </Typography>
              </Stack>
            ),
          },
          {
            field: 'organization',
            headerName: 'Organization',
            flex: 1.1,
            minWidth: 180,
            // The organization's name lives on the organization; filter by
            // Org ID instead (`STAFF_SITE_LIST_FILTER_FIELDS`).
            filterable: false,
            valueGetter: (_value, row: StaffSiteRow) => row.org?.name ?? row.orgId ?? '',
            renderCell: ({ row }: { row: StaffSiteRow }) =>
              row.orgId ? (
                <Stack sx={{ justifyContent: 'center', height: '100%', lineHeight: 1.25 }}>
                  <AppLink
                    href={buildRoute(Route.ADMIN_ORG_DETAIL, { orgId: row.orgId })}
                    color="inherit"
                    underline="hover"
                    sx={{ lineHeight: 1.25 }}
                    onClick={(event: any) => event.stopPropagation()}
                  >
                    {row.org?.name ?? row.orgId}
                  </AppLink>
                  <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.25 }} noWrap>
                    {row.org
                      ? (PLAN_LABELS as Record<string, string>)[row.org.plan ?? ''] ?? row.org.plan ?? 'no plan'
                      : 'organization not found'}
                  </Typography>
                </Stack>
              ) : (
                <Typography variant="caption" color="text.secondary">
                  {'—'}
                </Typography>
              ),
          },
          {
            field: 'owner',
            headerName: 'Owner',
            flex: 1,
            minWidth: 180,
            // The owner is the organization's `ownerUid`; a site stores none.
            filterable: false,
            valueGetter: (_value, row: StaffSiteRow) => row.owner?.email ?? row.owner?.uid ?? '',
            renderCell: ({ row }: { row: StaffSiteRow }) =>
              row.owner ? (
                <Stack sx={{ justifyContent: 'center', height: '100%' }}>
                  <AppLink
                    href={buildRoute(Route.ADMIN_USER_DETAIL, { uid: row.owner.uid })}
                    color="inherit"
                    underline="hover"
                    onClick={(event: any) => event.stopPropagation()}
                    noWrap
                  >
                    {row.owner.email ?? row.owner.displayName ?? row.owner.uid}
                  </AppLink>
                </Stack>
              ) : (
                <Typography variant="caption" color="text.secondary">
                  {'—'}
                </Typography>
              ),
          },
          {
            field: 'hasCustomDomain',
            headerName: 'Custom domain',
            flex: 1,
            minWidth: 170,
            valueGetter: (_value, row: StaffSiteRow) => row.cname ?? '',
            renderCell: ({ row }: { row: StaffSiteRow }) => (
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', height: '100%', minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {row.cname ?? '—'}
                </Typography>
                {row.cname && row.cnameAttachmentPending ? (
                  <Chip size="small" variant="outlined" label="attaching" />
                ) : null}
              </Stack>
            ),
          },
          {
            field: 'publishedPages',
            headerName: 'Status',
            flex: 0.9,
            minWidth: 150,
            // Derived at read time — see "Not offered" in the declaration.
            filterable: false,
            valueGetter: (_value, row: StaffSiteRow) => row.publishedPages,
            renderCell: ({ row }: { row: StaffSiteRow }) => (
              <Stack
                direction="row"
                spacing={0.5}
                useFlexGap
                sx={{ alignItems: 'center', height: '100%', flexWrap: 'wrap' }}
              >
                <Chip
                  size="small"
                  variant="outlined"
                  label={
                    row.publishedPages
                      ? `${row.publishedPages} page${row.publishedPages === 1 ? '' : 's'}`
                      : 'unpublished'
                  }
                />
                {row.suspended ? <Chip size="small" color="error" label="suspended" /> : null}
                {row.maintenance ? <Chip size="small" color="warning" label="maintenance" /> : null}
              </Stack>
            ),
          },
          {
            field: 'createdAt',
            headerName: 'Created',
            flex: 0.7,
            minWidth: 120,
            type: 'date',
            valueGetter: (_value, row: StaffSiteRow) =>
              row.createdAt?.seconds ? new Date(row.createdAt.seconds * 1000) : null,
            renderCell: ({ row }: { row: StaffSiteRow }) => (
              <Typography variant="caption" color="text.secondary">
                {row.createdAt?.seconds
                  ? new Date(row.createdAt.seconds * 1000).toLocaleDateString()
                  : '—'}
              </Typography>
            ),
          },
          listActionsColumn(
            (row: StaffSiteRow) => (
              <StaffSiteRowActions site={{ ...row, ownerUid: row.owner?.uid ?? null }} />
            ),
            { width: 110 },
          ),
        ],
        STAFF_SITE_LIST_FILTER_FIELDS,
        STAFF_SITE_LIST_FILTER_OPTIONS,
        STAFF_SITE_LIST_FILTER_HEADERS,
      ),
    [],
  )

  return (
    <DashboardLayout
      breadcrumbItems={[
        { children: 'Staff', href: buildRoute(Route.ADMIN_OVERVIEW) },
        { children: 'Sites', href: buildRoute(Route.ADMIN_SITES) },
      ]}
      help={{ topic: 'staffConsole', anchor: '#sites-admin' }}
      header={{
        children: 'Site Management',
        icon: { path: ICON_VARIANT_SYMBOL_SECURE.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <StaffOnly>
          <CardDisplay
            header={'Sites'}
            help={docsHelp('staffConsole', {
              anchor: '#filter-the-site-list',
              excerpt:
                'Every site on the platform, with its organization and owner. Filter and search run over every site, not the page on screen.',
            })}
            contentGutterX
            contentGutterY
          >
            <Stack spacing={2}>
              <ListFilterChips
                fields={STAFF_SITE_LIST_FILTER_FIELDS}
                headers={STAFF_SITE_LIST_FILTER_HEADERS}
                options={STAFF_SITE_LIST_FILTER_OPTIONS}
                clauses={gridFilter.clauses}
                onChange={gridFilter.setClauses}
              />
              <ListQueryNotices
                refused={listQueryRefusals(pagination.refused, {
                  fields: STAFF_SITE_LIST_FILTER_FIELDS,
                  headers: STAFF_SITE_LIST_FILTER_HEADERS,
                  options: STAFF_SITE_LIST_FILTER_OPTIONS,
                })}
                notices={pagination.notices}
              />
              {sites.length === 0 && !filtering ? (
                <Typography variant="body2" color="text.secondary">
                  {loading ? 'Loading…' : 'No sites yet.'}
                </Typography>
              ) : (
                <ListTable
                  rows={sites}
                  columns={columns}
                  loading={loading}
                  // One page of the query's walk; a header sort would order
                  // the page and read as the whole list's.
                  disableColumnSorting
                  // The server answers the clauses and the search; a second
                  // pass here would drop rows the query matched.
                  filterMode="server"
                  quickFilter
                  filterModel={gridFilter.filterModel}
                  onFilterModelChange={gridFilter.onFilterModelChange}
                  noRowsLabel="No sites match these filters"
                  onOpen={(id) =>
                    router.push(buildRoute(Route.ADMIN_SITE_DETAIL, { hostId: String(id) }))
                  }
                  hideFooter
                  rowHeight={TABLE_ROW_HEIGHT}
                  initialState={{
                    columns: {
                      columnVisibilityModel: hiddenFilterVisibility(
                        STAFF_SITE_LIST_FILTER_FIELDS,
                        SITE_FILTER_COLUMNS,
                      ),
                    },
                  }}
                />
              )}
              <StaffListPaginationControls pagination={pagination} />
            </Stack>
          </CardDisplay>
        </StaffOnly>
      </Container>
    </DashboardLayout>
  )
}
AdminSites.displayName = 'Page:AdminSites'

export default AdminSites
