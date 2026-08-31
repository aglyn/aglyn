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
  FIRST_PARTY_PLUGINS,
  isFirstPartyPlugin,
  PLUGIN_CASCADE_IS_DECLARED_ONLY,
  pluginDependents,
  pluginRequirements,
  resolveDisableCascade,
  resolveEnabledPlugins,
  resolveHostEnabledPlugins,
  resolvePluginSiteState,
  type PluginSiteState,
} from '@aglyn/aglyn'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { Alert, Chip, List, ListItem, ListItemText, Stack, Typography } from '@mui/material'
import { useMemo } from 'react'
import { docsHelp } from '../constants/docs-links'
import { buildRoute, Route } from '../constants/route-links'
import useCurrentOrg from '../hooks/use-current-org'

/** The site the card is answering for, when it is answering for one. */
export interface PluginDependenciesSite {
  /** Subdomain, for links to the matching per-site page. */
  host: string
  /** The host document, so state resolves from what actually runs. */
  hostDoc: { disabledPlugins?: string[]; enabledPlugins?: string[] } | null | undefined
}

export interface PluginDependenciesCardProps {
  /** The plugin this page is about — a catalog id or a listing id. */
  pluginId: string
  orgSlug: string
  /** Present at SITE scope; absent at workspace scope. */
  site?: PluginDependenciesSite
}

/** How each state reads on a row, and whether it is a problem worth naming. */
const SITE_STATE_CHIP: Record<
  PluginSiteState,
  { label: string; color: 'success' | 'default' | 'warning'; met: boolean }
> = {
  'always-on': { label: 'Always on', color: 'success', met: true },
  'runs-here': { label: 'Runs on this site', color: 'success', met: true },
  'awaiting-opt-in': {
    label: 'Not turned on for this site',
    color: 'warning',
    met: false,
  },
  'off-for-site': { label: 'Off for this site', color: 'warning', met: false },
  'off-for-workspace': {
    label: 'Off for the workspace',
    color: 'warning',
    met: false,
  },
}

/**
 * What this plugin needs, and what needs it (AGL-2486).
 *
 * Both pages showed a plugin's identity, scope and settings and said nothing
 * about the one property that decides whether switching it off is safe. The
 * couplings are DECLARED — `FirstPartyPlugin.requires`, the same edges
 * `resolveDisableCascade` walks — so this card reads the graph rather than
 * inferring one, and repeats the declared-only caveat rather than presenting
 * the list as exhaustive.
 *
 * ## Why the site version is not the workspace version with a different link
 *
 * At workspace scope the question is structural: what does this need, and what
 * needs it. At site scope the same graph carries a second fact that only this
 * page is positioned to state — whether each of those plugins is actually
 * running HERE. A requirement the workspace enables and this site has switched
 * off is a plugin that is broken on this site while its workspace page looks
 * perfectly healthy, and nothing else in the console says so.
 *
 * That is a warning rather than a grey label because the runtime does not
 * degrade gracefully around it. `resolveHostEnabledPlugins` is the single
 * enforcement point: the tenant loads only the site's enabled bundles, so a
 * missing requirement's elements stop rendering on published pages, and the
 * plugin API dispatcher answers 404 for a path belonging to a plugin this site
 * has off. The dependent stays switched on and keeps serving its own routes
 * with nothing behind them, which is exactly the state that reads as fine from
 * every surface except this one.
 *
 * ## Why the dependants half is resolved, not listed
 *
 * The dependants shown here and the cascade dialog that fires on a disable are
 * the same question asked at two moments, so they are answered by the same
 * call: `resolveDisableCascade` against the effective enabled set. Listing
 * dependants from a second walk of the graph would let the two drift, and the
 * one that drifted would be the dialog — nobody looks at it until it fires.
 */
