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

import { ICON_VARIANT_HOST_GROUP } from '@aglyn/shared-data-enums'
import { Container, GridItems } from '@aglyn/shared-ui-jsx'
import { AppLink } from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import { Button, Typography } from '@mui/material'
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
import useOrgNavTabItems from '../../../../hooks/use-org-nav-tabs'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import { useOrgHosts } from '../../../../hooks/use-org-hosts'
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
              bgcolor: `rgba(${tv.palette.tertiary.lightChannel} / 0.18)`,
              border: `1px solid rgba(${tv.palette.tertiary.lightChannel} / 0.72)`,
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
  const { currentOrg, loading: orgsLoading } = useOrgScope()
  // Workspace-scoped (AGL-236): the list shows the selected org's sites
  // only — a member of several orgs switches workspaces to see the rest.
  const { hosts: data } = useOrgHosts(
    firestore,
    user?.uid,
    orgsLoading ? undefined : (currentOrg?.$id ?? null),
  )
  const [creating, setCreating] = useState(false)
  const { permissions } = useOrgPermissions()
  const orgNavTabs = useOrgNavTabItems()
  // When the user has a pending invite, the banner's "accept" is the primary
  // path to their first org — so the zero-state steps aside to avoid two
  // competing calls to action (AGL-234).
  const { invites } = usePendingInvites()

  return (
    <>
      <NextPageTitle screen={'Settings'} />
      <DashboardLayout
        navTabItems={orgNavTabs}
        activeTab={buildRoute(Route.HOST_LIST, { orgSlug })}
        breadcrumbItems={[
          {
            children: 'Sites',
            href: buildRoute(Route.HOST_LIST, { orgSlug }),
          },
        ]}
        help="gettingStarted"
        header={{
          children: 'All Sites',
          icon: { path: ICON_VARIANT_HOST_GROUP.path },
        }}
        headerRight={
          permissions.createHosts ? (
            <Button
              variant="contained"
              color="secondary"
              onClick={() => setCreating(true)}
            >
              {'Create site'}
            </Button>
          ) : undefined
        }
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          {/* Pending org invites (AGL-234). */}
          <OrgInvitesBanner />
          {!orgsLoading && (data?.length ?? 0) === 0 && invites.length === 0 ? (
            <EmptyState
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
                    color="secondary"
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
                      // falling back to the generic glyph — same treatment as
                      // the site switcher.
                      avatar: (
                        <HostIcon
                          host={host}
                          size={28}
                          fontSize="large"
                          color="secondary"
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
                    subheader={host?.$id}
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
                          href={`https://${
                            host?.cname || `${host?.subdomain}.aglyn.app`
                          }`}
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
                        label={'Aglyn Domain'}
                        value={`${host?.subdomain}.aglyn.app`}
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
    </>
  )
}

function Hosts() {
  return <HostsContent />
}
Hosts.displayName = 'Page:Hosts'

export default Hosts
