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

import { mdiStorefrontOutline } from '@aglyn/shared-data-mdi'
import { Container } from '@aglyn/shared-ui-jsx'
import {
  HubSections,
  useActiveSection,
} from '@aglyn/shared-ui-next/components/hub-tabs'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { Alert, Box, CircularProgress, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import FeatureGate from '../../../../../components/feature-gate.component'
import DashboardLayout from '../../../../../components/layouts/dashboard.layout'
import { buildRoute, Route } from '../../../../../constants/route-links'
import { marketplaceSections } from '../../../../../constants/marketplace-sections'
import { CONTENT_MAX_WIDTH } from '../../../../../constants/shared'
import { useOrgHosts } from '../../../../../hooks/use-org-hosts'
import { useOrgScope, useOrgSlug } from '../../../../../hooks/use-org-scope'
import useOrgPermissions from '../../../../../hooks/use-org-permissions'

export interface MarketplaceScope {
  /** The org whose marketplace this is, or null before it resolves. */
  orgId: string | null
  orgSlug: string
  /**
   * The site an install acts through. Installs pin to a site and pins are
   * validated against host membership, so every section that installs needs
   * the same answer — which is why it is held here rather than per section.
   */
  actingHost: string
  hostList: Array<{ id: string; label: string }>
  permissions: Record<string, boolean | undefined>
}

const MarketplaceScopeContext = createContext<MarketplaceScope | null>(null)

/**
 * The hub state a section needs but must not own (AGL-2501).
 *
 * Sections are separate routes, so anything two of them share has to live in
 * the layout that survives navigation between them. Held in context rather
 * than re-derived per page because `useOrgHosts` is a live subscription: a
 * copy per section would open a second listener and let the acting site reset
 * itself every time the reader moved along the rail.
 */
export function useMarketplaceScope(): MarketplaceScope {
  const scope = useContext(MarketplaceScopeContext)
  if (!scope) {
    throw new Error('useMarketplaceScope must be used inside the sections layout')
  }
  return scope
}

/**
 * Org marketplace (AGL-772), section by section (AGL-2501).
 *
 * The app owns only the chrome — every section's body is the marketplace
 * plugin's widget or a console panel, and the app never imports the plugin.
 */
export default function MarketplaceSectionsLayout({
  children,
}: {
  children: ReactNode
}) {
  const orgSlug = useOrgSlug()
  const { currentOrg, loading } = useOrgScope()
  const { data: user } = useUser()
  const firestore = useFirestore()
  const { permissions, loaded: permissionsLoaded } = useOrgPermissions()

  const { hosts } = useOrgHosts(
    firestore,
    user?.uid,
    loading ? undefined : (currentOrg?.$id ?? null),
  )
  const typedHosts =
    (hosts as Array<{
      $id: string
      subdomain?: string
      displayName?: string
    }>) ?? []
  // Key the memo on the hosts' CONTENT, not the array's identity: `useOrgHosts`
  // hands back a fresh array on each snapshot, so a new-but-equal `hostList`
  // on every parent render is the prop churn AGL-785 fingered. A stable string
  // key holds it until a host is actually added, removed, or renamed.
  const hostsKey = typedHosts
    .map((host) => `${host.$id}:${host.displayName || host.subdomain || ''}`)
    .join('|')
  const hostList = useMemo(
    () =>
      typedHosts.map((host) => ({
        id: host.$id,
        label: host.displayName || host.subdomain || host.$id,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hostsKey],
  )
  const [selectedHost, setSelectedHost] = useState('')
  const actingHost = selectedHost || hostList[0]?.id || ''

  /*
   * `permissionsLoaded &&` is load-bearing, not defensive. `useOrgPermissions`
   * fails OPEN — the map answers as an ADMIN's until the member read lands —
   * so offering the seller sections during that window hands every member the
   * rail into Payouts and Sales, which render the org's revenue.
   */
  const canSell = permissionsLoaded && !!permissions.publishToMarketplace

  /*
   * One list, read three times — by the rail, by the breadcrumb, and by the
   * refusal below. Hoisted so all three resolve against the same array: a
   * section added to the list is drawn, named in the trail, and gated by
   * construction rather than by somebody remembering three copies.
   */
  const all = useMemo(() => marketplaceSections(orgSlug), [orgSlug])

  /*
   * Resolved against EVERY section, including the ones this reader may not
   * open, and that is the point. `useActiveSection` skips `visible: false`, so
   * resolving against the rail's filtered list would answer `null` for exactly
   * the URLs that need refusing — leaving a member on a seller route with no
   * breadcrumb, no rail selection, and the page rendered underneath.
   */
  const active = useActiveSection(
    useMemo(
      () => all.map(({ href, label }) => ({ href, label })),
      [all],
    ),
  )
  const activeIsSeller = all.some(
    (section) => section.seller && section.href === active?.href,
  )

  /** What the rail draws: the seller sections only for a publisher. */
  const sections = useMemo(
    () =>
      all.map((section) => ({
        href: section.href,
        label: section.label,
        visible: section.seller ? canSell : true,
      })),
    [all, canSell],
  )

  const scope = useMemo<MarketplaceScope>(
    () => ({
      orgId: currentOrg?.$id ?? null,
      orgSlug,
      actingHost,
      hostList,
      permissions,
    }),
    [currentOrg?.$id, orgSlug, actingHost, hostList, permissions],
  )

  return (
    <DashboardLayout
      breadcrumbItems={[
        {
          children: 'Marketplace',
          href: buildRoute(Route.ORG_MARKETPLACE, { orgSlug }),
        },
        // The section the reader is actually on. Without it the trail names
        // every level except theirs — the one that says where they are.
        ...(active ? [{ children: active.label, href: active.href }] : []),
      ]}
      help={{ topic: 'plugins', anchor: '#install--upgrade' }}
      header={{
        children: 'Marketplace',
        icon: { path: mdiStorefrontOutline.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        {/*
          The gate the flag always assumed was here (AGL-2019).
          `release_marketplace` feeds the plugin LOADER as well as nav
          visibility, so switching it off subtracts the marketplace plugin from
          the console and both API dispatchers. Without this the hub went on
          rendering in full, its widgets silently empty, reachable by deep link
          and by every bookmark — which made turning the feature off its own
          broken state, and "just turn the flag off" useless advice to a
          self-hoster who does not want a marketplace.
        */}
        <FeatureGate flag="release_marketplace">
          {!loading && !currentOrg ? (
            <Alert severity="info">
              {'Create your first site to start an organization, then browse ' +
                'and install marketplace items here.'}
            </Alert>
          ) : !permissionsLoaded ? (
            /*
             * A spinner, not the rail. The permission map fails open, so
             * drawing the sections during that window offers Payouts and Sales
             * to a member who is about to be refused them. Accusing a
             * legitimate publisher on every navigation is the same bug
             * mirrored, so neither: wait.
             */
            <Box sx={{ p: 2 }}>
              <CircularProgress size={24} />
            </Box>
          ) : !actingHost ? (
            <Alert severity="info">
              {'Add a site to your organization to install marketplace ' +
                'items — installs apply to a site (or every site).'}
            </Alert>
          ) : (
            <MarketplaceScopeContext.Provider value={scope}>
              <Stack spacing={2}>
                {hostList.length > 1 ? (
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                  >
                    <Typography variant="body2" color="text.secondary">
                      {'Acting site'}
                    </Typography>
                    <TextField
                      select
                      size="small"
                      label="Site"
                      value={actingHost}
                      onChange={(event) => setSelectedHost(event.target.value)}
                      sx={{ minWidth: 200 }}
                    >
                      {hostList.map((host) => (
                        <MenuItem key={host.id} value={host.id}>
                          {host.label}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Stack>
                ) : null}
                <HubSections sections={sections}>
                  {/*
                    The refusal a hidden tab used to provide for free.
                    As panels, the seller sections were simply not rendered for
                    a member without `publishToMarketplace`. As routes each one
                    has a URL that can be typed, linked or bookmarked, and the
                    rail no longer decides what is reachable — so the gate has
                    to sit above the pages. A notice, not the boundary: the
                    rules and the publish API enforce this regardless of what
                    renders.
                  */}
                  {activeIsSeller && !canSell ? (
                    <Alert severity="info">
                      {'Publishing, payouts and sales are limited to members ' +
                        'with permission to publish to the marketplace.'}
                    </Alert>
                  ) : (
                    children
                  )}
                </HubSections>
              </Stack>
            </MarketplaceScopeContext.Provider>
          )}
        </FeatureGate>
      </Container>
    </DashboardLayout>
  )
}
