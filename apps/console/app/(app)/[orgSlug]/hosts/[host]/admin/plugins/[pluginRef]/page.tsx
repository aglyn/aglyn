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
  ACCOUNTS_PLUGIN_ID,
  FIRST_PARTY_PLUGINS,
  isDefaultOffPerSite,
  isHostPluginEnabled,
  resolveEnabledPlugins,
} from '@aglyn/aglyn'
import { mdiPuzzleOutline } from '@aglyn/shared-data-mdi'
import { AppLink, CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { Alert, Button, Chip, Stack, Typography } from '@mui/material'
import { doc } from 'firebase/firestore'
import { useParams } from 'next/navigation'
import { useFirestore, useFirestoreDoc } from '@aglyn/tenant-feature-instance'
import AuthScreensCard from '../../../../../../../../components/auth-screens-card.component'
import DashboardLayout from '../../../../../../../../components/layouts/dashboard.layout'
import HostDisplayNameComponent from '../../../../../../../../components/host-display-name.component'
import PluginConfigCards from '../../../../../../../../components/plugin-config-card.component'
import { CONTENT_MAX_WIDTH } from '../../../../../../../../constants/shared'
import { docsHelp } from '../../../../../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../../../../../constants/route-links'
import useCurrentOrg from '../../../../../../../../hooks/use-current-org'
import { useOrgScope, useOrgSlug } from '../../../../../../../../hooks/use-org-scope'
import {
  useHostId,
  useHostSubdomain,
  useIsHostAdmin,
} from '../../../../../../../../components/host-id-provider'

/**
 * One plugin, as it runs on ONE site (AGL-428, AGL-1014).
 *
 * The site's Admin › Plugins tab is a switchboard: rows and switches, no way
 * in. Everything a plugin is configured WITH lived one scope up, on
 * `/[orgSlug]/plugins/[pluginRef]`, and applied to every site at once — so a
 * chain could set one booking horizon and had nowhere to say that the
 * flagship branch takes bookings further out.
 *
 * This is the site-scoped twin of that page, deliberately built from the same
 * cards in the same order — identity, where it runs, settings — because a
 * customer moving between the two scopes is looking at the same subject and
 * should not have to learn a second vocabulary for it. What differs is the
 * one thing that genuinely differs: every setting here says whether this site
 * is following the workspace or answering for itself.
 */
const SitePluginInstallation: NextPageWithLayout<Record<string, never>> = () => {
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const hostId = useHostId()
  const isAdmin = useIsHostAdmin()
  const firestore = useFirestore()
  const { currentOrg } = useOrgScope()
  // EXEMPT from `no-unguarded-loading-hook`: `org` reaches only
  // `resolveEnabledPlugins`, which fails OPEN — an absent list means every
  // first-party plugin — so an unready org can only over-state where a plugin
  // runs, never under-state it, and the card below re-reads the live answer
  // once the org lands. Nothing on this page WRITES from `org`.
  // eslint-disable-next-line aglyn/no-unguarded-loading-hook
  const { org } = useCurrentOrg()
  // Keyed by the SEGMENT name (AGL-1025): reading a key Next does not answer
  // to resolves to undefined, and every lookup below then falls through to
  // "not installed" on a plugin that is running.
  const params = useParams<{ pluginRef: string }>()
  const pluginRef = String(params.pluginRef ?? '')
  const orgId = currentOrg?.$id ?? ''

  // A first-party plugin is a registry entry, not an install pin: no listing,
  // no version, nothing to read from Firestore to name it.
  const firstParty = FIRST_PARTY_PLUGINS.find(
    (plugin) => plugin.id === pluginRef,
  )
  const listingId = firstParty ? '' : pluginRef

  // Held at null while the scope is unknown and for first-party plugins,
  // which HAVE no pin (AGL-1440): `installs` is member-gated, so a sentinel
  // id is a guaranteed-denied listen on every mount and a pointless read for
  // the plugins that never have a listing.
  const { data: sitePin } = useFirestoreDoc<any>(
    () =>
      hostId && listingId
        ? doc(firestore, 'hosts', hostId, 'installs', listingId)
        : null,
    [firestore, hostId, listingId],
  )
  const { data: orgPin } = useFirestoreDoc<any>(
    () =>
      orgId && listingId
        ? doc(firestore, 'orgs', orgId, 'installs', listingId)
        : null,
    [firestore, orgId, listingId],
  )
  // The site's own plugin policy, which is what decides whether it runs here.
  const { data: hostDoc } = useFirestoreDoc<any>(
    () => (hostId ? doc(firestore, 'hosts', hostId) : null),
    [firestore, hostId],
  )

  // Either pin will name the thing: they carry the same denormalized display
  // name, version and manifest, and the site's is preferred because it is the
  // one governing this page.
  const pin = sitePin ?? orgPin ?? null
  const pluginId = firstParty
    ? firstParty.id
    : String(pin?.pluginId ?? pin?.manifest?.id ?? '')
  const displayName = firstParty
    ? firstParty.label
    : String(pin?.displayName ?? pluginRef)

  const orgEnabled = resolveEnabledPlugins(org).includes(pluginRef)
  const runsHere = isHostPluginEnabled(org, hostDoc, pluginRef)
  const alwaysOn = Boolean(firstParty?.alwaysOn)
  const defaultOff = isDefaultOffPerSite(pluginRef)

  const whereItRuns = () => {
    if (alwaysOn) {
      return (
        'Always on. It is what sites are built out of, so it cannot be ' +
        'turned off for one site any more than for the workspace.'
      )
    }
    if (!orgEnabled) {
      return (
        'The workspace has this plugin switched off, so it runs on none of ' +
        'its sites. A site can never turn on what the workspace has turned ' +
        'off.'
      )
    }
    if (runsHere) {
      return defaultOff
        ? 'This site has opted in, so the plugin runs here. Other sites in ' +
            'the workspace stay off until they opt in too.'
        : 'The workspace enables this plugin and this site has not turned ' +
            'it off, so it runs here.'
    }
    return defaultOff
      ? 'The workspace enables this plugin, but it stays off for a site ' +
          'until that site opts in — and this one has not.'
      : 'The workspace enables this plugin, but this site has turned it ' +
          'off: it is gone from this site’s navigation, editor, published ' +
          'pages and API.'
  }

  return (
    <DashboardLayout
      breadcrumbItems={[
        {
          children: <HostDisplayNameComponent hostId={hostId} />,
          href: buildRoute(Route.HOST_DASHBOARD, { orgSlug, host }),
        },
        // Admin, then Plugins. This page sits outside the admin `(sections)`
        // group so it can own its header, and it inherited none of that
        // group's trail with it — so the crumb jumped from the site straight
        // to Plugins, skipping the level a reader would click to get back to
        // the other admin sections.
        {
          children: 'Admin',
          href: buildRoute(Route.HOST_ADMIN, { orgSlug, host }),
        },
        {
          children: 'Plugins',
          href: buildRoute(Route.HOST_ADMIN_PLUGINS, { orgSlug, host }),
        },
        {
          children: displayName,
          href: buildRoute(Route.HOST_ADMIN_PLUGIN, {
            orgSlug,
            host,
            pluginRef,
          }),
        },
      ]}
      header={{
        children: displayName,
        icon: { path: mdiPuzzleOutline.path },
      }}
      /*
       * The way to the value every inherited field on this page follows. A
       * site admin who decides the workspace answer is the one that should
       * change needs a route to it, and hunting for the plugin again from the
       * workspace nav is not one.
       */
      headerRight={
        <AppLink
          href={buildRoute(Route.ORG_PLUGIN_INSTALLATION, {
            orgSlug,
            pluginRef,
          })}
        >
          <Button variant="outlined" color="primary" component="span">
            {'Workspace settings'}
          </Button>
        </AppLink>
      }
      /*
       * `#configure-site`, not `#configure`. The workspace page stands in
       * front of "a plugin takes settings"; this one stands in front of
       * "this site can answer differently" — the question an admin opening
       * THIS page has. Two surfaces sharing a destination make their help
       * icons interchangeable, which is the failure `docs-help-destinations`
       * exists to catch.
       */
      help={{ topic: 'plugins', anchor: '#configure-site' }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <Stack spacing={3}>
          {/*
            A NOTICE, not the boundary — the Firestore rules refuse a
            non-admin write regardless of what renders here. It mirrors the
            admin sections layout so a non-admin who follows a link is told
            why, rather than shown a form that fails on save.
          */}
          {isAdmin ? null : (
            <Alert severity="info">
              {'Only site admins can change a plugin’s settings for this ' +
                'site. You can read what is set here.'}
            </Alert>
          )}

          {/* Where it runs, at SITE scope. The org page answers "which of my
              sites"; the only question here is this one, and it has three
              inputs — the workspace switch, this site's deny-list, and the
              opt-in list a default-off plugin needs. */}
          <CardDisplay
            header={'Where it runs'}
            help={docsHelp('plugins', {
              anchor: '#how-plugins-run',
              excerpt:
                'A site narrows what the workspace enables. It can switch a ' +
                'plugin off for itself, and can never switch on one the ' +
                'workspace has switched off.',
            })}
            contentGutterX
            contentGutterY
          >
            <Stack spacing={1.5}>
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
              >
                <Chip
                  size="small"
                  color={runsHere ? 'success' : 'default'}
                  variant={runsHere ? 'filled' : 'outlined'}
                  label={runsHere ? 'Runs on this site' : 'Off for this site'}
                />
                <Chip
                  size="small"
                  variant="outlined"
                  label={
                    orgEnabled
                      ? 'Enabled for the workspace'
                      : 'Off for the workspace'
                  }
                />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {whereItRuns()}
              </Typography>
              {firstParty?.description ? (
                <Typography variant="body2" color="text.secondary">
                  {firstParty.description}
                </Typography>
              ) : null}
              {/*
                The SWITCH stays on the list, deliberately. Per-site
                enablement is a boundary rather than a preference —
                `resolveHostEnabledPlugins` is the single enforcement point
                for navigation, the editor, published pages and API dispatch —
                and turning one off cascades to the plugins that depend on it.
                A second writer of that state would be a second place for the
                cascade to be forgotten.
              */}
              {alwaysOn ? null : (
                <Stack direction="row">
                  <AppLink
                    href={buildRoute(Route.HOST_ADMIN_PLUGINS, {
                      orgSlug,
                      host,
                    })}
                  >
                    <Button size="small" component="span">
                      {'Change on Site plugins'}
                    </Button>
                  </AppLink>
                </Stack>
              )}
            </Stack>
          </CardDisplay>

          {/* Settings — the reason this page exists. The same form the
              workspace page renders, in its site-scoped mode: every field
              says whether this site follows the workspace or answers for
              itself, and offers the one action back to following it. */}
          {pluginId && orgId && hostId ? (
            <PluginConfigCards
              orgId={orgId}
              hostId={hostId}
              pluginId={pluginId}
              disabled={!isAdmin}
            />
          ) : null}

          {/*
            EXTENSION POINT — per-site cards a plugin owns that are not
            schema fields.

            A `PluginConfigField` is a scalar with a label; some per-site
            settings are not that shape and need a card of their own. They
            belong HERE, below the settings form, keyed on `pluginId` so a
            card renders only on the page for the plugin it configures.

            "Sign-in & sign-up pages" is the first of them (AGL-428,
            AGL-1014). It designates a besigner-built screen for each of
            /signin, /signup
            and /recover — a picker over this site's screens rather than a
            value — and those three addresses exist only while User Accounts
            is on for the site, which is the question the card above answers.
            It sat on the site SETUP page, where it was one membership control
            among a site's name, logo, contact details and languages, and
            where a site with User Accounts off still offered to configure
            three routes that 404.
          */}
          {pluginId === ACCOUNTS_PLUGIN_ID && hostId ? (
            <AuthScreensCard hostId={hostId} />
          ) : null}
        </Stack>
      </Container>
    </DashboardLayout>
  )
}
SitePluginInstallation.displayName = 'Page:SitePluginInstallation'

export default SitePluginInstallation
