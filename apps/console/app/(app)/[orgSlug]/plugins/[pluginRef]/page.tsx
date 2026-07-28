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

import { FIRST_PARTY_PLUGINS } from '@aglyn/aglyn'
import { mdiPuzzleOutline } from '@aglyn/shared-data-mdi'
import { AppLink, CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { Alert, Button, Chip, Stack, Typography } from '@mui/material'
import { doc, getDoc } from 'firebase/firestore'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFirestore, useFirestoreDoc, useUser } from '@aglyn/tenant-feature-instance'
import DashboardLayout from '../../../../../components/layouts/dashboard.layout'
import PluginConfigCards from '../../../../../components/plugin-config-card.component'
import PluginWidgetSlot from '../../../../../components/plugin-widget-slot.component'
import { CONTENT_MAX_WIDTH } from '../../../../../constants/shared'
import { buildRoute, Route } from '../../../../../constants/route-links'
import { useOrgHosts } from '../../../../../hooks/use-org-hosts'
import { useOrgScope, useOrgSlug } from '../../../../../hooks/use-org-scope'

/**
 * A plugin installation, as its own page (AGL-1007).
 *
 * "What this workspace has installed" used to be three cards on the
 * Marketplace › Installed tab that did not know about each other: a
 * switchboard with identity but no scope or settings, a flat stack of config
 * forms with settings but no identity, and an installs list with identity
 * but neither scope nor settings. Nothing in the UI stood for "this plugin,
 * as installed here" — which is the thing an admin actually reasons about.
 *
 * The segment accepts EITHER identifier (AGL-1010), because the console has
 * two kinds of plugin and an admin does not think of them as different
 * things: a marketplace install is keyed by listing id (what its pin is
 * keyed by), a first-party plugin by its registry id. Marketplace installs
 * take their plugin id off the pin's own manifest rather than the URL, so
 * the two identifiers cannot disagree.
 *
 * The folder is still named `[listingId]`; renaming a dynamic segment costs
 * a dev-server restart for everyone (see AGL-1001), so it is left for a
 * moment when that is not disruptive.
 */
