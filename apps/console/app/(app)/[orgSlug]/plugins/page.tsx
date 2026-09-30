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

import { FIRST_PARTY_PLUGINS, isLockedOnForWorkspace } from '@aglyn/aglyn'
import { mdiChevronRight, mdiPuzzleOutline } from '@aglyn/shared-data-mdi'
import { AppLink, CardDisplay, Container, MdiIcon } from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { Button, Stack, Switch, Typography } from '@mui/material'
import { useMemo } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { useOrgHosts } from '../../../../hooks/use-org-hosts'
import useBranding from '../../../../hooks/use-branding'
import PluginDisableCascadeDialog from '../../../../components/plugin-disable-cascade-dialog.component'
import PluginWidgetSlot from '../../../../components/plugin-widget-slot.component'
import { useOrgScope, useOrgSlug } from '../../../../hooks/use-org-scope'
import { useOrgPluginSwitchboard } from '../../../../hooks/use-plugin-switchboard'

/**
 * Plugins, as its own console section (AGL-1011).
 *
 * Plugins used to live inside Marketplace, which conflated two different
 * things: shopping for code, and administering the code you already run.
 * It also left the installation detail page (AGL-1007) with no nav tab of
 * its own, so the whole top nav went unhighlighted on it, and no entry point
 * that read like one — the only way in was clicking a listing's name text.
 *
 * This page is the inventory: every plugin this workspace runs, first-party
 * and marketplace together, because where a plugin came from is a fact about
 * it rather than a different kind of thing. Marketplace keeps a quick
 * Installed list for uninstalling, and links here for anything more.
 */
