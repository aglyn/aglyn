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

/**
 * What the workspace can move (AGL-3535): every transfer resource its
 * plugins declare, grouped by plugin, each with Import and Export.
 *
 *  - Records (contacts, leads, list members…) open the import wizard and
 *    the export dialog through the shell's launcher, for the workspace or
 *    for the site picked — a site's records follow that site's plugins.
 *  - Packages (sequences, campaigns, automations, email templates) open the
 *    workspace package export and import here: one file can carry several
 *    resources' items, and every reference between them is moved together.
 *  - A site's own package — its pages, emails, forms and theme — is its
 *    Backup & restore, linked per site.
 */

import { transferResourceInstanceKey } from '@aglyn/aglyn/data-transfer'
import { listTransferResourcesFor, pluginTransferResourceUi, TRANSFER_RESOURCES_LOAD_POINT, type ResolvedTransferResourceDeclaration } from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { pluginRecordListQuery, pluginRecordsFromRows } from '@aglyn/aglyn/plugin-manager/plugin-record-lists'
import { useTransferLauncher, type TransferLauncher } from '@aglyn/aglyn/app-utils/transfer-launcher-context'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { Alert, Box, Button, Chip, Divider, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { getDocs, type Firestore } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import { buildRoute, Route } from '../../constants/route-links'
import { PLUGIN_SURFACE_TITLES } from '../../constants/plugins.titles.generated'
import { docsHelp } from '../../constants/docs-links'
import { useConsoleSlotPlugins } from '../../hooks/use-console-plugins'
import useCurrentOrg from '../../hooks/use-current-org'
import { useOrgHosts } from '../../hooks/use-org-hosts'
import { useOrgSlug } from '../../hooks/use-org-scope'
import { createTransferHubClient } from '../../utils/transfer-hub-client'
import { HubDialog } from '../transfer-hub/hub-dialog.component'
import OrgPackageExport from '../transfer-hub/org-package-export.component'
import OrgPackageImport from '../transfer-hub/org-package-import.component'

type Open = { kind: 'packageImport' } | { kind: 'packageExport'; resources?: string[] } | null

/** What a resource is called on the hub: its plugin's own label, else its declaration's. */
function labelOf(resource: ResolvedTransferResourceDeclaration): string {
  return pluginTransferResourceUi(resource.key)?.label ?? resource.label
}

/** Resources by plugin, in config order. */
function byPlugin(resources: readonly ResolvedTransferResourceDeclaration[]) {
  const groups = new Map<string, ResolvedTransferResourceDeclaration[]>()
  for (const resource of resources) groups.set(resource.pluginId, [...(groups.get(resource.pluginId) ?? []), resource])
  return [...groups]
}

/** How many instances of one resource the hub lists. */
const INSTANCES_SHOWN = 100

/**
 * A resource moved one instance at a time (`instances`: one dataset's
 * records): each instance the plugin's record list holds, with its own
 * Import and Export under the instance's key.
 */
function InstanceRows(props: {
  resource: ResolvedTransferResourceDeclaration
  firestore: Firestore
  orgId: string
  hostId: string | null
  launcher: TransferLauncher
}) {
  const { resource, firestore, orgId, hostId, launcher } = props
  const kind = pluginTransferResourceUi(resource.key)?.instancesFrom ?? null
  const [instances, setInstances] = useState<Array<{ id: string; name: string }> | null>(null)
  useEffect(() => {
    let active = true
    const query = kind ? pluginRecordListQuery(kind, firestore, { orgId, hostId, limit: INSTANCES_SHOWN }) : null
    if (!kind || !query) {
      setInstances([])
      return undefined
    }
    getDocs(query)
      .then((snapshot) => {
        if (!active) return
        const records = pluginRecordsFromRows(kind, snapshot.docs.map((doc) => ({ ...doc.data(), $id: doc.id })))
        setInstances(records.map((record) => ({ id: record.id, name: record.name || record.id })))
      })
      .catch(() => active && setInstances([]))
    return () => {
      active = false
    }
  }, [kind, firestore, orgId, hostId])

  if (!kind) {
    return (
      <Typography variant="caption" color="text.secondary">
        {'Moved one at a time from its own page.'}
      </Typography>
    )
  }
  if (instances && !instances.length) {
    return (
      <Typography variant="caption" color="text.secondary">
        {'None yet.'}
      </Typography>
    )
  }
  return (
    <Stack sx={{ pl: 2 }}>
      {(instances ?? []).map((instance) => {
        const launch = {
          resource: transferResourceInstanceKey(resource.key, instance.id),
          scope: resource.scope,
          ...(hostId ? { hostId } : {}),
          title: `${labelOf(resource)}: ${instance.name}`,
        }
        return (
          <Stack key={instance.id} direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="body2">{instance.name}</Typography>
            <Stack direction="row" spacing={1}>
              <Button size="small" onClick={() => launcher.openImport(launch)}>
                {'Import'}
              </Button>
              <Button size="small" onClick={() => launcher.openExport(launch)}>
                {'Export'}
              </Button>
            </Stack>
          </Stack>
        )
      })}
    </Stack>
  )
}

export function OrgDataTransferCard(props: { onImported?(): void }) {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const orgSlug = useOrgSlug()
  const { org, orgId, ready } = useCurrentOrg()
  const { hosts } = useOrgHosts(firestore, user?.uid, orgId)
  const launcher = useTransferLauncher()
  const loaded = useConsoleSlotPlugins([TRANSFER_RESOURCES_LOAD_POINT])
  const [hostId, setHostId] = useState('')
  const [open, setOpen] = useState<Open>(null)

  const client = useMemo(
    () => (orgId ? createTransferHubClient({ orgId, fetch: (input, init) => authorizedFetch(user, input, init) }) : null),
    [orgId, user],
  )
  // Until the workspace document is confirmed, its enabled plugins are unknown: nothing is offered.
  const orgResources = useMemo(
    () => (ready && org ? listTransferResourcesFor({ scope: 'org', org: org as { enabledPlugins?: string[] } }) : []),
    [org, ready],
  )
  const site = hosts.find((host) => host.$id === hostId) ?? hosts[0]
  const siteResources = useMemo(
    () =>
      ready && org && site
        ? listTransferResourcesFor({
            scope: 'host',
            org: org as { enabledPlugins?: string[] },
            host: site as { disabledPlugins?: string[]; enabledPlugins?: string[] },
          })
        : [],
    [org, ready, site],
  )

  const actions = (resource: ResolvedTransferResourceDeclaration, siteId: string | null) => {
    // One instance at a time: its instances are listed under it instead.
    if (resource.instances) return null
    const scope = resource.scope
    const base = { resource: resource.key, scope, ...(siteId ? { hostId: siteId } : {}) }
    return (
      <Stack direction="row" spacing={1}>
        {resource.kinds.includes('records') && launcher && (
          <>
            <Button size="small" onClick={() => launcher.openImport(base)}>
              {'Import'}
            </Button>
            <Button size="small" onClick={() => launcher.openExport(base)}>
              {'Export'}
            </Button>
          </>
        )}
        {resource.kinds.includes('package') && client && (
          <>
            <Button size="small" onClick={() => setOpen({ kind: 'packageImport' })}>
              {'Import'}
            </Button>
            <Button size="small" onClick={() => setOpen({ kind: 'packageExport', resources: [resource.key] })}>
              {'Export'}
            </Button>
          </>
        )}
      </Stack>
    )
  }

  const listing = (resources: readonly ResolvedTransferResourceDeclaration[], siteId: string | null) =>
    byPlugin(resources).map(([pluginId, list]) => (
      <Box key={pluginId}>
        <Typography variant="subtitle2" sx={{ mt: 1 }}>
          {PLUGIN_SURFACE_TITLES[pluginId] ?? pluginId}
        </Typography>
        {list.map((resource) => (
          <Stack
            key={resource.key}
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            sx={{ py: 1, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
          >
            <Box>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="body2">{labelOf(resource)}</Typography>
                <Chip size="small" variant="outlined" label={resource.kinds.includes('package') ? 'Package' : 'Records'} />
              </Stack>
              {resource.description && (
                <Typography variant="caption" color="text.secondary">
                  {resource.description}
                </Typography>
              )}
            </Box>
            {actions(resource, siteId)}
          </Stack>
        )).flatMap((row, at) => {
          const resource = list[at] as ResolvedTransferResourceDeclaration
          return resource.instances && launcher && orgId
            ? [
                row,
                <InstanceRows
                  key={`${resource.key}:instances`}
                  resource={resource}
                  firestore={firestore}
                  orgId={orgId}
                  hostId={siteId}
                  launcher={launcher}
                />,
              ]
            : [row]
        })}
      </Box>
    ))

  const hasPackages = orgResources.some((resource) => resource.kinds.includes('package'))

  return (
    <CardDisplay
      header={'Import & export'}
      help={docsHelp('transferHub', {
        excerpt: 'Move records and packages in and out of this workspace: choose the fields, match what you have, decide every conflict, and undo for seven days.',
      })}
      HeaderProps={{
        action: hasPackages && client ? (
          <Stack direction="row" spacing={1}>
            <Button size="small" onClick={() => setOpen({ kind: 'packageImport' })}>
              {'Import package'}
            </Button>
            <Button size="small" variant="contained" onClick={() => setOpen({ kind: 'packageExport' })}>
              {'Export package'}
            </Button>
          </Stack>
        ) : undefined,
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        {(!loaded || !ready) && <Typography variant="body2">{'Loading what this workspace can move…'}</Typography>}
        <Typography variant="body2" color="text.secondary">
          {'Every import shows what it would do before it writes anything, asks how to handle each conflict, and can be undone for seven days.'}
        </Typography>
        <Box>
          <Typography variant="subtitle1">{'The workspace'}</Typography>
          {orgResources.length ? listing(orgResources, null) : (
            <Typography variant="body2" color="text.secondary">
              {'None of the plugins this workspace runs moves workspace data yet.'}
            </Typography>
          )}
        </Box>
        <Divider />
        <Box>
          <Typography variant="subtitle1">{'A site'}</Typography>
          {hosts.length ? (
            <>
              <TextField
                select
                size="small"
                label="Site"
                value={site?.$id ?? ''}
                onChange={(event) => setHostId(event.target.value)}
                sx={{ mt: 1, minWidth: 240 }}
              >
                {hosts.map((host) => (
                  <MenuItem key={host.$id} value={host.$id}>
                    {String(host['name'] ?? host['subdomain'] ?? host.$id)}
                  </MenuItem>
                ))}
              </TextField>
              {site && listing(siteResources, site.$id)}
              {site && (
                <Stack direction="row" spacing={1} sx={{ py: 1, alignItems: 'center', justifyContent: 'space-between' }}>
                  <Box>
                    <Typography variant="body2">{'Site package'}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {'Its pages, emails, forms, theme and content as one file — a backup, or items for another site.'}
                    </Typography>
                  </Box>
                  <Button
                    size="small"
                    component={AppLink}
                    href={buildRoute(Route.HOST_ADMIN_BACKUP, { orgSlug, host: String(site['subdomain'] ?? site.$id) })}
                  >
                    {'Backup & restore'}
                  </Button>
                </Stack>
              )}
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {'This workspace has no sites yet.'}
            </Typography>
          )}
        </Box>
        {!launcher && (
          <Alert severity="info">{'Import and export of records open inside a workspace.'}</Alert>
        )}
      </Stack>
      {open?.kind === 'packageImport' && client && (
        <HubDialog title="Import a package" id="org-package-import-title" onClose={() => setOpen(null)}>
          <OrgPackageImport client={client} onImported={props.onImported} onDone={() => setOpen(null)} />
        </HubDialog>
      )}
      {open?.kind === 'packageExport' && client && (
        <HubDialog title="Export a package" id="org-package-export-title" onClose={() => setOpen(null)}>
          <OrgPackageExport client={client} resources={open.resources} onDone={() => setOpen(null)} />
        </HubDialog>
      )}
    </CardDisplay>
  )
}

export default OrgDataTransferCard