const OrgPluginInstallation: NextPageWithLayout<Record<string, never>> = () => {
  const orgSlug = useOrgSlug()
  const { currentOrg, loading } = useOrgScope()
  const { data: user } = useUser()
  const firestore = useFirestore()
  const params = useParams<{ listingId: string }>()
  const pluginRef = String(params.listingId ?? '')
  const orgId = currentOrg?.$id ?? ''
  // First-party plugins are a registry entry, not an install pin: they have
  // no listing, no version and no per-site scope — they are on or off for
  // the whole workspace.
  const firstParty = FIRST_PARTY_PLUGINS.find(
    (plugin) => plugin.id === pluginRef,
  )
  const listingId = firstParty ? '' : pluginRef

  const { hosts } = useOrgHosts(
    firestore,
    user?.uid,
    loading ? undefined : (orgId || null),
  )
  const hostsKey = ((hosts as Array<{ $id: string; displayName?: string; subdomain?: string }>) ?? [])
    .map((host) => `${host.$id}:${host.displayName || host.subdomain || ''}`)
    .join('|')
  const hostList = useMemo(
    () =>
      ((hosts as Array<{ $id: string; displayName?: string; subdomain?: string }>) ?? []).map(
        (host) => ({
          id: host.$id,
          label: host.displayName || host.subdomain || host.$id,
        }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hostsKey],
  )

  // The org pin, plus every site's pin. Same fan-in as the listing page and
  // for the same reason: the host count is data, so one hook per host would
  // change the hook count between renders.
  const { data: orgPin } = useFirestoreDoc<any>(
    () =>
      doc(
        firestore,
        'orgs',
        orgId || '-pending-',
        'installs',
        listingId || '-missing-',
      ),
    [firestore, orgId, listingId],
  )
  const [sitePins, setSitePins] = useState<Record<string, any>>({})
  const [pinsNonce, setPinsNonce] = useState(0)
  const hostIdsKey = hostList.map((host) => host.id).join('|')
  useEffect(() => {
    if (!listingId || !hostList.length) return
    let active = true
    void Promise.all(
      hostList.map(async (host) => {
        const snapshot = await getDoc(
          doc(firestore, 'hosts', host.id, 'installs', listingId),
        )
        return [host.id, snapshot.exists() ? snapshot.data() : null] as const
      }),
    )
      .then((entries) => {
        if (active) setSitePins(Object.fromEntries(entries))
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firestore, listingId, hostIdsKey, pinsNonce])

  // Any pin will do for the identity: they carry the same denormalised
  // display name, version and manifest, and this page only needs one of
  // them to name the thing.
  const pin = useMemo(
    () => orgPin ?? Object.values(sitePins).find(Boolean) ?? null,
    [orgPin, sitePins],
  )
  const pluginId = firstParty
    ? firstParty.id
    : String(pin?.pluginId ?? pin?.manifest?.id ?? '')
  const displayName = firstParty
    ? firstParty.label
    : String(pin?.displayName ?? pluginRef)
  const capabilities: string[] = Array.isArray(pin?.manifest?.capabilities)
    ? pin.manifest.capabilities
    : []
  const networkHosts: string[] = Array.isArray(pin?.manifest?.network)
    ? pin.manifest.network
    : Array.isArray(pin?.manifest?.networkHosts)
      ? pin.manifest.networkHosts
      : []

  const onChanged = useCallback(
    () => setPinsNonce((current) => current + 1),
    [],
  )
  const installedAnywhere = Boolean(orgPin) ||
    Object.values(sitePins).some(Boolean)

  return (
    <>
      <NextPageTitle screen={displayName} />
      <DashboardLayout
        breadcrumbItems={[
          {
            children: 'Plugins',
            href: buildRoute(Route.ORG_PLUGINS, { orgSlug }),
          },
          {
            children: displayName,
            href: buildRoute(Route.ORG_PLUGIN_INSTALLATION, {
              orgSlug,
              pluginRef,
            }),
          },
        ]}
        header={{
          children: displayName,
          icon: { path: mdiPuzzleOutline.path },
        }}
        // A first-party plugin has no marketplace listing to go back to.
        headerRight={
          firstParty ? undefined : (
            <AppLink
              href={buildRoute(Route.ORG_MARKETPLACE_LISTING, {
                orgSlug,
                listingId,
              })}
            >
              <Button variant="outlined" color="secondary" component="span">
                {'View listing'}
              </Button>
            </AppLink>
          )
        }
        help="plugins"
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <Stack spacing={3}>
            {!firstParty && !installedAnywhere ? (
              <Alert severity="info">
                {'This plugin is not installed in this organization. Install ' +
                  'it from its marketplace listing.'}
              </Alert>
            ) : null}

            {/* Where it runs. A marketplace install is a set of pins, so it
                gets the AGL-997 control; a first-party plugin has no pins at
                all — it is on or off for the workspace — and pretending
                otherwise would invent a scope it does not have. */}
            <CardDisplay header={'Where it runs'} contentGutterX contentGutterY>
              {firstParty ? (
                <Stack spacing={1}>
                  <Typography variant="body2">
                    {firstParty.alwaysOn
                      ? 'Always on, for every site in this organization — it ' +
                        'is what sites are built out of, so it cannot be ' +
                        'turned off.'
                      : 'Every site in this organization. Turn it on or off ' +
                        'for the whole workspace from Plugins.'}
                  </Typography>
                  {firstParty.description ? (
                    <Typography variant="body2" color="text.secondary">
                      {firstParty.description}
                    </Typography>
                  ) : null}
                </Stack>
              ) : (
                <PluginWidgetSlot
                  slot="pluginSiteSet"
                  hostId={hostList[0]?.id ?? ''}
                  listingId={listingId}
                  orgScoped
                  orgSlug={orgSlug}
                  hosts={hostList}
                  onChanged={onChanged}
                />
              )}
            </CardDisplay>

            {/* Settings — the reason this page exists. Bookings settings
                only mean anything in the context of the Bookings
                installation; on the Installed tab they were a loose card in
                a stack of unrelated forms. */}
            {pluginId ? (
              <PluginConfigCards orgId={orgId} pluginId={pluginId} />
            ) : null}

            {/* Permissions & data, for third-party code only: a
                first-party plugin ships with the platform and declares no
                sandbox manifest, so this card would be four empty fields
                implying a boundary that is not how it runs. The listing page
                shows this BEFORE you install, which is backwards — it
                matters more once the thing is running in your workspace. */}
            {firstParty ? null : (
            <CardDisplay
              header={'Permissions & data'}
              contentGutterX
              contentGutterY
            >
              <Stack spacing={1.5}>
                <Stack spacing={0.5}>
                  <Typography variant="subtitle2">{'Capabilities'}</Typography>
                  {capabilities.length ? (
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ flexWrap: 'wrap', rowGap: 1 }}
                    >
                      {capabilities.map((capability) => (
                        <Chip key={capability} size="small" label={capability} />
                      ))}
                    </Stack>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      {'None declared — it cannot reach host data directly.'}
                    </Typography>
                  )}
                </Stack>
                <Stack spacing={0.5}>
                  <Typography variant="subtitle2">
                    {'Network allowlist'}
                  </Typography>
                  {networkHosts.length ? (
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ flexWrap: 'wrap', rowGap: 1 }}
                    >
                      {networkHosts.map((networkHost) => (
                        <Chip
                          key={networkHost}
                          size="small"
                          variant="outlined"
                          label={networkHost}
                        />
                      ))}
                    </Stack>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      {'No network origins declared; its CSP blocks outbound ' +
                        'requests.'}
                    </Typography>
                  )}
                </Stack>
              </Stack>
            </CardDisplay>
            )}
          </Stack>
        </Container>
      </DashboardLayout>
    </>
  )
}
OrgPluginInstallation.displayName = 'Page:OrgPluginInstallation'

export default OrgPluginInstallation
