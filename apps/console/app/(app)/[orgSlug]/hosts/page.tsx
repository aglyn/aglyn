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
  ENTERPRISE_PLAN_LABEL,
  isEnterpriseOrg,
  PLAN_LABELS,
  resolveEffectivePlan,
  resolveOrgEntitlements,
} from '@aglyn/aglyn'
import { ICON_VARIANT_HOST_GROUP } from '@aglyn/shared-data-enums'
import {
  hostDisplayDomain,
  hostPlatformDomain,
} from '../../../../constants/tenant-links'

/**
 * `OrgHost` extends Firestore's `DocumentData`, whose index signature shares
 * no DECLARED property with the address helpers' parameter type — so TypeScript
 * rejects the call as a weak-type mismatch even though the fields are there at
 * runtime. Narrowing once here beats a cast at each call site, and it names the
 * two fields these helpers actually read.
 */
const hostAddress = (
  host: Record<string, unknown> | undefined,
): { cname?: string; subdomain?: string } | undefined =>
  host && {
    cname: typeof host.cname === 'string' ? host.cname : undefined,
    subdomain: typeof host.subdomain === 'string' ? host.subdomain : undefined,
  }
import { Container } from '@aglyn/shared-ui-jsx'
import { AppLink } from '@aglyn/shared-ui-jsx'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import ListQueryNotices from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import ListTable, {
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import { listFilterOperatorLabel } from '@aglyn/shared-ui-jsx/const/list-filter'
import { listFilterGridColumns } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import type { ListQuerySort } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import { Box, Button, Chip, Stack, Tooltip, Typography } from '@mui/material'
import type { GridColDef, GridSortModel } from '@mui/x-data-grid'
import { collection, type Firestore } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { useListQuery } from '@aglyn/tenant-feature-instance/hooks/use-list-query'
import CreateHostDialog from '../../../../components/create-host-dialog.component'
import EmptyState from '../../../../components/empty-state.component'
import HostIcon from '../../../../components/host-icon.component'
import AuthenticatedLayout from '../../../../components/layouts/authenticated.layout'
import MarketingConsentPrompt from '../../../../components/marketing-consent-prompt.component'
import OrgDashboardWidgets from '../../../../components/org-dashboard-widgets.component'
import PluginWidgetSlot from '../../../../components/plugin-widget-slot.component'
import OrgInvitesBanner from '../../../../components/org-invites-banner.component'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../components/layouts/main.layout'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import useBranding from '../../../../hooks/use-branding'
import useCurrentOrg from '../../../../hooks/use-current-org'
import { type OrgHost, useOrgHosts } from '../../../../hooks/use-org-hosts'
import { resolveOrgMount } from '../../../../utils/org-mount'
import { readOutcome } from '@aglyn/shared-ui-jsx/utils/read-outcome'
import {
  describeHostStatus,
  describeSiteAllowance,
  type HostStatus,
} from '../../../../utils/host-status'
import {
  SITE_FILTER_FIELDS,
  SITE_LIST_DECLARATION,
  siteListBase,
} from '../../../../utils/site-list-query'
import { useOrgScope, useOrgSlug } from '../../../../hooks/use-org-scope'
import useOrgPermissions from '../../../../hooks/use-org-permissions'
import { usePendingInvites } from '../../../../hooks/use-pending-invites'

/** A site as the list draws it: its host document, plus what its row derives. */
interface SiteRow extends OrgHost {
  status: HostStatus
  /** The platform address, `name.<apex>`, which every site has. */
  platformDomain: string
}

const siteRow = (host: OrgHost): SiteRow => ({
  ...host,
  status: describeHostStatus(host as never),
  platformDomain: hostPlatformDomain(hostAddress(host)) ?? '',
})

/** The chips' and the notices' names for each filterable field. */
const SITE_FILTER_HEADERS: Readonly<Record<string, string>> = {
  displayName: 'Site',
  createdAt: 'Created',
}

/** A Firestore timestamp as the grid's date column takes it. */
const timestampDate = (value: { toDate?: () => Date } | null | undefined) =>
  value?.toDate?.() ?? null

interface SitesTableProps {
  firestore: Firestore
  uid: string | undefined
  /** The workspace, or null for an account with none, as `useOrgHosts` took it. */
  orgId: string | null
  /** Every site the page read, by id — what each listed row is drawn from. */
  hostsById: ReadonlyMap<string, OrgHost>
  orgSlug: string
  productName: string
}

/**
 * THE SITES GRID, PAGED AND FILTERED BY ITS QUERY (AGL-3321).
 *
 * Every clause the Filters panel accepts and the quick search's word are on
 * ONE Firestore query over the reader's `users/{uid}/hostMemberships` rows,
 * scoped to the workspace and ordered by the name or the creation date, and
 * each page is that query's page — see `utils/site-list-query.ts` for what it
 * offers and why the rest is not offered. The query names WHICH sites; the
 * host documents the page already holds (`useOrgHosts`) are what each row
 * DRAWS, joined by id and never used to narrow anything.
 *
 * A membership row whose host the page could not read — a stale row, a site
 * whose read was refused — has nothing to draw and is left out of its page,
 * which then shows one row fewer than it fetched; the pager still turns, since
 * whether a further page exists is the query's answer, not the join's.
 */
function SitesTable(props: SitesTableProps) {
  const { firestore, uid, orgId, hostsById, orgSlug, productName } = props
  const gridFilter = useListGridFilter()
  const [sort, setSort] = useState<ListQuerySort | null>(null)
  const memberships = useMemo(
    () => (uid ? collection(firestore, 'users', uid, 'hostMemberships') : null),
    [firestore, uid],
  )
  const listed = useListQuery<{ $id: string }>({
    collection: memberships,
    declaration: SITE_LIST_DECLARATION,
    request: {
      clauses: gridFilter.clauses,
      search: gridFilter.searchWords,
      sort,
      base: siteListBase(orgId),
    },
    deps: [firestore, uid],
    idField: '$id',
  })
  const { plan } = listed
  const rows = useMemo(
    () =>
      listed.rows.flatMap((membership) => {
        const host = hostsById.get(membership.$id)
        return host ? [siteRow(host)] : []
      }),
    [listed.rows, hostsById],
  )
  const loading = listed.status === 'loading'

  /*
   * The grid sorts by what the QUERY is ordered by — the reader's pick among
   * the declared orders, or the order a range imposes — and a header click
   * asks for another declared order. Every other column is unsortable: an
   * order the query does not hold would sort one page and call it the list.
   */
  const sortModel = useMemo<GridSortModel>(() => {
    const shown = SITE_LIST_DECLARATION.sorts.find(
      (entry) =>
        entry.path === plan.orderBy.path &&
        entry.direction === plan.orderBy.direction,
    )
    return shown?.column
      ? [{ field: shown.column, sort: shown.direction }]
      : []
  }, [plan.orderBy])
  const onSortModelChange = useCallback((model: GridSortModel) => {
    const [asked] = model
    setSort(
      SITE_LIST_DECLARATION.sorts.find((entry) => entry.column === asked?.field) ??
        null,
    )
  }, [])

  const refused = useMemo(
    () =>
      plan.refused.map((entry) => ({
        label:
          entry.clause === 'search'
            ? 'Search'
            : `${SITE_FILTER_HEADERS[entry.clause.field] ?? entry.clause.field} ${listFilterOperatorLabel(entry.clause.op)}`,
        reason: entry.reason,
      })),
    [plan.refused],
  )

  const columns = useMemo<GridColDef[]>(
    () =>
      listFilterGridColumns(
        [
          {
            field: 'displayName',
            headerName: 'Site',
            flex: 1.4,
            minWidth: 220,
            // The query's own order: by name, A to Z.
            sortingOrder: ['asc'],
            renderCell: ({ row }: { row: SiteRow }) => (
              <Stack
                direction="row"
                spacing={1.5}
                sx={{ alignItems: 'center', minWidth: 0, py: 1 }}
              >
                {/* The site's own favicon when it has one (AGL-647), falling
                    back to the generic glyph. */}
                <HostIcon host={row} size={28} fontSize="large" color="primary" />
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="subtitle2" noWrap>
                    {row.displayName}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    component="div"
                    noWrap
                  >
                    {hostDisplayDomain(hostAddress(row))}
                  </Typography>
                </Box>
              </Stack>
            ),
          },
          {
            field: 'status',
            headerName: 'Status',
            width: 140,
            sortable: false,
            // Exported as the key; drawn as the pill.
            valueGetter: (_value: unknown, row: SiteRow) => row.status.key,
            renderCell: ({ row }: { row: SiteRow }) => (
              <Tooltip title={row.status.detail}>
                <Chip
                  size="small"
                  label={row.status.label}
                  color={row.status.color}
                  variant={row.status.color === 'default' ? 'outlined' : 'filled'}
                />
              </Tooltip>
            ),
          },
          {
            field: 'platformDomain',
            headerName: `${productName} domain`,
            flex: 1,
            minWidth: 180,
            sortable: false,
          },
          {
            field: 'cname',
            headerName: 'Custom domain',
            flex: 1,
            minWidth: 160,
            sortable: false,
            valueFormatter: (value: unknown) => (value as string) || 'None',
          },
          {
            field: 'createdAt',
            headerName: 'Created',
            minWidth: 170,
            type: 'date',
            // The query's other order: newest first.
            sortingOrder: ['desc'],
            valueGetter: timestampDate,
            valueFormatter: (value: Date | null) => value?.toLocaleString() || '--',
          },
          {
            field: 'updatedAt',
            headerName: 'Updated',
            minWidth: 170,
            type: 'date',
            sortable: false,
            valueGetter: timestampDate,
            valueFormatter: (value: Date | null) => value?.toLocaleString() || '--',
          },
          listActionsColumn(
            (row: SiteRow) => (
              <Stack direction="row" spacing={0.5}>
                <AppLink
                  componentVariant="button"
                  // `?aglyn-edit` arms the admin bar without the chord
                  // (AGL-1842): on a foreign CUSTOM domain no hint can exist by
                  // construction, so the console's own visit link is the
                  // chord-free path there. hostDisplayDomain rather than a
                  // re-derived apex (AGL-2172), so a self-hosted deployment links
                  // its sites at its own domain.
                  href={`https://${hostDisplayDomain(hostAddress(row))}/?aglyn-edit`}
                  target={'_blank'}
                  rel={'nofollow'}
                >
                  {'Visit'}
                </AppLink>
                <AppLink
                  componentVariant="button"
                  href={buildRoute(Route.HOST_DASHBOARD, {
                    orgSlug,
                    host: row.subdomain,
                  })}
                >
                  {'Manage'}
                </AppLink>
              </Stack>
            ),
            { width: 190 },
          ),
        ],
        SITE_FILTER_FIELDS,
        {},
        SITE_FILTER_HEADERS,
      ),
    [productName, orgSlug],
  )

  return (
    <>
      <ListFilterChips
        fields={SITE_FILTER_FIELDS}
        headers={SITE_FILTER_HEADERS}
        clauses={gridFilter.clauses}
        onChange={gridFilter.setClauses}
      />
      <ListQueryNotices refused={refused} notices={plan.notices} />
      <ListTable
        aria-label="Sites"
        rows={rows}
        columns={columns}
        loading={loading}
        // Two lines: the name over the address a visitor types.
        getRowHeight={() => 'auto'}
        // The pager below owns the page: each is a page of the query.
        hideFooter
        // The panel and the search are the grid's; the QUERY answers both.
        filterMode="server"
        filterModel={gridFilter.filterModel}
        onFilterModelChange={gridFilter.onFilterModelChange}
        quickFilter
        sortingMode="server"
        sortModel={sortModel}
        onSortModelChange={onSortModelChange}
        noRowsLabel={
          listed.status === 'error'
            ? 'These sites could not be loaded'
            : 'No sites match these filters'
        }
      />
      <ListPagination
        page={listed.page}
        pageSize={listed.pageSize}
        rowCount={rows.length}
        hasMore={listed.hasMore}
        disabled={loading}
        onPageChange={(next) => {
          if (next !== listed.page) listed.setPage(next)
        }}
        onPageSizeChange={listed.setPageSize}
      />
    </>
  )
}

function HostsContent() {
  const { data: user } = useUser()
  const firestore = useFirestore()
  const orgSlug = useOrgSlug()
  // The org's resolved brand, never `PLATFORM_BRAND_NAME` (AGL-2350): this
  // page is org-scoped, so the deployment brand would print "Aglyn Domain"
  // to a white-label agency looking at its own client's site.
  const { branding } = useBranding()
  const { currentOrg, loading: orgsLoading } = useOrgScope()
  // Workspace-scoped (AGL-236): the list shows the selected org's sites
  // only — a member of several orgs switches workspaces to see the rest.
  /**
   * `ready` and `error`, not `hosts` alone (AGL-1066).
   *
   * The hook has always offered all three; this page took the array and
   * dropped the two values that say whether the array means anything. On a
   * stale session that turned "we were refused every read" into
   * `No sites yet — Create a site to start building`, under a header that
   * counted the sites it had failed to load. The list even PAINTED first,
   * because `persistentLocalCache` answers each listen before the server
   * refuses it — so the customer watched their sites vanish and was then
   * invited to make a new one.
   */
  const {
    hosts: data,
    ready: hostsReady,
    error: hostsError,
    retry: retryHosts,
  } = useOrgHosts(
    firestore,
    user?.uid,
    orgsLoading ? undefined : (currentOrg?.$id ?? null),
  )
  // The workspace has to resolve before the site read can even start, so an
  // unresolved workspace is this list still loading.
  const hostsRead = orgsLoading
    ? 'loading'
    : readOutcome({ ready: hostsReady, error: hostsError })
  const [creating, setCreating] = useState(false)
  const { permissions } = useOrgPermissions()
  /**
   * `6 of 10 sites · Business plan` (AGL-2166). The console mockup puts
   * this opposite the Sites heading, and nothing on the page counted hosts
   * or named the plan — the only host-against-limit meter in the product
   * was on the Billing page, which is not where anyone is standing when
   * they run out of sites.
   */
  const { org, ready: orgReady } = useCurrentOrg()
  const allowance = describeSiteAllowance({
    used: data?.length ?? 0,
    limit: resolveOrgEntitlements(org as never)?.hostLimit,
    planLabel: isEnterpriseOrg(org as never)
      ? ENTERPRISE_PLAN_LABEL
      : // The plan the limit beside it resolved from — a staff comp or a
        // dead subscription included (AGL-3034) — never the stored field.
        PLAN_LABELS[resolveEffectivePlan(org as never)],
    // Both reads, not just the org's (AGL-1066). `used` comes from the SITE
    // list, so gating this on the ORG being ready published a count taken
    // from a list that had not loaded — `0 of Unlimited sites · Enterprise
    // plan` reads as a measurement, and it was a placeholder.
    ready: orgReady && hostsRead === 'loaded',
  })
  // When the user has a pending invite, the banner's "accept" is the primary
  // path to their first org — so the zero-state steps aside to avoid two
  // competing calls to action (AGL-234).
  const { invites } = usePendingInvites()
  /**
   * The organization-level mount for the dashboard row (AGL-2636), from the
   * site list this page already holds — the same shape the org CRM hub hands
   * its plugin page, so a card on the row totals the organization the way
   * the hub does, and costs no second read of the sites.
   */
  const orgId = currentOrg?.$id
  const orgMount = useMemo(
    () =>
      resolveOrgMount({
        orgId,
        orgSlug,
        hosts: data ?? [],
        hostsReady,
      }),
    [orgId, orgSlug, data, hostsReady],
  )

  // The sites the list's rows are drawn from, by id. The meter, the dashboard
  // row and the plugin slot above count `data` itself — every site, whatever
  // the grid is filtered to.
  const hostsById = useMemo(
    () => new Map((data ?? []).map((host) => [host.$id, host])),
    [data],
  )

  return (
    <DashboardLayout
      breadcrumbItems={[
        {
          children: 'Sites',
          href: buildRoute(Route.HOST_LIST, { orgSlug }),
        },
      ]}
      help={{ topic: 'consoleTour', anchor: '#the-sites-list' }}
      header={{
        children: 'All Sites',
        icon: { path: ICON_VARIANT_HOST_GROUP.path },
      }}
      headerRight={
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          {allowance ? (
            <Typography variant="body2" color="text.secondary">
              {allowance}
            </Typography>
          ) : null}
          {permissions.createHosts ? (
            <Button
              variant="contained"
              color="primary"
              onClick={() => setCreating(true)}
            >
              {'Create site'}
            </Button>
          ) : null}
        </Stack>
      }
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        {/* Pending org invites (AGL-234). */}
        <OrgInvitesBanner />
        {/* The one-time product-updates ask (AGL-3185): a single-workspace
            member is sent straight here from the workspace chooser, so this
            is where most accounts land. Renders nothing once answered. */}
        <MarketingConsentPrompt />
        {/* The `invites.length === 0` deferral is about which CALL TO ACTION
            leads (AGL-234) and only applies to a genuine zero-state; a read we
            could not finish still has to say so. */}
        {(data?.length ?? 0) === 0 &&
        (hostsRead !== 'loaded' || invites.length === 0) ? (
          <EmptyState
            read={hostsRead}
            subject="your sites"
            onRetry={retryHosts}
            iconPath={ICON_VARIANT_HOST_GROUP.path}
            title={
              currentOrg ? 'No sites yet' : 'Create your first site'
            }
            description={
              currentOrg
                ? 'Create a site to start building — it will live in this ' +
                  'workspace.'
                : 'Your first site sets up your workspace automatically — ' +
                  'no separate setup needed.'
            }
            action={
              permissions.createHosts ? (
                <Button
                  variant="contained"
                  color="primary"
                  onClick={() => setCreating(true)}
                >
                  {'Create site'}
                </Button>
              ) : undefined
            }
          />
        ) : (
        <>
          {/* The organization's dashboard row (AGL-2636): the plugin cards
              that total every site, above the sites they total. Gated on the
              org CRM hub's own access verdict and absent — no row, no gap —
              for a reader it refuses or when no card survives the gates. */}
          <OrgDashboardWidgets
            orgMount={orgMount}
            basePath={buildRoute(Route.ORG_CRM, { orgSlug })}
          />
          {/* Actions a plugin takes across many of these sites at once
              (AGL-2911). Held until the mount resolves, since a widget here
              acts on the sites the page read. */}
          {orgMount && (
            <PluginWidgetSlot
              slot="orgSites"
              hostId={null}
              orgMount={orgMount}
              basePath={buildRoute(Route.HOST_LIST, { orgSlug })}
            />
          )}
        <SitesTable
          firestore={firestore}
          uid={user?.uid}
          orgId={currentOrg?.$id ?? null}
          hostsById={hostsById}
          orgSlug={orgSlug}
          productName={branding.productName}
        />
        </>
        )}
      </Container>
      <CreateHostDialog open={creating} onClose={() => setCreating(false)} />
    </DashboardLayout>
  )
}

function Hosts() {
  return <HostsContent />
}
Hosts.displayName = 'Page:Hosts'

export default Hosts
