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
  buildRoute,
  pluginDocsHelp,
  Route,
  type ConsoleOrgPluginInstallsZoneProps,
} from '@aglyn/aglyn'
import { mdiChevronRight } from '@aglyn/shared-data-mdi'
import { AppLink, CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import { Alert, Chip, Stack, Tooltip, Typography } from '@mui/material'
import {
  collection,
  documentId,
  getDocs,
  limit,
  query,
  where,
} from 'firebase/firestore'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
} from '@aglyn/tenant-feature-instance'
import { resolveUpdateState, updateStateLabel } from '../model/update-state'

/** One installation: its org pin, or the sites that pin it. */
interface Installation {
  $id: string
  displayName?: string
  pluginId?: string
  version?: string
  siteLabels: string[]
  orgWide: boolean
}

/**
 * "Installed from the marketplace", on the workspace's Plugins page — the
 * `orgPluginInstalls` zone (AGL-1011, drawn here since AGL-3080).
 *
 * The page is the workspace's inventory, first-party and marketplace
 * together, because where a plugin came from is a fact about it rather than a
 * different kind of thing. The built-in half is the shell's. This half is the
 * marketplace's: the pins are its `installs`, and the update chip compares
 * them with its listings and its kill switches — so the page hands over the
 * sites it can see and this card draws the rest.
 *
 * One row per INSTALLATION, not per pin: a plugin on three sites is one thing
 * an admin manages, and the scope is a fact about it rather than three
 * separate entries. An org pin covers every site, so it wins the caption
 * outright. Every row goes to the shell's installation page, which is where
 * an installation is managed.
 */
