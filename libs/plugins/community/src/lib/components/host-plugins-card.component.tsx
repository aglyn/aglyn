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
  PLUGIN_COMPONENT_ID,
  resolveEnabledPlugins,
} from '@aglyn/aglyn'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Chip,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  collection,
  deleteDoc,
  doc,
  documentId,
  limit,
  query,
  where,
} from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
  useFirestoreDoc,
  useHostOrgId,
  useUser,
} from '@aglyn/tenant-feature-instance'

export interface HostPluginsCardProps {
  hostId: string
}

/**
 * Installed community plugins (AGL-45): lists the host's pinned plugin
 * installs with their capabilities, flags available upgrades (latest
 * listing version ≠ pinned) and platform kill switches (public
 * `revocations` read), and offers explicit upgrade/uninstall. Upgrades go
 * through `/api/community/install-plugin` so the new pin is validated
 * server-side; uninstall removes the host install doc. Place the installed
 * plugin on a screen with the Plugin element (listing id).
 */
export function HostPluginsCard(props: HostPluginsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [busy, setBusy] = useState<string | null>(null)

  const orgId = useHostOrgId(hostId)
  // First-party plugins active for this org (AGL-779): derived from the
  // registry + the org's switchboard, not a hardcoded list of four. `mui`
  // (always-on) reads as locked "Core"; the rest show as enabled. Absent
  // `enabledPlugins` ⇒ default-open, so everything first-party shows.
  const { data: org } = useFirestoreDoc<any>(
    () => doc(firestore, 'orgs', orgId ?? '-pending-'),
    [firestore, orgId],
    { idField: '$id' },
  )
  const firstPartyPlugins = useMemo(() => {
    const enabled = new Set(resolveEnabledPlugins(org))
    return FIRST_PARTY_PLUGINS.filter((plugin) => enabled.has(plugin.id))
  }, [org])
  const { data: installDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'installs'), limit(50)),
    [firestore, hostId],
    { idField: '$id' },
  )
  // Org-tier pins (AGL-237): apply to every host in the org; a host pin
  // of the same listing shadows the org one.
  const { data: orgInstallDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'orgs', orgId ?? '-pending-', 'installs'),
        limit(50),
      ),
    [firestore, orgId],
    { idField: '$id' },
  )
  const orgInstalls = useMemo(
    () => [...((orgInstallDocs as any[]) ?? [])],
    [orgInstallDocs],
  )
  const installs = useMemo(
    () => [...((installDocs as any[]) ?? [])],
    [installDocs],
  )
  const listingIds = useMemo(
    () =>
      [
        ...new Set([
          ...installs.map((install) => install.$id),
          ...orgInstalls.map((install) => install.$id),
        ]),
      ].slice(0, 10),
    [installs, orgInstalls],
  )

  // Latest published version per listing (upgrade detection) — public read.
  const { data: listingDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'communityListings'),
        where(documentId(), 'in', listingIds.length ? listingIds : ['-none-']),
      ),
    [firestore, listingIds.join(',')],
    { idField: '$id' },
  )
  const latestByListing = useMemo(() => {
    const map: Record<string, string> = {}
    for (const listing of (listingDocs as any[]) ?? []) {
      map[listing.$id] = String(listing.latestVersion ?? '')
    }
    return map
  }, [listingDocs])

  // Kill switches (public revocations read) for the installed listings.
  const { data: revocationDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'revocations'),
        where(documentId(), 'in', listingIds.length ? listingIds : ['-none-']),
      ),
    [firestore, listingIds.join(',')],
    { idField: '$id' },
  )
  const revokedByListing = useMemo(() => {
    const map: Record<string, boolean> = {}
    for (const install of installs) {
      const revocation = ((revocationDocs as any[]) ?? []).find(
        (doc) => doc.$id === install.$id,
      )
      if (!revocation) continue
      map[install.$id] =
        revocation.versions === 'all' ||
        (Array.isArray(revocation.versions) &&
          revocation.versions.includes(install.version))
    }
    return map
  }, [installs, revocationDocs])

  const handleUpgrade = useCallback(
    (install: any) => async () => {
      setBusy(install.$id)
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch('/api/community/install-plugin', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ hostId, listingId: install.$id }),
        })
        const payload = await response.json().catch(() => ({}))
        if (response.ok) {
          enqueueSnackbar(`Upgraded to ${payload.version}`, {
            variant: 'success',
            persist: false,
          })
        } else {
          enqueueSnackbar(payload?.error ?? 'Upgrade failed', {
            variant: 'error',
            allowDuplicate: true,
          })
        }
      } finally {
        setBusy(null)
      }
    },
    [hostId, user, enqueueSnackbar],
  )

  const requestPluginApi = useCallback(
    async (body: Record<string, unknown>) => {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/community/install-plugin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ hostId, ...body }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        enqueueSnackbar(payload?.error ?? 'Plugin operation failed', {
          variant: 'error',
          allowDuplicate: true,
        })
        return null
      }
      return payload
    },
    [hostId, user, enqueueSnackbar],
  )

  // Promote a host pin to the org tier (AGL-237): org pin first, then the
  // host pin is removed — host pins shadow org ones in the loader.
  const handleShareWithOrg = useCallback(
    (install: any) => async () => {
      setBusy(install.$id)
      try {
        const payload = await requestPluginApi({
          listingId: install.$id,
          scope: 'org',
        })
        if (!payload) return
        await deleteDoc(doc(firestore, 'hosts', hostId, 'installs', install.$id))
        enqueueSnackbar('Plugin now installed for the whole organization', {
          variant: 'success',
          persist: false,
        })
      } finally {
        setBusy(null)
      }
    },
    [requestPluginApi, firestore, hostId, enqueueSnackbar],
  )

  const handleOrgUpgrade = useCallback(
    (install: any) => async () => {
      setBusy(install.$id)
      try {
        const payload = await requestPluginApi({
          listingId: install.$id,
          scope: 'org',
        })
        if (payload) {
          enqueueSnackbar(`Upgraded to ${payload.version}`, {
            variant: 'success',
            persist: false,
          })
        }
      } finally {
        setBusy(null)
      }
    },
    [requestPluginApi, enqueueSnackbar],
  )

  const handleOrgUninstall = useCallback(
    (install: any) => async () => {
      const confirmed = await confirm({
        title: `Uninstall "${install.displayName ?? install.$id}" org-wide?`,
        description:
          'Every site in the organization loses this plugin unless it has ' +
          'its own host-level pin. Data the plugin created stays untouched.',
        confirmationText: 'Uninstall',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      const payload = await requestPluginApi({
        listingId: install.$id,
        scope: 'org',
        action: 'uninstall',
      })
      if (payload) {
        enqueueSnackbar('Plugin uninstalled org-wide', {
          variant: 'success',
          persist: false,
        })
      }
    },
    [confirm, requestPluginApi, enqueueSnackbar],
  )

  const handleUninstall = useCallback(
    (install: any) => async () => {
      const confirmed = await confirm({
        title: `Uninstall "${install.displayName ?? install.$id}"?`,
        description:
          'Plugin elements pointing at it will show a placeholder until ' +
          'reinstalled. Data the plugin created stays untouched.',
        confirmationText: 'Uninstall',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      // Through the API (AGL-424) so the org enablement switchboard stays
      // in step with the removed pin.
      const payload = await requestPluginApi({
        listingId: install.$id,
        action: 'uninstall',
      })
      if (payload) {
        enqueueSnackbar('Plugin uninstalled', {
          variant: 'success',
          persist: false,
        })
      }
    },
    [confirm, requestPluginApi, enqueueSnackbar],
  )

  return (
    <CardDisplay header="Installed plugins" contentGutterX contentGutterY>
      <Stack spacing={1.5}>
        {/* First-party plugins active for this org (AGL-779), from the
            registry. Always-on is locked "Core"; the rest are toggled in
            the org Plugins settings, so they're shown here but not
            uninstalled from this card. */}
        {firstPartyPlugins.map((plugin) => (
          <Stack
            key={plugin.id}
            direction="row"
            spacing={1}
            sx={{
              alignItems: 'center',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              p: 1.5,
            }}
          >
            <Stack sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {plugin.label}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {plugin.description}
              </Typography>
            </Stack>
            {plugin.alwaysOn ? (
              <Tooltip title="Part of the platform — screens rely on its components, so it cannot be uninstalled.">
                <Chip size="small" color="secondary" label="Core" />
              </Tooltip>
            ) : (
              <Tooltip title="A first-party plugin, enabled for this organization. Turn it on or off in the Plugins settings.">
                <Chip size="small" variant="outlined" label="Enabled" />
              </Tooltip>
            )}
          </Stack>
        ))}
        {installs.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'No community plugins installed. Install one from the ' +
              'community, then add a Plugin element to a screen and set ' +
              'its listing id.'}
          </Typography>
        ) : (
          installs.map((install) => {
            const latest = latestByListing[install.$id]
            const canUpgrade = latest && latest !== install.version
            const revoked = revokedByListing[install.$id]
            const capabilities = install.manifest?.capabilities ?? {}
            return (
              <Stack
                key={install.$id}
                spacing={0.5}
                sx={{
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  p: 1.5,
                }}
              >
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center' }}
                >
                  <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                    {install.displayName ?? install.pluginId ?? install.$id}
                  </Typography>
                  <Chip size="small" label={`v${install.version}`} />
                  {revoked ? (
                    <Chip size="small" color="error" label="disabled" />
                  ) : null}
                  {canUpgrade ? (
                    <Button
                      size="small"
                      disabled={busy === install.$id}
                      onClick={handleUpgrade(install)}
                    >
                      {`Upgrade to v${latest}`}
                    </Button>
                  ) : null}
                  {orgId &&
                  !orgInstalls.some((entry) => entry.$id === install.$id) ? (
                    <Tooltip title="Install for every site in the organization and remove this site's own pin">
                      <Button
                        size="small"
                        disabled={busy === install.$id}
                        onClick={handleShareWithOrg(install)}
                      >
                        {'Share with org'}
                      </Button>
                    </Tooltip>
                  ) : null}
                  <Button
                    size="small"
                    color="error"
                    onClick={handleUninstall(install)}
                  >
                    {'Uninstall'}
                  </Button>
                </Stack>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {`id: ${install.$id}`}
                </Typography>
                {(capabilities.network?.length ||
                  capabilities.events?.length) && (
                  <Tooltip
                    title="Declared in the plugin manifest, enforced by the sandbox"
                  >
                    <Typography variant="caption" color="text.secondary">
                      {[
                        capabilities.network?.length
                          ? `network: ${capabilities.network.join(', ')}`
                          : null,
                        capabilities.events?.length
                          ? `events: ${capabilities.events.join(', ')}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Typography>
                  </Tooltip>
                )}
                {revoked ? (
                  <Alert severity="error" sx={{ mt: 0.5 }}>
                    {'The platform disabled this plugin version. It renders ' +
                      'a placeholder on your site until you upgrade or ' +
                      'uninstall it.'}
                  </Alert>
                ) : null}
              </Stack>
            )
          })
        )}
        {orgInstalls.map((install) => {
          const latest = latestByListing[install.$id]
          const canUpgrade = latest && latest !== install.version
          const shadowed = installs.some((entry) => entry.$id === install.$id)
          return (
            <Stack
              key={`org-${install.$id}`}
              spacing={0.5}
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                p: 1.5,
              }}
            >
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                  {install.displayName ?? install.pluginId ?? install.$id}
                </Typography>
                <Chip size="small" color="secondary" label="Organization" />
                <Chip size="small" label={`v${install.version}`} />
                {shadowed ? (
                  <Tooltip title="This site has its own pin, which takes precedence here">
                    <Chip size="small" variant="outlined" label="shadowed" />
                  </Tooltip>
                ) : null}
                {canUpgrade ? (
                  <Button
                    size="small"
                    disabled={busy === install.$id}
                    onClick={handleOrgUpgrade(install)}
                  >
                    {`Upgrade to v${latest}`}
                  </Button>
                ) : null}
                <Button
                  size="small"
                  color="error"
                  onClick={handleOrgUninstall(install)}
                >
                  {'Uninstall'}
                </Button>
              </Stack>
              <Typography variant="caption" color="text.secondary" noWrap>
                {`id: ${install.$id} · shared with every site in the org`}
              </Typography>
            </Stack>
          )
        })}
        <Typography variant="caption" color="text.secondary">
          {`Place a plugin on a screen with the Plugin element (component id ` +
            `"${PLUGIN_COMPONENT_ID}"), set to the listing id above.`}
        </Typography>
      </Stack>
    </CardDisplay>
  )
}
HostPluginsCard.displayName = 'HostPluginsCard'

export default HostPluginsCard
