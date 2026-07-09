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

import { PLUGIN_COMPONENT_ID } from '@aglyn/aglyn'
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
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import useFirestoreCollection from '../../hooks/use-firestore-collection'

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

  const { data: installDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'installs'), limit(50)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const installs = useMemo(
    () => [...((installDocs as any[]) ?? [])],
    [installDocs],
  )
  const listingIds = useMemo(
    () => installs.map((install) => install.$id).slice(0, 10),
    [installs],
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

  const handleUninstall = useCallback(
    (install: any) => async () => {
      const confirmed = await confirm({
        title: `Uninstall "${install.displayName ?? install.$id}"?`,
        description:
          'Plugin elements pointing at it will show a placeholder until ' +
          'reinstalled.',
        confirmationText: 'Uninstall',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      await deleteDoc(doc(firestore, 'hosts', hostId, 'installs', install.$id))
      enqueueSnackbar('Plugin uninstalled', {
        variant: 'success',
        persist: false,
      })
    },
    [confirm, firestore, hostId, enqueueSnackbar],
  )

  return (
    <CardDisplay header="Installed plugins" contentGutterX contentGutterY>
      <Stack spacing={1.5}>
        {installs.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'No plugins installed. Install one from the community, then ' +
              'add a Plugin element to a screen and set its listing id.'}
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
