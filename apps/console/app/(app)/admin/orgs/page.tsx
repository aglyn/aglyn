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

import {
  isEnterpriseOrg,
  PLAN_LABELS,
  resolveEffectivePlan,
  resolveOrgEntitlements,
} from '@aglyn/aglyn'
import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import { AppLink, CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getGridStringOperators, type GridColDef } from '@mui/x-data-grid'
import { mdiChartLine } from '@aglyn/shared-data-mdi'
import {
  ListTable,
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import { TABLE_ROW_HEIGHT } from '../../../../constants/shared'
import { useUser } from '@aglyn/tenant-feature-instance'
import AuthenticatedLayout from '../../../../components/layouts/authenticated.layout'
import StaffOnly from '../../../../components/staff-only.component'
import StaffListPaginationControls from '../../../../components/staff-list-pagination.component'
import StaffOrgActions, {
  overrideCount,
} from '../../../../components/staff-org-actions.component'
import StaffOrgUsageTable, {
  type StaffOrgUsageMonth,
} from '../../../../components/staff-org-usage-table.component'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../components/layouts/main.layout'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import { useStaffListPagination } from '../../../../hooks/use-staff-list-pagination'

/**
 * Staff organization management (AGL-238, grown from the AGL-42 tenant
 * page): list orgs, override plan and entitlements, inspect billing state,
 * suspend, and flag GDPR erasure. Every change writes an adminAudit entry.
 * The page trusts the `staff` custom claim (set via
 * tools/scripts/set-staff-claim.mjs); the org rules admit super-staff
 * writes on the billing/suspension keys and billing-staff writes on plan
 * and entitlements, so the same claims gate server-side.
 */
const AdminOrgs: NextPageWithLayout<Record<string, never>> = () => {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()

  // Staff org list via the Admin SDK API (AGL-878). Reading `collection('orgs')`
  // from the client returned a non-deterministic subset — that list is gated by
  // the `isStaff() || isOrgMember()` rule and rides App Check. `/api/admin/orgs`
  // reads it with the service account (bypasses both), so staff reliably see
  // EVERY org, with cursor pagination (`after` = the last doc id).
  //
  // The Previous/Next machinery itself moved to `useStaffListPagination`
  // (AGL-2486) — it was written here and the Users list had none, and the
  // cheap fix for that was a second copy of this block. The page size is the
  // route's (`PAGE_SIZE`, 25), not the screen's; nothing here decides it.
  /** The debounced term the toolbar's quick filter last settled on. */
  const [search, setSearch] = useState('')
  /**
   * The one column filter the query is currently answering.
   *
   * One, not a list: Firestore composes a second predicate only with an
   * index built for that exact pair, so offering two filters would mean
   * either a combinatorial index set or a panel where some combinations
   * quietly return nothing.
   */
  const [filter, setFilter] = useState<{
    field: string
    op: string
    value: string
  } | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /*
   * Debounced, because each settled term is a Firestore query and a fast
   * typist would otherwise spend one per keystroke. Cleared on unmount so a
   * pending keystroke cannot set state on a page that has gone.
   */
  const onQuickFilter = useCallback((value: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setSearch(value.trim()), 300)
  }, [])
  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    },
    [],
  )

  const fetchOrgsPage = useCallback(
    async (cursor: string | null, _pageIndex: number, pageSize: number) => {
      const idToken = await (user as { getIdToken?: () => Promise<string> })
        ?.getIdToken?.()
      const url = new URL('/api/admin/orgs', window.location.origin)
      url.searchParams.set('pageSize', String(pageSize))
      if (search) url.searchParams.set('search', search)
      if (filter) {
        url.searchParams.set('filterField', filter.field)
        url.searchParams.set('filterOp', filter.op)
        url.searchParams.set('filterValue', filter.value)
      }
      if (cursor) url.searchParams.set('after', cursor)
      const response = await fetch(url.toString(), {
        headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error ?? 'Failed')
      return {
        rows: (payload.orgs ?? []) as any[],
        hasMore: Boolean(payload.hasMore),
        nextCursor: payload.nextCursor ?? null,
      }
    },
    [user, search, filter],
  )
  const reportOrgsError = useCallback(() => {
    enqueueSnackbar('Could not load organizations', { variant: 'error' })
  }, [enqueueSnackbar])
  const pagination = useStaffListPagination<any>({
    fetchPage: fetchOrgsPage,
    onError: reportOrgsError,
  })
  // `refresh` re-reads the page currently shown — the post-mutation target.
  const { rows: orgDocs, loading, refresh } = pagination

  /*
   * Search runs on the SERVER; sorting is the grid's (AGL-693).
   *
   * Both used to be bespoke and both were wrong at scale: a `Sort` select
   * offering three of the table's own columns, and a text box that filtered
   * the rows already fetched. This list is paged, so filtering in the browser
   * answered "no such organization" for every organization past the first
   * page — an answer a search must never give wrongly.
   *
   * The toolbar's quick filter now drives `/api/admin/orgs?search=`, a
   * Firestore prefix range over the normalized `nameLower`. Debounced,
   * because each keystroke is a query.
   *
   * ⚠️ Prefix, not contains: "acme" finds "Acme Coffee" and "coffee" does
   * not. Firestore cannot answer contains without a search service, and a
   * prefix that reaches the whole collection beats a contains that cannot
   * see past ten rows.
   */
  const orgs = orgDocs


  // Usage drill-down (AGL-205): last 12 monthly org rollups with deltas.
  const [usage, setUsage] = useState<{
    orgId: string
    months: StaffOrgUsageMonth[]
  } | null>(null)
  const router = useRouter()
  const [usageLoading, setUsageLoading] = useState<string | null>(null)
  const handleShowUsage = useCallback(
    (orgId: string) => async () => {
      setUsageLoading(orgId)
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch(
          `/api/admin/org-usage?orgId=${encodeURIComponent(orgId)}`,
          { headers: idToken ? { Authorization: `Bearer ${idToken}` } : {} },
        )
        const payload = await response.json()
        if (!response.ok) throw new Error(payload?.error ?? 'Usage failed')
        setUsage({ orgId, months: payload.months ?? [] })
      } catch (error) {
        console.error(error)
        enqueueSnackbar('Could not load usage', { variant: 'error' })
      } finally {
        setUsageLoading(null)
      }
    },
    [user, enqueueSnackbar],
  )

  // Override, suspend and erasure moved to the shared StaffOrgActions
  // component (AGL-939) so the org detail page carries the same audited
  // actions without this page and that one drifting apart.

  /*
   * Only the operators the QUERY can answer reach the panel.
   *
   * MUI offers `contains`, `equals`, `startsWith`, `endsWith`, `isEmpty`,
   * `isNotEmpty`, `isAnyOf` and `doesNotContain` on a string column. The
   * route answers the first four plus `isAnyOf`; the rest need either a
   * mid-string match or a negation, and no Firestore index answers those.
   *
   * Offering them anyway would put the funnel back in the state this whole
   * change was fixing — a control that sets something nobody honours. So the
   * menu is trimmed to what works, and a reader who opens it sees the real
   * capability rather than discovering the gap one empty result at a time.
   */
  const serverOperators = useMemo(
    () => (allowed: string[]) =>
      getGridStringOperators().filter((operator) =>
        allowed.includes(operator.value),
      ),
    [],
  )

  /*
   * One row grammar, the console's (AGL-693).
   *
   * `valueGetter` on every column that is not already a plain string: the
   * grid sorts what the getter returns, so a date rendered as `7/9/2026`
   * sorts as text — putting 12 January before 2 February — unless the column
   * hands it the seconds instead.
   */
  const orgColumns: GridColDef[] = useMemo(
    () => [
      {
        field: 'name',
        headerName: 'Organization',
        flex: 1.4,
        minWidth: 200,
        filterOperators: serverOperators([
          'contains',
          'equals',
          'startsWith',
          'endsWith',
        ]),
        valueGetter: (_value, row: any) => String(row.name ?? row.$id),
        renderCell: ({ row }: any) => (
          /*
           * Two lines inside one row, so the pair has to FIT it.
           *
           * At the default line heights a body line and a caption line come
           * to more than `TABLE_ROW_HEIGHT`, and a DataGrid cell does not
           * grow — it clips. The slug was being cut in half and the leftover
           * leading read as a gap between the name and its own slug.
           */
          <Stack
            sx={{
              justifyContent: 'center',
              height: '100%',
              lineHeight: 1.25,
            }}
          >
            {/* The primary cell is a real anchor, so it can be
                middle-clicked, copied, or opened from the browser's own
                context menu — affordances the row's click handler cannot
                offer however faithfully it calls `router.push`. */}
            <AppLink
              href={buildRoute(Route.ADMIN_ORG_DETAIL, { orgId: row.$id })}
              color="inherit"
              underline="hover"
              sx={{ lineHeight: 1.25 }}
              onClick={(event: any) => event.stopPropagation()}
            >
              {row.name ?? row.$id}
            </AppLink>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontFamily: 'monospace', lineHeight: 1.25 }}
              noWrap
            >
              {row.slug ?? row.$id}
            </Typography>
          </Stack>
        ),
      },
      {
        field: 'plan',
        headerName: 'Plan',
        flex: 1,
        minWidth: 180,
        filterOperators: serverOperators(['equals', 'isAnyOf']),
        valueGetter: (_value, row: any) =>
          isEnterpriseOrg(row as never)
            ? PLAN_LABELS.enterprise
            : resolveEffectivePlan(row as never),
        renderCell: ({ row }: any) => {
          const effectivePlan = resolveEffectivePlan(row as never)
          const storedPlanLabel = row.plan ?? 'no plan'
          return (
            <Stack
              direction="row"
              spacing={0.5}
              useFlexGap
              sx={{ flexWrap: 'wrap', alignItems: 'center', height: '100%' }}
            >
              {/* THE PLAN THE ORG READS AS, not the one stored (AGL-1152).
                  The two diverge in both directions, exactly when it matters:
                  a LAPSED payer stores `starter` and reads as `free`, because
                  `resolveEffectivePlan` drops any paid plan with a dead
                  subscription (AGL-247); an org with NO plan reads as `free`
                  too. */}
              <Chip
                label={
                  isEnterpriseOrg(row as never)
                    ? PLAN_LABELS.enterprise
                    : effectivePlan
                }
                size="small"
                color={row.plan ? 'primary' : 'default'}
              />
              {/* Only when the stored value would surprise someone reading
                  the effective one. */}
              {!isEnterpriseOrg(row as never) &&
              storedPlanLabel !== effectivePlan ? (
                <Chip
                  label={`stored: ${storedPlanLabel}`}
                  size="small"
                  variant="outlined"
                />
              ) : null}
              {row.suspendedAt ? (
                <Chip label="suspended" size="small" color="error" />
              ) : null}
              {row.erasureRequestedAt ? (
                <Chip
                  label="erasure requested"
                  size="small"
                  color="error"
                  variant="outlined"
                />
              ) : null}
            </Stack>
          )
        },
      },
      {
        field: 'subscription',
        headerName: 'Subscription',
        flex: 0.8,
        minWidth: 130,
        filterOperators: serverOperators(['equals']),
        valueGetter: (_value, row: any) => row.subscription?.status ?? '--',
      },
      {
        field: 'siteLimit',
        headerName: 'Site limit',
        flex: 0.8,
        minWidth: 130,
        // A derived entitlement, not a stored field — there is nothing for a
        // query to filter on.
        filterable: false,
        // An UNLIMITED quota is Number.POSITIVE_INFINITY, which renders as
        // the literal "Infinity" (AGL-1118).
        valueGetter: (_value, row: any) =>
          resolveOrgEntitlements(row).hostLimit,
        renderCell: ({ row }: any) => {
          const resolved = resolveOrgEntitlements(row)
          return (
            <Stack
              direction="row"
              spacing={0.5}
              sx={{ alignItems: 'center', height: '100%' }}
            >
              <span>
                {Number.isFinite(resolved.hostLimit)
                  ? resolved.hostLimit
                  : '∞'}
              </span>
              {overrideCount(row) ? (
                <Chip
                  label={`${overrideCount(row)} override${
                    overrideCount(row) === 1 ? '' : 's'
                  }`}
                  size="small"
                  variant="outlined"
                />
              ) : null}
            </Stack>
          )
        },
      },
      {
        field: 'createdAt',
        headerName: 'Created',
        flex: 0.7,
        minWidth: 120,
        // Date range filtering would need its own predicate and index; not
        // offered rather than offered and ignored.
        filterable: false,
        valueGetter: (_value, row: any) => row.createdAt?.seconds ?? 0,
        renderCell: ({ row }: any) => (
          <Typography variant="caption" color="text.secondary">
            {row.createdAt?.seconds
              ? new Date(row.createdAt.seconds * 1000).toLocaleDateString()
              : '—'}
          </Typography>
        ),
      },
      listActionsColumn(
        (row: any) => (
          <StaffOrgActions
            org={row}
            onChanged={refresh}
            rowActions={{
              label: row.name ?? row.$id,
              // Opening the org is the row's own click; the quick action is
              // the one other thing worth a direct press.
              quick: {
                icon: mdiChartLine.path,
                label: 'Usage',
                onClick: () => void handleShowUsage(row.$id)(),
                // Renders it disabled WITH the reason, rather than removing
                // it: an absent control and a busy one look identical, and
                // only one of them is honest.
                unavailableReason:
                  usageLoading === row.$id ? 'Loading usage…' : undefined,
              },
              items: [
                {
                  key: 'open',
                  label: 'Open',
                  href: buildRoute(Route.ADMIN_ORG_DETAIL, {
                    orgId: row.$id,
                  }),
                },
              ],
            }}
          />
        ),
        { width: 120 },
      ),
    ],
    [refresh, handleShowUsage, usageLoading, serverOperators],
  )

  return (
    <>
      <DashboardLayout
        breadcrumbItems={[
          { children: 'Staff', href: buildRoute(Route.ADMIN_OVERVIEW) },
          { children: 'Organizations', href: buildRoute(Route.ADMIN_ORGS) },
        ]}
        help={{
          topic: 'staffConsole',
          anchor: '#organizations-admin',
        }}
        header={{
          children: 'Organization Management',
          icon: { path: ICON_VARIANT_SYMBOL_SECURE.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          {/* Card-framed header + filters (AGL-385), consistent with the
              user-management page. */}
          <StaffOnly>
            <CardDisplay
              header={'Organizations'}
              help={docsHelp('billing', {
                anchor: '#tiers--entitlements',
                excerpt:
                  'Audited staff controls per organization — override the plan and entitlements, inspect usage, suspend its sites, or flag GDPR erasure.',
              })}
              contentGutterX
              contentGutterY
            >
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">
                  {'Overrides write to the org doc and are audited to ' +
                    'adminAudit. The Plan column shows the plan an org READS ' +
                    'as; where that differs from what is stored, the stored ' +
                    'value is shown beside it.'}
                </Typography>
              {orgs.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {loading
                    ? 'Loading…'
                    : 'No organizations yet — they are created at signup ' +
                      'or first site.'}
                </Typography>
              ) : (
                <ListTable
                  rows={orgs}
                  columns={orgColumns}
                  loading={loading}
                  /*
                   * The grid must NOT also filter. With the server answering
                   * the search, a second client-side pass over the returned
                   * page would drop rows the query already matched — the
                   * prefix range matches `nameLower`, and the grid compares
                   * against whatever a column happens to render.
                   */
                  filterMode="server"
                  onFilterModelChange={(model) => {
                    onQuickFilter((model.quickFilterValues ?? []).join(' '))
                    const item = (model.items ?? []).find(
                      (entry) =>
                        entry.value !== undefined &&
                        entry.value !== null &&
                        String(entry.value).trim() !== '',
                    )
                    setFilter(
                      item
                        ? {
                            field: String(item.field),
                            op: String(item.operator),
                            value: Array.isArray(item.value)
                              ? item.value.join(',')
                              : String(item.value),
                          }
                        : null,
                    )
                  }}
                  // The row IS the way in, on every list in the console.
                  onOpen={(id) =>
                    router.push(
                      buildRoute(Route.ADMIN_ORG_DETAIL, { orgId: id }),
                    )
                  }
                  // Server-paged: the footer below owns the page, so the grid
                  // must not also try to slice these rows.
                  hideFooter
                  // The console's row height, like every other grid list.
                  rowHeight={TABLE_ROW_HEIGHT}
                />
              )}
              {/* Pagination (AGL-878): each page is a fresh Admin-SDK read via
                  /api/admin/orgs, so the list is complete and never flickers.
                  Always shown so the control is visible even on a single page.
                  Shared with the Users list since AGL-2486. */}
              <StaffListPaginationControls pagination={pagination} />
              </Stack>
            </CardDisplay>
          </StaffOnly>
        </Container>
      </DashboardLayout>
      <Dialog
        open={Boolean(usage)}
        onClose={() => setUsage(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{`Usage — ${usage?.orgId}`}</DialogTitle>
        <DialogContent>
          <StaffOrgUsageTable months={usage?.months ?? []} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUsage(null)}>{'Close'}</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
AdminOrgs.displayName = 'Page:AdminOrgs'

export default AdminOrgs