export function OrgPluginInstallsCard(props: ConsoleOrgPluginInstallsZoneProps) {
  const { orgId, orgSlug, hosts } = props
  const firestore = useFirestore()

  // Held at null while the org resolves, never `orgs/-pending-` (AGL-1440):
  // installs are member-gated, so the sentinel was a guaranteed-denied listen
  // on every mount.
  const { data: orgInstalls } = useFirestoreCollection<any>(
    () =>
      orgId
        ? query(collection(firestore, 'orgs', orgId, 'installs'), limit(100))
        : null,
    [firestore, orgId],
    { idField: '$id' },
  )

  // Site pins too (AGL-1012). Reading only the org pins meant a plugin
  // targeted at specific sites — installed, running, and the whole point of
  // AGL-773/997 — was absent from the workspace's own plugin inventory.
  // Fan-in per site: the host count is data, so a hook per host would change
  // the hook count between renders.
  const hostIdsKey = hosts.map((host) => host.id).join('|')
  const [sitePins, setSitePins] = useState<Record<string, any[]>>({})
  useEffect(() => {
    if (!hosts.length) return
    let active = true
    void Promise.all(
      hosts.map(async (host) => {
        const snapshot = await getDocs(
          query(collection(firestore, 'hosts', host.id, 'installs'), limit(100)),
        )
        return [
          host.id,
          snapshot.docs.map((entry) => ({ $id: entry.id, ...entry.data() })),
        ] as const
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
  }, [firestore, hostIdsKey])

  const installations = useMemo(() => {
    const byListing = new Map<string, Installation>()
    for (const install of orgInstalls ?? []) {
      byListing.set(install.$id, { ...install, siteLabels: [], orgWide: true })
    }
    for (const host of hosts) {
      for (const pin of sitePins[host.id] ?? []) {
        const existing = byListing.get(pin.$id)
        if (existing) existing.siteLabels.push(host.label)
        else
          byListing.set(pin.$id, {
            ...pin,
            siteLabels: [host.label],
            orgWide: false,
          })
      }
    }
    return [...byListing.values()]
  }, [orgInstalls, hosts, sitePins])

  /**
   * The listings behind those installs, for the update chip (AGL-1016), and
   * their kill switches (AGL-2368) — a revoked version stays `approved`,
   * because revocation does not clear a review verdict, so without them the
   * chip offered an update `install-plugin` answers 409 to.
   *
   * Both are public reads, so plain fetches — but `in` caps at 30 ids, and a
   * workspace can run more plugins than that, so they chunk. A failure leaves
   * a map empty and every row resolves to `unknown`, which reads as "we can't
   * say" rather than a false "up to date".
   */
  const listingIdsKey = installations
    .map((install) => install.$id)
    .sort()
    .join('|')
  const [listings, setListings] = useState<Record<string, any>>({})
  const [revocations, setRevocations] = useState<Record<string, any>>({})
  useEffect(() => {
    const ids = listingIdsKey ? listingIdsKey.split('|') : []
    if (!ids.length) return
    let active = true
    const chunks: string[][] = []
    for (let index = 0; index < ids.length; index += 30) {
      chunks.push(ids.slice(index, index + 30))
    }
    const fetchChunks = (path: string) =>
      Promise.all(
        chunks.map((chunk) =>
          getDocs(
            query(collection(firestore, path), where(documentId(), 'in', chunk)),
          ),
        ),
      ).then((results) =>
        Object.fromEntries(
          results.flatMap((snapshot) =>
            snapshot.docs.map((entry) => [entry.id, entry.data()]),
          ),
        ),
      )
    void fetchChunks('marketplaceListings')
      .then((map) => {
        if (active) setListings(map)
      })
      .catch(() => undefined)
    void fetchChunks('revocations')
      .then((map) => {
        if (active) setRevocations(map)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [firestore, listingIdsKey])

  return (
    <CardDisplay
      header={'Installed from the marketplace'}
      // Card-level help, not just the page's (AGL-2129). This is the card
      // people arrive at looking for a switch, having read in Marketplace
      // that installing is done there — so it points at the step of the
      // walkthrough that explains the split.
      help={pluginDocsHelp('publisherHandbook', {
        anchor: '#installed-from-the-marketplace',
      })}
      contentGutterX
      contentGutterY
    >
      {installations.length ? (
        <Stack>
          {installations.map((install) => {
            // The update signal (AGL-1016/2368), from the one shared
            // comparison — for plugins that is the newest INSTALLABLE
            // version, so this can never offer what install refuses.
            const status = resolveUpdateState(
              install as never,
              listings[install.$id] ?? null,
              'plugin',
              revocations[install.$id] ?? null,
            )
            return (
              <InstallationRow
                key={install.$id}
                href={buildRoute(Route.ORG_PLUGIN_INSTALLATION, {
                  orgSlug,
                  pluginRef: install.$id,
                })}
                label={install.displayName ?? install.pluginId ?? install.$id}
                caption={
                  `v${install.version} · ` +
                  (install.orgWide
                    ? 'every site in this organization'
                    : install.siteLabels.length === 1
                      ? install.siteLabels[0]
                      : `${install.siteLabels.length} sites`)
                }
                trailing={
                  status.state === 'update-available' ? (
                    <Chip
                      size="small"
                      color="primary"
                      variant="outlined"
                      label={`v${status.availableVersion} available`}
                    />
                  ) : status.state === 'unknown' ? (
                    <Tooltip title={updateStateLabel(status)}>
                      <Chip size="small" variant="outlined" label={'Unknown'} />
                    </Tooltip>
                  ) : undefined
                }
              />
            )
          })}
        </Stack>
      ) : (
        <Alert severity="info">
          {'Nothing installed from the marketplace yet — browse it to add one.'}
        </Alert>
      )}
    </CardDisplay>
  )
}

/**
 * One row, drawn the way the page draws its built-in rows: the whole row is
 * the link and a chevron says so, because the entry point AGL-1011 replaced
 * was a name rendered as body text that nothing said went anywhere.
 */
function InstallationRow(props: {
  href: string
  label: string
  caption: string
  trailing?: ReactNode
}) {
  const { href, label, caption, trailing } = props
  return (
    <AppLink href={href} color="inherit" underline="none">
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
        <MdiIcon path={mdiChevronRight.path} color="disabled" sx={{ fontSize: 20 }} />
      </Stack>
    </AppLink>
  )
}

export default OrgPluginInstallsCard
