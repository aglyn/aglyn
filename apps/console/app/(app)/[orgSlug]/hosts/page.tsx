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
import ListTable, {
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import {
  inMemoryListField,
  type ListFilterOption,
} from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { hiddenFilterVisibility } from '@aglyn/shared-ui-jsx/const/list-filter'
import { useListRowsFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-rows-filter'
import { liveCustomDomain } from '@aglyn/aglyn/app-utils/host-naming'
import { Box, Button, Chip, Stack, Tooltip, Typography } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { useMemo, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
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
  HOST_STATUS_LABELS,
  type HostStatus,
} from '../../../../utils/host-status'
import { useOrgScope, useOrgSlug } from '../../../../hooks/use-org-scope'
import useOrgPermissions from '../../../../hooks/use-org-permissions'
import { usePendingInvites } from '../../../../hooks/use-pending-invites'

/** A site as the list reads it: its document, plus what its row derives. */
interface SiteRow extends OrgHost {
  status: HostStatus
  /** `status.key`, where the Status filter reads it. */
  statusKey: HostStatus['key']
  /** The platform address, `name.<apex>`, which every site has. */
  platformDomain: string
  /** Whether the custom domain serves, is claimed but not serving, or is unset. */
  customDomainState: CustomDomainState
}

/**
 * A custom domain's state, from the fields the domain routes write:
 * `connected` is a domain `liveCustomDomain` would send visitors to;
 * `pending` is a `cname` held while its attach or release is unfinished;
 * `none` is no `cname` at all.
 */
type CustomDomainState = 'connected' | 'pending' | 'none'
const CUSTOM_DOMAIN_STATE_LABELS: Readonly<Record<CustomDomainState, string>> = {
  connected: 'Connected',
  pending: 'Pending',
  none: 'None',
}

const customDomainState = (host: OrgHost): CustomDomainState =>
  liveCustomDomain({
    cname: host.cname,
    cnameAttachmentPending: host.cnameAttachmentPending,
    cnameDetachmentPending: host.cnameDetachmentPending,
  })
    ? 'connected'
    : host.cname
      ? 'pending'
      : 'none'

/*
 * What the Sites grid's Filters panel and quick search offer. The page holds
 * EVERY site the reader has in this workspace — `useOrgHosts` reads each one
 * by id from the membership mirror, with no query over `hosts` to narrow and
 * no page to stop at — so every filter and the search are answered over the
 * whole list, not a window of it.
 *
 * Only what a host document stores, or derives from what it stores: the plan
 * belongs to the organization rather than the site, and nothing records who
 * created a site or which template it began from, so none of those is
 * offered.
 */
const SITE_FILTER_FIELDS = [
  inMemoryListField('displayName', 'text'),
  inMemoryListField('status', 'select', 'statusKey'),
  inMemoryListField('platformDomain', 'text'),
  inMemoryListField('cname', 'text'),
  inMemoryListField('customDomainState', 'select'),
  inMemoryListField('createdAt', 'date'),
  inMemoryListField('updatedAt', 'date'),
]
/** The chips' names for each field; the platform domain's carries the brand. */
const siteFilterHeaders = (
  productName: string,
): Readonly<Record<string, string>> => ({
  displayName: 'Site',
  status: 'Status',
  platformDomain: `${productName} domain`,
  cname: 'Custom domain',
  customDomainState: 'Custom domain status',
  createdAt: 'Created',
  updatedAt: 'Updated',
})
const SITE_FILTER_OPTIONS: Readonly<Record<string, readonly ListFilterOption[]>> = {
  status: Object.entries(HOST_STATUS_LABELS).map(([value, label]) => ({
    value,
    label,
  })),
  customDomainState: Object.entries(CUSTOM_DOMAIN_STATE_LABELS).map(
    ([value, label]) => ({ value, label }),
  ),
}
/** The grid's own columns; every other field is a panel-only column. */
const SITE_COLUMNS = [
  'displayName',
  'status',
  'platformDomain',
  'cname',
  'createdAt',
  'updatedAt',
]
/** Name, both addresses, and the slug the platform address is built from. */
const SITE_SEARCH_FIELDS = [
  'displayName',
  'subdomain',
  'platformDomain',
  'cname',
] as const

/** A Firestore timestamp as the grid's date column takes it. */
const timestampDate = (value: { toDate?: () => Date } | null | undefined) =>
  value?.toDate?.() ?? null

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

  const siteRows = useMemo<SiteRow[]>(
    () =>
      (data ?? []).map((host) => {
        const status = describeHostStatus(host as never)
        return {
          ...host,
          status,
          statusKey: status.key,
          platformDomain: hostPlatformDomain(hostAddress(host)) ?? '',
          customDomainState: customDomainState(host),
        }
      }),
    [data],
  )
  // Filters the rows the grid draws, never `data`: the site meter, the
  // dashboard row and the plugin slot above count every site, filtered or not.
  const siteHeaders = useMemo(
    () => siteFilterHeaders(branding.productName),
    [branding.productName],
  )
  const siteFilter = useListRowsFilter({
    rows: siteRows,
    fields: SITE_FILTER_FIELDS,
    options: SITE_FILTER_OPTIONS,
    headers: siteHeaders,
    search: SITE_SEARCH_FIELDS,
  })
  const siteColumns = useMemo<GridColDef[]>(
    () => [
      {
        field: 'displayName',
        headerName: 'Site',
        flex: 1.4,
        minWidth: 220,
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
        // Sorted and filtered by the key; drawn as the pill.
        valueGetter: (_value: unknown, row: SiteRow) => row.statusKey,
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
        headerName: siteHeaders.platformDomain,
        flex: 1,
        minWidth: 180,
      },
      {
        field: 'cname',
        headerName: 'Custom domain',
        flex: 1,
        minWidth: 160,
        valueFormatter: (value: unknown) => (value as string) || 'None',
      },
      {
        field: 'createdAt',
        headerName: 'Created',
        minWidth: 170,
        type: 'date',
        valueGetter: timestampDate,
        valueFormatter: (value: Date | null) => value?.toLocaleString() || '--',
      },
      {
        field: 'updatedAt',
        headerName: 'Updated',
        minWidth: 170,
        type: 'date',
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
    [siteHeaders, orgSlug],
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
        <ListFilterChips {...siteFilter.chipsProps} />
        <ListTable
          aria-label="Sites"
          rows={siteFilter.rows}
          columns={siteFilter.filterColumns(siteColumns)}
          // Two lines: the name over the address a visitor types.
          getRowHeight={() => 'auto'}
          // The panel and the search are the grid's; the page answers them
          // over every site it read, and the grid's own footer pages what
          // matches.
          {...siteFilter.gridProps}
          noRowsLabel="No sites match these filters"
          initialState={{
            columns: {
              columnVisibilityModel: hiddenFilterVisibility(
                SITE_FILTER_FIELDS,
                SITE_COLUMNS,
              ),
            },
          }}
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
