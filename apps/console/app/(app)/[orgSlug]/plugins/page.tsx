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
  canManageOrg,
  FIRST_PARTY_PLUGINS,
  resolveEnabledPlugins,
} from '@aglyn/aglyn'
import { mdiChevronRight, mdiPuzzleOutline } from '@aglyn/shared-data-mdi'
import { AppLink, CardDisplay, Container, MdiIcon } from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Alert, Stack, Switch, Typography } from '@mui/material'
import { collection, limit, query } from 'firebase/firestore'
import { useMemo } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import { buildRoute, Route } from '../../../../constants/route-links'
import useCurrentOrg from '../../../../hooks/use-current-org'
import useFirestoreCollection from '../../../../hooks/use-firestore-collection'
import { useOrgScope, useOrgSlug } from '../../../../hooks/use-org-scope'

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
  const { currentOrg } = useOrgScope()
  const { org } = useCurrentOrg()
  const { data: user } = useUser()
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const orgId = currentOrg?.$id ?? ''
  const canManage = canManageOrg(currentOrg?.role)

  // Org-wide marketplace pins. Host-pinned installs are reachable from the
  // listing page's site set; this inventory speaks for the workspace, and
  // the detail page tells the per-site story.
  const { data: orgInstalls } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'orgs', orgId || '-pending-', 'installs'),
        limit(100),
      ),
    [firestore, orgId],
    { idField: '$id' },
  )

  const enabled = useMemo(
    () => new Set(resolveEnabledPlugins((org as any)?.enabledPlugins)),
    [org],
  )

  const saveEnabledPlugins = async (pluginIds: string[]) => {
    const idToken = await (
      user as { getIdToken?: () => Promise<string> }
    )?.getIdToken?.()
    const response = await fetch('/api/orgs/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify({
        orgId,
        action: 'set-enabled-plugins',
        enabledPlugins: pluginIds,
      }),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      return void enqueueSnackbar(payload?.error ?? 'Request failed', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
    enqueueSnackbar('Plugins updated', { variant: 'success', persist: false })
  }

  const toggle = (pluginId: string, on: boolean) => {
    const next = new Set(enabled)
    if (on) next.add(pluginId)
    else next.delete(pluginId)
    void saveEnabledPlugins([...next])
  }

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
        listingId: pluginRef,
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
    <>
      <NextPageTitle screen={'Plugins'} />
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
        help="plugins"
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <Stack spacing={3}>
            <CardDisplay
              header={'Installed from the marketplace'}
              contentGutterX
              contentGutterY
            >
              {(orgInstalls ?? []).length ? (
                <Stack>
                  {(orgInstalls ?? []).map((install: any) =>
                    row(
                      install.$id,
                      install.$id,
                      install.displayName ?? install.pluginId ?? install.$id,
                      `v${install.version} · every site in this organization`,
                    ),
                  )}
                </Stack>
              ) : (
                <Alert severity="info">
                  {'Nothing installed org-wide yet. Browse the marketplace to ' +
                    'add one — or open a listing to install it on chosen ' +
                    'sites.'}
                </Alert>
              )}
            </CardDisplay>

            <CardDisplay
              header={'Built in'}
              contentGutterX
              contentGutterY
            >
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mb: 1 }}
              >
                {'The plugins that ship with Aglyn. Turning one off removes ' +
                  'it from navigation, the editor, published sites and the ' +
                  'API for every site in this organization.'}
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
                      checked={plugin.alwaysOn || enabled.has(plugin.id)}
                      disabled={plugin.alwaysOn || !canManage}
                      // The row is a link, so the switch has to stop the
                      // click reaching it — otherwise toggling a plugin also
                      // navigates away from the list you were toggling in.
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                      }}
                      onChange={(event) =>
                        toggle(plugin.id, event.target.checked)
                      }
                    />,
                  ),
                )}
              </Stack>
            </CardDisplay>
          </Stack>
        </Container>
      </DashboardLayout>
    </>
  )
}
OrgPlugins.displayName = 'Page:OrgPlugins'

export default OrgPlugins