const OrgPlugins: NextPageWithLayout<Record<string, never>> = () => {
  const orgSlug = useOrgSlug()
  // Org-scoped copy names the org's RESOLVED product name (AGL-2319).
  const { branding } = useBranding()
  const { currentOrg } = useOrgScope()
  const { data: user } = useUser()
  const firestore = useFirestore()
  const orgId = currentOrg?.$id ?? ''

  /**
   * The switchboard, shared with the plugin DETAIL page (AGL-2486).
   *
   * This page and that one are two views of one piece of state, and the state
   * has a dependency cascade attached — so the write, the loading guard and
   * the cascade check live in one hook both call, rather than being spelled
   * out here and re-derived there.
   */
  const switchboard = useOrgPluginSwitchboard()

  // `undefined`, never `null`, while the workspace resolves (AGL-2350):
  // `null` means "an account with no org — list every site they hold", and
  // on an org-scoped route that is never the right answer. It listed another
  // client's sites for the width of the cold-load window.
  const { hosts } = useOrgHosts(firestore, user?.uid, orgId || undefined)
  const hostList = useMemo(
    () =>
      ((hosts as Array<{ $id: string; displayName?: string; subdomain?: string }>) ??
        []).map((host) => ({
        id: host.$id,
        label: host.displayName || host.subdomain || host.$id,
      })),
    [hosts],
  )

  /**
   * One row per plugin. The chevron and the whole-row link are the point of
   * AGL-1011: the previous entry point was a name rendered as body text, so
   * nothing said it went anywhere.
   */
  const row = (
    key: string,
    pluginRef: string,
    label: string,
    caption: string,
    trailing?: React.ReactNode,
  ) => (
    <AppLink
      key={key}
      href={buildRoute(Route.ORG_PLUGIN_INSTALLATION, {
        orgSlug,
        pluginRef,
      })}
      color="inherit"
      underline="none"
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: 'center',
          py: 1.25,
          px: 1,
          mx: -1,
          borderRadius: 1,
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <Stack sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" noWrap>
            {label}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {caption}
          </Typography>
        </Stack>
        {trailing}
        <MdiIcon
          path={mdiChevronRight.path}
          color="disabled"
          sx={{ fontSize: 20 }}
        />
      </Stack>
    </AppLink>
  )

  return (
    <DashboardLayout
      breadcrumbItems={[
        {
          children: 'Plugins',
          href: buildRoute(Route.ORG_PLUGINS, { orgSlug }),
        },
      ]}
      header={{
        children: 'Plugins',
        icon: { path: mdiPuzzleOutline.path },
      }}
      // A way onward (AGL-1024). Now that Plugins is its own section,
      // landing here with nothing installed used to offer no route to
      // getting any — the marketplace was a tab away with nothing saying so.
      headerRight={
        <AppLink href={buildRoute(Route.ORG_MARKETPLACE, { orgSlug })}>
          <Button variant="outlined" color="primary" component="span">
            {'Install a plugin'}
          </Button>
        </AppLink>
      }
      help="plugins"
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <Stack spacing={3}>
          {/* What a plugin INSTALLED into this workspace (AGL-3080): the
              pins, their versions and whether a newer one may be installed
              are the installing plugin's, read from its own collections, so
              it draws them. The built-in half below is the shell's. */}
          {orgId ? (
            <PluginWidgetSlot
              slot="orgPluginInstalls"
              orgId={orgId}
              orgSlug={orgSlug}
              hosts={hostList}
            />
          ) : null}

          <CardDisplay
            header={'Built in'}
            help={docsHelp('plugins', {
              excerpt:
                `${branding.productName}’s own plugins. Switching one off removes it from every site in this organization — its navigation, the editor, published pages and the API.`,
            })}
            contentGutterX
            contentGutterY
          >
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mb: 1 }}
            >
              {`The plugins that ship with ${branding.productName}. Turning ` +
                'one off removes it from navigation, the editor, published ' +
                'sites and the API for every site in this organization.'}
            </Typography>
            <Stack>
              {FIRST_PARTY_PLUGINS.map((plugin) =>
                row(
                  plugin.id,
                  plugin.id,
                  plugin.label,
                  plugin.description ?? '',
                  <Switch
                    size="small"
                    // The row is a link and the label is rendered as its own
                    // text, so without this the control has no accessible
                    // name of its own — nothing a screen reader (or a test)
                    // can use to say WHICH plugin a switch belongs to.
                    slotProps={{
                      input: { 'aria-label': `Toggle ${plugin.label}` },
                    }}
                    checked={
                      isLockedOnForWorkspace(plugin.id) ||
                      switchboard.isOn(plugin.id)
                    }
                    // Unready means these switch positions are the defaults,
                    // not this workspace's (AGL-1422) — so they are not
                    // something to act on yet. A plugin locked on for the
                    // workspace is switched per site instead (AGL-3028).
                    disabled={
                      isLockedOnForWorkspace(plugin.id) ||
                      !switchboard.canWrite ||
                      !switchboard.ready
                    }
                    /*
                     * The toggle is driven from the CLICK, not from `onChange`
                     * — and that is a fix, not a style choice (AGL-2486).
                     *
                     * The row is a link, so the switch must stop the click
                     * reaching it or toggling a plugin also navigates away.
                     * But `preventDefault()` on a checkbox cancels its
                     * activation behaviour, which reverts `checked` and means
                     * no change event is ever produced — so `onChange` never
                     * ran and EVERY switch on this page has been inert since
                     * AGL-1011 (160df6a5f). Verified with a real mouse click
                     * in the browser: no navigation, no save, no state move.
                     *
                     * `onClick` does fire — it is what cancels the navigation
                     * — so the intent is read there, against the controlled
                     * value rather than the input's own (which preventDefault
                     * is about to revert anyway).
                     */
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      switchboard.requestToggle(
                        plugin.id,
                        !switchboard.isOn(plugin.id),
                      )
                    }}
                  />,
                ),
              )}
            </Stack>
          </CardDisplay>
        </Stack>
        <PluginDisableCascadeDialog {...switchboard.dialogProps} />
      </Container>
    </DashboardLayout>
  )
}
OrgPlugins.displayName = 'Page:OrgPlugins'

export default OrgPlugins
