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

import { FIRST_PARTY_PLUGINS, isLockedOnForSite } from '@aglyn/aglyn'
import { orgPermissionLabel, permissionRefusalText } from '@aglyn/aglyn/app-utils/org-permissions'
import {
  planPluginRunsOn,
  pluginRunsOnOf,
  pluginRunsOnOptInNote,
  type PluginRunsOn,
  type PluginSiteEntry,
} from '@aglyn/aglyn/plugin-manager/plugin-site-exclusions'
import {
  SiteSharingField,
  type SiteSharingValue,
} from '@aglyn/shared-ui-jsx/components/site-sharing-field.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Button, Stack, Typography } from '@mui/material'
import { useEffect, useMemo, useState } from 'react'

/** A workspace site, as the host list reads it. */
export interface PluginRunsOnSite extends PluginSiteEntry {
  name: string
}

export interface PluginRunsOnFieldProps {
  orgId: string
  /** A built-in plugin's id. */
  pluginId: string
  /** The workspace document, for what it switches on. */
  org: { enabledPlugins?: string[] } | null | undefined
  /** The workspace's sites with their plugin lists, as their documents hold them. */
  sites: readonly PluginRunsOnSite[]
  /** False while the sites are still being read. */
  sitesReady: boolean
  /** Whether the plugin is on for the workspace; null while that is being read. */
  onForWorkspace: boolean | null
  /** Whether the workspace's permissions have been read. */
  permissionsLoaded: boolean
  /** "Organization settings", the key the route asks first. */
  canChange: boolean
}

const asField = (runsOn: PluginRunsOn): SiteSharingValue =>
  runsOn.mode === 'all' ? { mode: 'all' } : { mode: 'allExcept', exceptHostIds: [...runsOn.exceptHostIds] }

const asChoice = (value: SiteSharingValue): PluginRunsOn =>
  value.mode === 'allExcept' ? { mode: 'allExcept', exceptHostIds: value.exceptHostIds } : { mode: 'all' }

const sameChoice = (a: PluginRunsOn, b: PluginRunsOn): boolean =>
  a.mode === b.mode &&
  (a.mode === 'all' ||
    (b.mode === 'allExcept' &&
      a.exceptHostIds.length === b.exceptHostIds.length &&
      a.exceptHostIds.every((id) => b.exceptHostIds.includes(id))))

const count = (n: number) => (n === 1 ? '1 site' : `${n} sites`)

/**
 * Which of the workspace's sites a built-in plugin runs on: All sites, or all
 * sites except some (AGL-4047).
 *
 * Read across the sites' own plugin lists and written into them by
 * `/api/orgs/plugin-sites`, so it stores nothing of its own: a site added
 * later runs the plugin, and a site left out can turn it back on for itself.
 * "Selected sites" is not offered, because a site added later would get the
 * plugin anyway.
 *
 * Off, with the reason, when the base library is asked about (it runs on
 * every site), when the workspace has the plugin switched off, and for a
 * member without "Organization settings".
 */
export function PluginRunsOnField(props: PluginRunsOnFieldProps) {
  const { orgId, pluginId, org, sites, sitesReady, onForWorkspace, permissionsLoaded, canChange } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const plugin = FIRST_PARTY_PLUGINS.find((one) => one.id === pluginId)
  const label = plugin?.label ?? pluginId

  const stored = useMemo(() => pluginRunsOnOf(pluginId, sites), [pluginId, sites])
  const [draft, setDraft] = useState<PluginRunsOn | null>(null)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  // A save, or another tab, moving the sites underneath resets the draft.
  const storedKey = stored.mode === 'all' ? 'all' : [...stored.exceptHostIds].sort().join('|')
  useEffect(() => {
    setDraft(null)
    setRefusal(null)
  }, [storedKey])

  const choice = draft ?? stored
  const dirty = draft !== null && !sameChoice(draft, stored)
  const plan = useMemo(
    () =>
      sitesReady
        ? planPluginRunsOn({
            pluginId,
            choice,
            org,
            sites,
            siteName: (hostId) => sites.find((site) => site.id === hostId)?.name ?? 'a site',
          })
        : null,
    [choice, org, pluginId, sites, sitesReady],
  )

  const locked = isLockedOnForSite(pluginId)
  const readOnlyReason = locked
    ? 'Sites are built out of it, so it runs on every site.'
    : onForWorkspace === false
      ? 'It is switched off for this workspace, so it runs on no site. Switch it on to choose where it runs.'
      : permissionsLoaded && !canChange
        ? permissionRefusalText('org.settings')
        : undefined
  const readOnly = locked || onForWorkspace !== true || !permissionsLoaded || !canChange || busy

  const save = async () => {
    if (!dirty || !plan || plan.problem !== null) return
    setBusy(true)
    setRefusal(null)
    try {
      const response = await authorizedFetch(user, '/api/orgs/plugin-sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, pluginId, choice }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setRefusal(String(payload?.error ?? 'Request failed'))
        return
      }
      enqueueSnackbar(`Saved where ${label} runs`, { variant: 'success', persist: false })
    } finally {
      setBusy(false)
    }
  }

  const leftOut = plan?.writes?.filter((write) => write.leftOut).length ?? 0
  const broughtBack = plan?.writes?.filter((write) => !write.leftOut).length ?? 0
  const optInNote = pluginRunsOnOptInNote(pluginId)

  return (
    <Stack spacing={1}>
      <SiteSharingField
        label="Runs on"
        value={asField(locked ? { mode: 'all' } : choice)}
        onChange={(next) => {
          setRefusal(null)
          setDraft(asChoice(next))
        }}
        sites={sites.map((site) => ({ id: site.id, name: site.name }))}
        sitesReady={sitesReady}
        modes={['all', 'allExcept']}
        readOnly={readOnly}
        readOnlyReason={readOnlyReason}
        problem={!readOnly && dirty ? (plan?.problem ?? refusal) : refusal}
      />
      {locked ? null : (
        <Typography variant="caption" color="text.secondary">
          {'A site left out can turn it back on for itself: anyone holding ' +
            `“${orgPermissionLabel('site.manage')}” on that site, which its admins hold by default, ` +
            'can switch it on from the site’s Admin › Plugins page.'}
        </Typography>
      )}
      {optInNote && !locked ? (
        <Typography variant="caption" color="text.secondary">
          {optInNote}
        </Typography>
      ) : null}
      {choice.mode === 'allExcept' && plugin?.siteOff?.stops && !locked ? (
        <Typography variant="caption" color="text.secondary">
          {`On each site left out: ${plugin.siteOff.stops}`}
        </Typography>
      ) : null}
      {dirty && !readOnly ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}>
          {plan && plan.problem === null && (leftOut || broughtBack) ? (
            <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
              {[
                leftOut ? `Takes ${label} off ${count(leftOut)}.` : '',
                broughtBack ? `Turns it back on for ${count(broughtBack)}.` : '',
              ]
                .filter(Boolean)
                .join(' ')}
            </Typography>
          ) : null}
          <Button variant="text" disabled={busy} onClick={() => setDraft(null)}>
            {'Cancel'}
          </Button>
          <Button
            variant="contained"
            disabled={busy || !plan || plan.problem !== null}
            onClick={() => void save()}
          >
            {'Save'}
          </Button>
        </Stack>
      ) : null}
    </Stack>
  )
}
PluginRunsOnField.displayName = 'PluginRunsOnField'

export default PluginRunsOnField
