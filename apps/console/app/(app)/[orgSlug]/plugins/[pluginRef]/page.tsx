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
  listConsoleExtensions,
  planLabelGrantingFeature,
  resolveUpdateState,
  updateStateLabel,
} from '@aglyn/aglyn'
import { mdiPuzzleOutline } from '@aglyn/shared-data-mdi'
import { AppLink, CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { Alert, Button, Chip, Stack, Switch, Typography } from '@mui/material'
import { doc, getDoc } from 'firebase/firestore'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFirestore, useFirestoreDoc, useUser } from '@aglyn/tenant-feature-instance'
import DashboardLayout from '../../../../../components/layouts/dashboard.layout'
import PluginConfigCards from '../../../../../components/plugin-config-card.component'
import PluginDependenciesCard from '../../../../../components/plugin-dependencies-card.component'
import PluginDisableCascadeDialog from '../../../../../components/plugin-disable-cascade-dialog.component'
import PluginWidgetSlot from '../../../../../components/plugin-widget-slot.component'
import { CONTENT_MAX_WIDTH } from '../../../../../constants/shared'
import { docsHelp } from '../../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../../constants/route-links'
import useCurrentOrg from '../../../../../hooks/use-current-org'
import { useOrgHosts } from '../../../../../hooks/use-org-hosts'
import { useOrgScope, useOrgSlug } from '../../../../../hooks/use-org-scope'
import { useOrgPluginSwitchboard } from '../../../../../hooks/use-plugin-switchboard'
import { resolveExtensionEntitlement } from '../../../../../utils/extension-entitlement'

/**
 * How loudly each update state reads (AGL-1016). `unknown` and `ahead` are
 * warnings rather than neutral text: both mean the workspace is running
 * something the marketplace cannot vouch for right now.
 */
const UPDATE_SEVERITY = {
  current: 'success',
  'update-available': 'info',
  ahead: 'warning',
  unknown: 'warning',
} as const

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
 * The segment is `[pluginRef]` (AGL-1013), which is also the key `useParams`
 * answers to — see the read below.
 */
