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

import type { ConsolePluginPageProps } from '@aglyn/aglyn'
import { HubSections } from '@aglyn/shared-ui-next/components/hub-tabs'
import { AppLink } from '@aglyn/shared-ui-jsx'
import {
  Alert,
  Button,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import HostPluginsCard from './host-plugins-card.component'
import ListingDetailPage from './listing-detail-page.component'
import MarketplaceBrowse from './marketplace-browse.component'
import MarketplacePaymentsNotice from './marketplace-payments-notice.component'
import OrgLicencesPanel from './org-licences-panel.component'
import OrgPublishPanel from './org-publish-panel.component'
import OrgSellerPanel from './org-seller-panel.component'
import PublisherProfilePage from './publisher-profile-page.component'
import PublishPluginPage from './publish-plugin-page.component'

/**
 * The Marketplace hub (AGL-772/2501), as a plugin surface (AGL-3080).
 *
 * ## What moved, and what did not
 *
 * Every section of this hub — browse, installed, licences, and the four
 * seller cards — was a hand-written console route under
 * `app/(app)/[orgSlug]/marketplace/`, ten route files whose whole job was to
 * assemble chrome around a body that already belonged to this plugin. The
 * shell's generic org plugin route does that assembly for every other
 * surface, from one declaration. So the declaration is now in `plugin.ts`
 * and this is the body.
 *
 * NO URL CHANGED. `ConsoleNavItem.ownsSubtree` is what makes that true: a
 * segment naming a declared section resolves as a section, and anything else
 * beneath the surface is handed over as `segments` for this page to read. So
 * `/{org}/marketplace/browse` is still the browse tab and
 * `/{org}/marketplace/{listingId}` is still a listing — the same addresses,
 * served by a declaration instead of by seventeen files.
 *
 * ## The gates are the shell's now, and that is the point
 *
 * The seller sections read the organization's REVENUE and its payout account,
 * and the old sections layout gated them itself — above the pages rather than
 * in the rail, because a route can be typed whether or not a tab was ever
 * offered. That is exactly what `ConsoleNavSection.permission` does, applied
 * by the same shell that hides the tab, so a hidden tab and a refused deep
 * link are one verdict instead of two copies of one. The permission map fails
 * OPEN while it loads, and the shell holds the whole page on it — so this
 * component never has to know that.
 *
 * Likewise `release_marketplace`: the sections layout wrapped itself in a
 * `FeatureGate` because the flag also feeds the plugin LOADER, and a hub that
 * went on rendering with its widgets empty made turning the feature off its
 * own broken state (AGL-2019). The shell applies the same flag through the
 * nav item's `navTabId`, around the same page.
 */
export function MarketplaceHub(props: ConsolePluginPageProps) {
  const {
    orgMount,
    basePath,
    sections,
    section,
    segments,
    permissions,
    viewerOrgs,
    org,
  } = props

  const orgId = orgMount?.orgId ?? null
  const orgSlug = orgMount?.orgSlug ?? ''
  const hostList = useMemo(
    () => (orgMount?.hosts ?? []).map((host) => ({ id: host.id, label: host.name })),
    [orgMount?.hosts],
  )
  /**
   * The site an install acts through. Installs pin to a site and pins are
   * validated against host membership, so every section that installs needs
   * the same answer — which is why it is chosen once here rather than per
   * section.
   */
  const [selectedHost, setSelectedHost] = useState('')
  const actingHost = selectedHost || hostList[0]?.id || ''

  const mount = basePath ?? ''

  if (!orgId) {
    return (
      <Alert severity="info">
        {'Create your first site to start an organization, then browse and ' +
          'install marketplace items here.'}
      </Alert>
    )
  }

  /*
   * An entity beneath the surface, not a section: `ownsSubtree` hands those
   * over with no `section` set. Each owns its own chrome, and none of them
   * takes the acting-site picker or the section rail — a listing is one
   * thing, not a tab of the hub.
   */
  if (!section && segments?.length) {
    if (segments[0] === 'publish' && segments[1] === 'plugin') {
      return (
        <PublishPluginPage
          orgId={orgId}
          basePath={mount}
          permissions={permissions}
          /*
           * The shell holds this whole page behind a spinner until the
           * permission map settles — it fails OPEN, so rendering on it early
           * offers a publish form to a member who is about to be refused.
           * Mounted at all therefore means settled, and saying so here keeps
           * the form's own gate honest when it is mounted anywhere else.
           */
          permissionsLoaded
        />
      )
    }
    if (segments[0] === 'publisher' && segments[1]) {
      return (
        <PublisherProfilePage
          segment={String(segments[1])}
          basePath={mount}
          actingHost={actingHost}
          permissions={permissions}
          orgSlug={orgSlug}
        />
      )
    }
    // Anything else one level down is a listing id. The surface owns its
    // subtree, so it also owns saying "no such thing" — which the detail page
    // has to be able to do anyway for a listing deleted while a link to it
    // was still in someone's inbox.
    if (segments.length === 1) {
      return (
        <ListingDetailPage
          listingId={String(segments[0])}
          orgId={orgId}
          basePath={mount}
          actingHost={actingHost}
          hosts={hostList}
          permissions={permissions}
          orgSlug={orgSlug}
        />
      )
    }
    return (
      <Alert severity="warning">
        {'This marketplace page does not exist. It may have moved, or the ' +
          'link may be incomplete.'}
      </Alert>
    )
  }

  if (!actingHost) {
    return (
      <Alert severity="info">
        {'Add a site to your organization to install marketplace items — ' +
          'installs apply to a site (or every site).'}
      </Alert>
    )
  }

  return (
    <Stack spacing={2}>
      {/*
        What this deployment cannot do, said BEFORE the click (AGL-2019). The
        app supplies only the fact, through the deployment-capability context
        its org layout provides; the sentence is this plugin's, because it
        names what still works without a Stripe platform. Draws nothing at all
        on a configured deployment.
      */}
      <MarketplacePaymentsNotice />
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
      <HubSections sections={sections ?? []}>
        {section === 'browse' ? (
          <MarketplaceBrowse
            hostId={actingHost}
            permissions={permissions}
            orgScoped
            // The shell already knows the org (AGL-867): passing it keeps
            // listing links resolving synchronously instead of via an async
            // hostIndex→org lookup that can come back empty and leave the
            // detail page unreachable from browse.
            orgSlug={orgSlug}
          />
        ) : section === 'installed' ? (
          <Stack spacing={2}>
            {/* A convenience, not the inventory (AGL-1011). Administering what
                you already run belongs in Plugins; this stays so uninstalling
                something you just installed does not send you elsewhere. */}
            <Alert
              severity="info"
              action={
                <AppLink href={`/${orgSlug}/plugins`}>
                  <Button size="small" color="inherit" component="span">
                    {'Open Plugins'}
                  </Button>
                </AppLink>
              }
            >
              {'A quick list of what this organization installed from the ' +
                'marketplace. Settings, per-site scope and built-in plugins ' +
                'live in Plugins.'}
            </Alert>
            <HostPluginsCard hostId={actingHost} orgSlug={orgSlug} />
          </Stack>
        ) : section === 'licences' ? (
          <OrgLicencesPanel
            orgId={orgId}
            basePath={mount}
            viewerOrgs={viewerOrgs}
          />
        ) : section === 'upload' ? (
          <OrgPublishPanel
            orgId={orgId}
            hosts={hostList}
            basePath={mount}
            billingPath={orgMount?.billingPath}
            org={org as never}
            // The shell holds this page behind a spinner until the org doc
            // settles, so an org in hand means an org that arrived. Stated
            // rather than assumed: the fee this panel prints is a claim about
            // a publisher's plan, and the free rate is what an absent doc
            // resolves to.
            orgReady={Boolean(org)}
          />
        ) : section === 'profile' ||
          section === 'listings' ||
          section === 'payouts' ||
          section === 'sales' ? (
          <OrgSellerPanel orgId={orgId} section={section} basePath={mount} />
        ) : null}
      </HubSections>
    </Stack>
  )
}

MarketplaceHub.displayName = 'MarketplaceHub'

export default MarketplaceHub
