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
import { Container, GridItems } from '@aglyn/shared-ui-jsx'
import { AppLink } from '@aglyn/shared-ui-jsx'
import { Button, Chip, Stack, Tooltip, Typography } from '@mui/material'
import { useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import CreateHostDialog from '../../../../components/create-host-dialog.component'
import EmptyState from '../../../../components/empty-state.component'
import HostIcon from '../../../../components/host-icon.component'
import AuthenticatedLayout from '../../../../components/layouts/authenticated.layout'
import OrgInvitesBanner from '../../../../components/org-invites-banner.component'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../components/layouts/main.layout'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import useBranding from '../../../../hooks/use-branding'
import useCurrentOrg from '../../../../hooks/use-current-org'
import { useOrgHosts } from '../../../../hooks/use-org-hosts'
import { readOutcome } from '../../../../utils/read-outcome'
import {
  describeHostStatus,
  describeSiteAllowance,
} from '../../../../utils/host-status'
import { useOrgScope, useOrgSlug } from '../../../../hooks/use-org-scope'
import useOrgPermissions from '../../../../hooks/use-org-permissions'
import { usePendingInvites } from '../../../../hooks/use-pending-invites'

function HostInfoItem({ label, value }) {
  return (
    <>
      <Typography component="div">
        <Typography
          variant="caption"
          sx={{
            display: "inline",
            textTransform: 'uppercase'
          }}>
          <b>{label}:</b>
        </Typography>{' '}
        <Typography
          variant="body1"
          sx={[{
            display: "inline"
          }, (theme) => {
            const tv = (theme as any).vars || theme
            return {
              bgcolor: `rgba(${tv.palette.secondary.lightChannel} / 0.18)`,
              border: `1px solid rgba(${tv.palette.secondary.lightChannel} / 0.72)`,
              borderRadius: '0.3em',
              px: 0.5,
              py: 0.15,
              wordBreak: 'break-word',
              fontSize: '0.8rem',
            }
          }]}>
          {value || <i>{'None'}</i>}
        </Typography>
      </Typography>
    </>
  );
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
      : PLAN_LABELS[((org as any)?.plan ?? 'free') as keyof typeof PLAN_LABELS],
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
        <GridItems
          spacing={3}
          items={[
            ...(data || []).map((host) => ({
              size: {
                xs: 12,
                md: 4,
              },
              children: (
                <CardDisplay
                  contentGutterX
                  contentGutterY
                  contentBordered="bottom"
                  HeaderProps={{
                    // The site's own favicon when it has one (AGL-647),
                    // falling back to the generic glyph. This list reads real
                    // host docs; the switcher reads the hostMemberships
                    // projection, which had to learn the field separately
                    // before the two actually matched (AGL-1071).
                    // The Live/Draft pill sits in the header's ACTION slot
                    // (top-right) rather than above the domain rows: inline in
                    // the content it shared a line with the first
                    // `HostInfoItem` label and read as part of it.
                    action: (() => {
                      const status = describeHostStatus(host as never)
                      return (
                        <Tooltip title={status.detail}>
                          <Chip
                            size="small"
                            label={status.label}
                            color={status.color}
                            variant={
                              status.color === 'default' ? 'outlined' : 'filled'
                            }
                          />
                        </Tooltip>
                      )
                    })(),
                    avatar: (
                      <HostIcon
                        host={host}
                        size={28}
                        fontSize="large"
                        color="primary"
                      />
                    ),
                    slotProps: {
                      title: {
                        // variant: 'h6',
                        noWrap: true,
                        sx: {
                          // Function callbacks and textOverflow must live
                          // inside sx — passing them as direct Typography
                          // props causes React DOM attribute warnings in v9.
                          textOverflow: 'ellipsis',
                          overflow: 'hidden',
                          fontSize: ({ typography }) =>
                            typography.subtitle1.fontSize,
                          fontWeight: ({ typography }) =>
                            typography.h6.fontWeight,
                        },
                      },
                      subheader: {
                        sx: {
                          fontSize: ({ typography }) =>
                            typography.caption.fontSize,
                        },
                      },
                    },
                  }}
                  subheader={hostDisplayDomain(hostAddress(host))}
                  header={host?.displayName}
                  help={docsHelp('gettingStarted', {
                    anchor: '#what-a-site-contains',
                    title: 'Your sites',
                    excerpt:
                      'Each site has its own screens, media, users, and ' +
                      'settings. Visit opens the live site; Manage opens ' +
                      'its dashboard.',
                  })}
                  actions={
                    <>
                      <AppLink
                        componentVariant="button"
                        // `?aglyn-edit` arms the admin bar without the
                        // chord (AGL-1842): on a foreign CUSTOM domain no
                        // hint can exist by construction — a console
                        // visitor is an editor, so the console's own visit
                        // link is the chord-free path there. Harmless
                        // everywhere else (same arming the param always
                        // did).
                        // hostDisplayDomain, not a re-derived apex
                        // (AGL-2172): tenant-links.ts exists so this does not
                        // have to know the apex, and re-deriving it here meant
                        // a self-hoster's Sites list linked every one of their
                        // sites at OUR domain.
                        href={`https://${hostDisplayDomain(hostAddress(host))}/?aglyn-edit`}
                        target={'_blank'}
                        rel={'nofollow'}
                      >
                        {'Visit'}
                      </AppLink>
                      <AppLink
                        componentVariant="button"
                        href={buildRoute(Route.HOST_DASHBOARD, {
                          orgSlug,
                          host: host.subdomain,
                        })}
                      >
                        {'Manage'}
                      </AppLink>
                    </>
                  }
                >
                  <Typography color="textSecondary" component="div">
                    <HostInfoItem
                      label={`${branding.productName} Domain`}
                      value={hostPlatformDomain(hostAddress(host))}
                    />
                    <HostInfoItem
                      label={'Custom Domain'}
                      value={host?.cname}
                    />
                  </Typography>
                </CardDisplay>
              ),
            })),
          ]}
        />
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