export default function PluginDependenciesCard(
  props: PluginDependenciesCardProps,
) {
  const { pluginId, orgSlug, site } = props
  // EXEMPT from `no-unguarded-loading-hook`: `org` reaches only
  // `resolveEnabledPlugins`/`resolveHostEnabledPlugins`, which fail OPEN — an
  // absent list means every first-party plugin — so an unready org can only
  // report a requirement as MET when it is not yet known to be, never invent
  // an unmet one. Nothing here writes, and the chips re-resolve once the org
  // lands.
  // eslint-disable-next-line aglyn/no-unguarded-loading-hook
  const { org } = useCurrentOrg()

  const catalog = useMemo(
    () => new Map(FIRST_PARTY_PLUGINS.map((plugin) => [plugin.id, plugin])),
    [],
  )
  const labelFor = (id: string) => catalog.get(id)?.label ?? id

  const requires = useMemo(() => pluginRequirements(pluginId), [pluginId])
  const directDependents = useMemo(
    () => new Set(pluginDependents(pluginId)),
    [pluginId],
  )
  /**
   * Every declared dependant, transitively — the closure over the whole
   * catalog rather than over what happens to be on, so a dependant that is
   * already switched off is still named. What it would COST to switch this
   * plugin off is the next value down, and it is the dialog's own list.
   */
  const allDependents = useMemo(
    () =>
      resolveDisableCascade(
        pluginId,
        FIRST_PARTY_PLUGINS.map((plugin) => plugin.id),
      ),
    [pluginId],
  )
  const effective = useMemo(
    () =>
      site
        ? resolveHostEnabledPlugins(org, site.hostDoc)
        : resolveEnabledPlugins(org),
    [org, site],
  )
  /** Exactly what the cascade dialog will list — same resolver, same set. */
  const wouldCascade = useMemo(
    () => new Set(resolveDisableCascade(pluginId, effective)),
    [pluginId, effective],
  )

  const stateOf = (id: string): PluginSiteState =>
    site
      ? resolvePluginSiteState(org, site.hostDoc, id)
      : resolveEnabledPlugins(org).includes(id)
        ? catalog.get(id)?.alwaysOn
          ? 'always-on'
          : 'runs-here'
        : 'off-for-workspace'

  const hrefFor = (id: string) =>
    site
      ? buildRoute(Route.HOST_ADMIN_PLUGIN, {
          orgSlug,
          host: site.host,
          pluginRef: id,
        })
      : buildRoute(Route.ORG_PLUGIN_INSTALLATION, { orgSlug, pluginRef: id })

  const unmet = requires.filter((id) => !SITE_STATE_CHIP[stateOf(id)].met)

  /** A row for one related plugin, with its state at THIS scope. */
  const relatedRow = (id: string, secondary: string) => {
    const state = stateOf(id)
    const chip = SITE_STATE_CHIP[state]
    return (
      <ListItem key={id} disableGutters>
        <ListItemText
          primary={
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
            >
              <AppLink href={hrefFor(id)} color="inherit">
                {labelFor(id)}
              </AppLink>
              <Chip
                size="small"
                color={chip.color}
                variant={chip.color === 'default' ? 'outlined' : 'filled'}
                label={
                  // At workspace scope there is no site to be off for, so the
                  // per-site vocabulary would be a claim the scope cannot make.
                  site
                    ? chip.label
                    : state === 'off-for-workspace'
                      ? 'Off for the workspace'
                      : state === 'always-on'
                        ? 'Always on'
                        : 'Enabled'
                }
              />
            </Stack>
          }
          secondary={secondary}
        />
      </ListItem>
    )
  }

  return (
    <CardDisplay
      header={'Dependencies'}
      help={docsHelp('plugins', {
        anchor: site
          ? '#a-dependency-that-is-off-for-one-site'
          : '#when-one-plugin-depends-on-another',
        excerpt: site
          ? 'What this plugin needs and what needs it, and whether each of ' +
            'those is actually running on this site.'
          : 'What this plugin declares it cannot run without, and what ' +
            'declares it cannot run without this one.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        {/*
          The unmet-requirement warning, at the top because it is the only
          thing on this card that describes something already broken. It is a
          `warning` rather than a neutral line: the dependent keeps its switch
          on and keeps serving its own routes while the code behind them is not
          loaded, so nothing else the operator can see reports a fault.
        */}
        {unmet.length ? (
          <Alert severity="warning" variant="outlined">
            {site
              ? `${labelFor(pluginId)} cannot run without ` +
                `${unmet.map(labelFor).join(', ')}, and this site does not ` +
                'have it. This plugin stays switched on here and keeps ' +
                'serving whatever it serves, but the parts of it that come ' +
                'from that plugin are not loaded on this site: its elements ' +
                'stop rendering on published pages, and its API paths answer ' +
                '404.'
              : `${labelFor(pluginId)} cannot run without ` +
                `${unmet.map(labelFor).join(', ')}, and this workspace has ` +
                'it switched off. It runs on none of this workspace’s sites ' +
                'until that one is switched back on.'}
          </Alert>
        ) : null}

        <Stack spacing={1}>
          <Typography variant="subtitle2">{'Needs'}</Typography>
          {requires.length ? (
            <List dense disablePadding>
              {requires.map((id) =>
                relatedRow(
                  id,
                  `${labelFor(pluginId)} declares it cannot run without this.`,
                ),
              )}
            </List>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {'Nothing. This plugin declares no requirements, so it runs on ' +
                'its own.'}
            </Typography>
          )}
        </Stack>

        <Stack spacing={1}>
          <Typography variant="subtitle2">{'Needed by'}</Typography>
          {allDependents.length ? (
            <List dense disablePadding>
              {allDependents.map((id) =>
                relatedRow(
                  id,
                  [
                    directDependents.has(id)
                      ? `Declares it cannot run without ${labelFor(pluginId)}.`
                      : `Depends on ${labelFor(pluginId)} indirectly, through ` +
                        'another plugin.',
                    wouldCascade.has(id)
                      ? site
                        ? 'Switching this plugin off for this site switches ' +
                          'that one off here too.'
                        : 'Switching this plugin off switches that one off ' +
                          'for every site in this workspace.'
                      : 'Already off, so nothing more happens to it.',
                  ].join(' '),
                ),
              )}
            </List>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {'Nothing declares that it depends on this plugin, so switching ' +
                'it off takes nothing else with it.'}
            </Typography>
          )}
        </Stack>

        <Typography variant="caption" color="text.secondary">
          {isFirstPartyPlugin(pluginId)
            ? PLUGIN_CASCADE_IS_DECLARED_ONLY
            : 'A plugin manifest has no way to declare a dependency yet, so a ' +
              'marketplace plugin never lists any here — whether or not it ' +
              'relies on one. Check the publisher’s own documentation.'}
        </Typography>
      </Stack>
    </CardDisplay>
  )
}
PluginDependenciesCard.displayName = 'PluginDependenciesCard'