const OrgPluginInstallation: NextPageWithLayout<Record<string, never>> = () => {
  const orgSlug = useOrgSlug()
  const { currentOrg, loading } = useOrgScope()
  const { data: user } = useUser()
  const firestore = useFirestore()
  // Keyed by the SEGMENT name (AGL-1025). AGL-1013 renamed the folder to
  // `[pluginRef]` and left this reading `listingId`, which Next then resolved
  // to undefined: every pin fell through to the `-missing-` sentinel and the
  // page told admins a plugin running org-wide was not installed anywhere.
  const params = useParams<{ pluginRef: string }>()
  const pluginRef = String(params.pluginRef ?? '')
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
  // Held at null until the org resolves — and for a first-party plugin,
  // which HAS no pin, held at null for good (AGL-1440): installs are
  // member-gated, so `orgs/-pending-/installs/-missing-` was a
  // guaranteed-denied listen while the scope loaded, and a pointless read
  // for the plugins that never have a listing.
  const { data: orgPin } = useFirestoreDoc<any>(
    () =>
      orgId && listingId
        ? doc(firestore, 'orgs', orgId, 'installs', listingId)
        : null,
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

  // The listing behind the pin, for the update line (AGL-1016). A public
  // read, and absent for first-party plugins — which have no listing and no
  // version, so there is nothing to be behind.
  const { data: listing } = useFirestoreDoc<any>(
    () => doc(firestore, 'marketplaceListings', listingId || '-missing-'),
    [firestore, listingId],
  )
  // The kill switch behind that listing (AGL-2368). A revoked version stays
  // `approved` — revocation does not clear a review verdict — so without this
  // the update line offered bytes `install-plugin` answers 409 to. Public
  // read, listing-scoped, one document.
  const { data: revocation } = useFirestoreDoc<any>(
    () => (listingId ? doc(firestore, 'revocations', listingId) : null),
    [firestore, listingId],
  )
  const updateStatus = useMemo(
    () => resolveUpdateState(pin as never, listing ?? null, 'plugin', revocation),
    [pin, listing, revocation],
  )

  const onChanged = useCallback(
    () => setPinsNonce((current) => current + 1),
    [],
  )
  const installedAnywhere = Boolean(orgPin) ||
    Object.values(sitePins).some(Boolean)

  /**
   * The workspace switch, from the SAME writer the Plugins list uses.
   *
   * The list and this page are two views of one piece of state, and the state
   * has a dependency cascade attached — so the answer to "two surfaces must
   * not each own this write" is one writer both call, which is what
   * `useOrgPluginSwitchboard` is. The cascade check sits in front of the write
   * inside it, so no surface can reach the write without it.
   */
  const switchboard = useOrgPluginSwitchboard({
    labelFor: (id) =>
      FIRST_PARTY_PLUGINS.find((plugin) => plugin.id === id)?.label ??
      (id === pluginRef ? displayName : id),
  })

  /**
   * Whether the PLAN runs what this plugin registers (AGL-2484).
   *
   * The switch itself is not plan-gated — it is role-gated, and a workspace on
   * any plan may switch a plugin off — but a plugin whose console extension
   * declares an entitlement the org does not hold renders nothing when it is
   * on, and this is the page where an admin would otherwise conclude the
   * switch is broken. `pending` says nothing at all: an unresolved org
   * resolves the FREE tier, so a claim made before `ready` tells a paying
   * workspace it does not have what it pays for.
   */
  const { org, ready: orgReady } = useCurrentOrg()
  const extensionFlag = listConsoleExtensions().find(
    (extension) => extension.pluginId === pluginId,
  )?.featureFlag
  const planState = resolveExtensionEntitlement(extensionFlag, org, orgReady)

  return (
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
            <Button variant="outlined" color="primary" component="span">
              {'View listing'}
            </Button>
          </AppLink>
        )
      }
      help={{ topic: 'plugins', anchor: '#configure' }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <Stack spacing={3}>
          {!firstParty && !installedAnywhere ? (
            <Alert severity="info">
              {'This plugin is not installed in this organization. Install ' +
                'it from its marketplace listing.'}
            </Alert>
          ) : null}

          {/* Version, said plainly (AGL-1016). Read-only for now: this
              page could show v1 while the listing page showed v2 and
              nothing reconciled them. Applying the update is AGL-1017. */}
          {!firstParty && installedAnywhere ? (
            <Alert
              severity={UPDATE_SEVERITY[updateStatus.state]}
              variant="outlined"
              action={
                updateStatus.state === 'update-available' ? (
                  <AppLink
                    href={buildRoute(Route.ORG_MARKETPLACE_LISTING, {
                      orgSlug,
                      listingId,
                    })}
                  >
                    <Button size="small" color="inherit" component="span">
                      {'View listing'}
                    </Button>
                  </AppLink>
                ) : undefined
              }
            >
              {updateStateLabel(updateStatus)}
            </Alert>
          ) : null}

          {/* Where it runs. A marketplace install is a set of pins, so it
              gets the AGL-997 control; a first-party plugin has no pins at
              all — it is on or off for the workspace — and pretending
              otherwise would invent a scope it does not have. */}
          <CardDisplay
            header={'Where it runs'}
            help={docsHelp('installYourFirstPlugin', {
              anchor: '#step-4-targeting',
              excerpt:
                'A marketplace install is a set of per-site pins. A ' +
                'first-party plugin has no pins — it is on or off for the ' +
                'whole workspace.',
            })}
            contentGutterX
            contentGutterY
          >
            {firstParty ? (
              <Stack spacing={1.5}>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <Typography variant="body2">
                    {firstParty.alwaysOn
                      ? 'Always on, for every site in this organization — it ' +
                        'is what sites are built out of, so it cannot be ' +
                        'turned off.'
                      : 'Every site in this organization, while it is ' +
                        'switched on here.'}
                  </Typography>
                  {/*
                    The switch, on the page about the thing it switches. It
                    used to live only on the list, so reading a plugin's page
                    and deciding to turn it off meant navigating back to find
                    the row again — and the reason given for that (a second
                    writer would be a second place to forget the cascade) is
                    answered by sharing the writer, not by withholding the
                    control.
                  */}
                  <Switch
                    checked={switchboard.isOn(pluginRef) || firstParty.alwaysOn}
                    disabled={
                      firstParty.alwaysOn ||
                      !switchboard.canWrite ||
                      // Unready means this position is the DEFAULT set rather
                      // than this workspace's, so it is not something to act
                      // on yet.
                      !switchboard.ready ||
                      switchboard.busy
                    }
                    onChange={() =>
                      switchboard.requestToggle(
                        pluginRef,
                        !switchboard.isOn(pluginRef),
                      )
                    }
                    slotProps={{
                      input: {
                        'aria-label': `Toggle ${firstParty.label} for this workspace`,
                      },
                    }}
                  />
                </Stack>
                {firstParty.description ? (
                  <Typography variant="body2" color="text.secondary">
                    {firstParty.description}
                  </Typography>
                ) : null}
                {switchboard.canWrite ? null : (
                  <Typography variant="body2" color="text.secondary">
                    {'Only workspace owners and admins can switch a plugin ' +
                      'on or off.'}
                  </Typography>
                )}
                {planState === 'blocked' ? (
                  <Alert severity="info" variant="outlined">
                    {`Switching ${firstParty.label} on does not put it on ` +
                      'your plan: its console pages stay behind an upgrade ' +
                      'notice until the plan includes it.' +
                      (planLabelGrantingFeature(extensionFlag as never)
                        ? ` Included from ${planLabelGrantingFeature(extensionFlag as never)}.`
                        : '')}
                  </Alert>
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

          {/* What it needs, and what needs it. Switching a plugin off is the
              one act on this page with consequences outside it, and the page
              said nothing about them — the cascade only appeared once the
              switch had already been flipped. */}
          <PluginDependenciesCard pluginId={pluginRef} orgSlug={orgSlug} />

          {/* Settings — the reason this page exists. Bookings settings
              only mean anything in the context of the Bookings
              installation; on the Installed tab they were a loose card in
              a stack of unrelated forms.

              `manifest` is what lets a MARKETPLACE plugin have settings at
              all: first-party schemas are registered at module scope, which a
              sandboxed third-party bundle cannot do, so without the pin's own
              manifest this card rendered nothing for every plugin the
              workspace installed. */}
          {pluginId ? (
            <PluginConfigCards
              orgId={orgId}
              pluginId={pluginId}
              manifest={pin?.manifest}
              displayName={displayName}
            />
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
            help={docsHelp('sandboxSecurity', {
              excerpt:
                'What this plugin declared it can reach, and what the ' +
                'sandbox enforces regardless of what it declared.',
            })}
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
        <PluginDisableCascadeDialog {...switchboard.dialogProps} />
      </Container>
    </DashboardLayout>
  )
}
OrgPluginInstallation.displayName = 'Page:OrgPluginInstallation'

export default OrgPluginInstallation
