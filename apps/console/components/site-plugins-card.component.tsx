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
  classifyEnabledPlugins,
  FIRST_PARTY_PLUGINS,
  resolveEnabledPlugins,
} from '@aglyn/aglyn'
import PluginDisableCascadeDialog from './plugin-disable-cascade-dialog.component'
import { mdiChevronRight } from '@aglyn/shared-data-mdi'
import { AppLink, CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Button,
  Chip,
  List,
  ListItem,
  ListItemText,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import { useHeldSave } from '@aglyn/tenant-feature-instance/hooks/use-seed-edits'
import { useMemo } from 'react'
import { docsHelp } from '../constants/docs-links'
import { buildRoute, Route } from '../constants/route-links'
import useCurrentOrg from '../hooks/use-current-org'
import { useOrgSlug } from '../hooks/use-org-scope'
import {
  SITE_PLUGINS_CHECKING_TEXT,
  useSitePluginSwitchboard,
} from '../hooks/use-plugin-switchboard'
import { useSiteMarketplacePlugins } from '@aglyn/tenant-feature-instance/hooks/use-site-marketplace-plugins'
import { useHostSubdomain } from './host-id-provider'

/**
 * Per-site plugin switchboard (AGL-1014), the host-level counterpart of
 * OrgPluginsCard: the org decides what the workspace may use; this card
 * narrows it for ONE site by writing the host doc's `disabledPlugins`
 * deny-list and its `enabledPlugins` opt-in list. A site can never widen
 * beyond the org — org-disabled plugins are simply not listed — and only the
 * base component library renders locked. A plugin locked on for the WORKSPACE
 * (AI) is switchable here: this card is the one switch it has (AGL-3028).
 * `resolveHostEnabledPlugins` is the single enforcement point (console nav,
 * editor pages, published sites, API dispatch), so a toggle here is a
 * boundary, not a preference — which is why the write, its seed guard and its
 * dependency cascade all live in `useSitePluginSwitchboard`, shared with the
 * site's plugin detail page rather than reimplemented on each.
 *
 * The list is in two GROUPS, the same split the workspace's Plugins page
 * makes across two cards: what ships with the platform, and what this
 * workspace installed from the marketplace. Merging them would leave a site
 * admin unable to tell reviewed platform code from a third party's, which is
 * the first thing they need to know about a row before switching it.
 */
export default function SitePluginsCard(props: { hostId: string }) {
  const { hostId } = props
  // EXEMPT from `no-unguarded-loading-hook` (AGL-1422). `org` reaches only
  // `resolveEnabledPlugins`, which fails OPEN — an absent list means every
  // first-party plugin — so an unready org lists MORE rows than the loaded
  // one, never fewer, and no row here is a claim about a plan. The dangerous
  // half of this card is the write, and it is not seeded from `org` at all:
  // the switchboard hook seeds from the HOST doc, whose own staleness is
  // guarded by `writeGuardedBySeed` (AGL-1356/1358). Gating the list on
  // `ready` would only add a flash to a card that cannot lie.
  // eslint-disable-next-line aglyn/no-unguarded-loading-hook
  const { org, orgId } = useCurrentOrg()
  const orgSlug = useOrgSlug()
  const hostSlug = useHostSubdomain()

  // Only ORG-ENABLED plugins are listed: what the org has switched off does
  // not exist for any of its sites, so there is nothing to toggle here.
  const orgEnabled = useMemo(() => resolveEnabledPlugins(org), [org])
  const { bundles, listings } = useMemo(
    () => classifyEnabledPlugins(orgEnabled),
    [orgEnabled],
  )
  const catalog = useMemo(
    () => new Map(FIRST_PARTY_PLUGINS.map((plugin) => [plugin.id, plugin])),
    [],
  )
  const marketplace = useSiteMarketplacePlugins(orgId ?? '', hostId, listings)

  /**
   * A plugin id as an operator reads it. The catalog answers for a bundle;
   * a marketplace install answers with the `displayName` denormalized onto
   * its pin. Without this the cascade dialog would name a Firestore document
   * id in a sentence about what stops working.
   */
  const labelFor = useMemo(() => {
    const names = new Map(
      marketplace.map((install) => [install.listingId, install.displayName]),
    )
    return (id: string) => catalog.get(id)?.label ?? names.get(id) ?? id
  }, [catalog, marketplace])

  const installedListings = useMemo(
    () => marketplace.map((install) => install.listingId),
    [marketplace],
  )
  const switchboard = useSitePluginSwitchboard(hostId, {
    labelFor,
    installedListings,
  })
  const { busy, checking, dirty, isOn, isLocked, requestToggle, save } =
    switchboard

  const builtIn = bundles.map((id) => {
    const plugin = catalog.get(id)
    return {
      id,
      label: plugin?.label ?? id,
      description: plugin?.description,
      trailing: undefined as string | undefined,
    }
  })
  const installed = marketplace.map((install) => ({
    id: install.listingId,
    label: install.displayName,
    description:
      install.scope === 'org'
        ? 'Installed by your workspace on every site.'
        : 'Installed on this site.',
    trailing: install.version ? `v${install.version}` : undefined,
  }))

  const rowFor = (row: {
    id: string
    label: string
    description?: string
    trailing?: string
  }) => {
    const locked = isLocked(row.id)
    return (
      <ListItem
        key={row.id}
        disableGutters
        secondaryAction={
          <Switch
            edge="end"
            checked={isOn(row.id)}
            disabled={locked || busy}
            onChange={() => requestToggle(row.id, !isOn(row.id))}
            slotProps={{
              input: { 'aria-label': `Toggle ${row.label} on this site` },
            }}
          />
        }
      >
        {/*
          The row opens the plugin's page for THIS site (AGL-428, AGL-1014),
          the way a workspace plugin row opens its own. The link wraps only the
          text: the switch is the list item's `secondaryAction` and sits
          outside it, so flipping one never navigates.
        */}
        <AppLink
          href={buildRoute(Route.HOST_ADMIN_PLUGIN, {
            orgSlug,
            host: hostSlug,
            pluginRef: row.id,
          })}
          color="inherit"
          underline="none"
          sx={{ flex: 1, minWidth: 0, display: 'block' }}
        >
          <Stack
            direction="row"
            spacing={1}
            sx={{
              alignItems: 'center',
              px: 1,
              mx: -1,
              borderRadius: 1,
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            <ListItemText
              primary={row.label}
              secondary={
                locked
                  ? `${row.description ?? ''} Always on.`.trim()
                  : row.description
              }
            />
            {row.trailing ? (
              <Typography variant="caption" color="text.secondary">
                {row.trailing}
              </Typography>
            ) : null}
            <MdiIcon
              path={mdiChevronRight.path}
              color="disabled"
              sx={{ fontSize: 20 }}
            />
          </Stack>
        </AppLink>
      </ListItem>
    )
  }

  /*
   * Save pressed while the site's plugin list is held is kept, and saves once
   * the list is confirmed, with the flips replayed onto it (AGL-4047). If no
   * confirmation comes, the refusal shows beside the button.
   */
  const held = useHeldSave(save, {
    checking,
    subject: 'site plugin list',
  })

  return (
    <CardDisplay
      header="Site plugins"
      help={docsHelp('installYourFirstPlugin', { anchor: '#site-plugins' })}
      contentGutterX
      contentGutterY
    >
      {/*
        NO WIDTH CAP ON THE LIST. This card is a list of rows with a
        right-aligned control, not a column of form fields, and the ~560px
        form measure the console uses for the latter was capping the former:
        every row's text, chevron and switch bunched into the left half of an
        1100px card, with the hover highlight stopping mid-card as though the
        row had failed to render. `Container maxWidth={CONTENT_MAX_WIDTH}` on
        the page already bounds the measure; a second cap inside the card
        bounds the ROW, which is not the same thing. The workspace plugin list
        this mirrors has never had one.
      */}
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">
          {'Choose which of the workspace-enabled plugins run on this ' +
            'site. Disabling one removes it from this site only — ' +
            'navigation, the editor, published pages, and the API. Other ' +
            'sites in the workspace are unaffected, and a site can never ' +
            'enable a plugin the workspace has switched off.'}
        </Typography>

        <Typography variant="overline" color="text.secondary">
          {'Built in'}
        </Typography>
        <List dense disablePadding>
          {builtIn.map((row) => rowFor(row))}
        </List>

        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', mt: 1 }}
        >
          <Typography variant="overline" color="text.secondary">
            {'Installed from the marketplace'}
          </Typography>
          <Chip size="small" variant="outlined" label={`${installed.length}`} />
        </Stack>
        {installed.length ? (
          <List dense disablePadding>
            {installed.map((row) => rowFor(row))}
          </List>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {'Nothing installed from the marketplace runs on this site. A ' +
              'marketplace plugin your workspace installs appears here with ' +
              'its own switch.'}
          </Typography>
        )}

        {/*
          SAVE WAITS FOR THE SERVER, NOT FOR A SECOND PRESS (AGL-4047).

          A press while the host read still came from the cache waited for the
          server's confirmation and, when that ran past its deadline, was
          refused with "We could not confirm your site plugin list…". Right
          after a page load the first press failed and the second one worked.
          Save is held instead, with the reason beside it, and comes on the
          moment the server answers. The switches stay live: moves made
          meanwhile are applied to the list the server confirms, so holding
          Save never makes them stale. The guard still wraps the write, for a
          read that falls back to the cache after this rendered.
        */}
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Button
            variant="contained"
            disabled={!dirty || busy || held.saving}
            onClick={held.press}
          >
            {held.saving ? 'Saving…' : 'Save site plugins'}
          </Button>
          {dirty && held.refusal ? (
            <Typography variant="body2" color="warning.main" role="alert">
              {held.refusal}
            </Typography>
          ) : dirty && checking ? (
            <Typography variant="body2" color="text.secondary" role="status">
              {SITE_PLUGINS_CHECKING_TEXT}
            </Typography>
          ) : null}
        </Stack>
      </Stack>
      <PluginDisableCascadeDialog {...switchboard.dialogProps} />
    </CardDisplay>
  )
}
SitePluginsCard.displayName = 'SitePluginsCard'
