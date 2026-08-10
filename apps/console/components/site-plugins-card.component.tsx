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
  classifyEnabledPlugins,
  FIRST_PARTY_PLUGINS,
  resolveEnabledPlugins,
} from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  List,
  ListItem,
  ListItemText,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { useHost, writeGuardedBySeed } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../constants/docs-links'
import useCurrentOrg from '../hooks/use-current-org'

/**
 * Per-site plugin switchboard (AGL-1014), the host-level counterpart of
 * OrgPluginsCard: the org decides what the workspace may use; this card
 * narrows it for ONE site by writing the host doc's `disabledPlugins`
 * deny-list. A site can never widen beyond the org — org-disabled plugins
 * are simply not listed — and always-on plugins render locked, exactly as
 * they do on the org switchboard. `resolveHostEnabledPlugins` is the single
 * enforcement point (console nav, editor pages, published sites, API
 * dispatch), so a toggle here is a boundary, not a preference.
 */
export default function SitePluginsCard(props: { hostId: string }) {
  const { hostId } = props
  const { org } = useCurrentOrg()
  const { enqueueSnackbar } = useSnackbar()
  const {
    doc: {
      data: host,
      status: hostStatus,
      /**
       * The host doc the switch list is seeded from is unconfirmed by the
       * server (AGL-1358). This save writes the WHOLE `disabledPlugins`
       * array — `mergeFields` replaces it atomically, deliberately, because
       * a deep merge could never remove an id — so a cached seed re-enables
       * every plugin disabled since that snapshot.
       *
       * That is not a preference being lost. `resolveHostEnabledPlugins` is
       * the single enforcement point for navigation, the editor, published
       * pages and API dispatch, so a plugin switched back on here is running
       * again on a live site, with nobody having asked for it.
       */
      fromCache: hostFromCache,
    },
    setDoc,
  } = useHost({ hostId })
  const [disabled, setDisabled] = useState<string[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!dirty)
      setDisabled(
        Array.isArray(host?.disabledPlugins)
          ? host.disabledPlugins.map(String)
          : [],
      )
    // Reset from the live doc until the user starts editing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host?.disabledPlugins])

  // Only ORG-ENABLED plugins are listed: what the org has switched off does
  // not exist for any of its sites, so there is nothing to toggle here.
  const orgEnabled = useMemo(() => resolveEnabledPlugins(org), [org])
  const { bundles, listings } = useMemo(
    () => classifyEnabledPlugins(orgEnabled),
    [orgEnabled],
  )
  const catalog = useMemo(
    () => new Map(FIRST_PARTY_PLUGINS.map((plugin) => [plugin.id, plugin])),
    [],
  )

  const toggle = (id: string) => {
    setDirty(true)
    setDisabled((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    )
  }

  const save = async () => {
    setBusy(true)
    try {
      // The guard WRAPS the write (AGL-1356): an early return is a shape you
      // can keep while losing the protection.
      const verdict = await writeGuardedBySeed(
        {
          subject: 'site plugin list',
          unreadable: hostStatus === 'error',
          fromCache: hostFromCache,
        },
        async () => {
          // mergeFields replaces the array atomically — a deep merge could
          // never REMOVE an id, so re-enabling would silently not persist.
          // Which is also why a stale seed is dangerous rather than merely
          // wasteful: the array it replaces is the whole deny-list.
          await setDoc(
            { disabledPlugins: disabled },
            { mergeFields: ['disabledPlugins'] },
          )
        },
      )
      if (!verdict.ok) {
        // `dirty` stays true and the switches keep their positions, so the
        // user can retry once the page reloads rather than discovering later
        // that nothing was saved.
        return void enqueueSnackbar(verdict.message, { variant: 'warning' })
      }
      enqueueSnackbar('Site plugins saved', { variant: 'success' })
      setDirty(false)
    } catch (error) {
      enqueueSnackbar(`Error: ${JSON.stringify(error)}`, { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const rows = [
    ...bundles.map((id) => {
      const plugin = catalog.get(id)
      return {
        id,
        label: plugin?.label ?? id,
        description: plugin?.description,
        alwaysOn: Boolean(plugin?.alwaysOn),
      }
    }),
    ...listings.map((id) => ({
      id,
      label: id,
      description: 'Marketplace plugin installed by your workspace.',
      alwaysOn: false,
    })),
  ]

  return (
    <CardDisplay
      header="Site plugins"
      help={docsHelp('plugins', {
        anchor: '#how-plugins-run',
        excerpt:
          'Narrow which of the workspace-enabled plugins run on this site ' +
          '— a disabled plugin disappears from its navigation, editor, ' +
          'published pages, and API.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1} sx={{ maxWidth: 560 }}>
        <Typography variant="body2" color="text.secondary">
          {'Choose which of the workspace-enabled plugins run on this ' +
            'site. Disabling one removes it from this site only — ' +
            'navigation, the editor, published pages, and the API. Other ' +
            'sites in the workspace are unaffected, and a site can never ' +
            'enable a plugin the workspace has switched off.'}
        </Typography>
        <List dense disablePadding>
          {rows.map((row) => (
            <ListItem
              key={row.id}
              disableGutters
              secondaryAction={
                <Switch
                  edge="end"
                  checked={row.alwaysOn || !disabled.includes(row.id)}
                  disabled={row.alwaysOn || busy}
                  onChange={() => toggle(row.id)}
                  slotProps={{
                    input: { 'aria-label': `Toggle ${row.label} on this site` },
                  }}
                />
              }
            >
              <ListItemText
                primary={row.label}
                secondary={
                  row.alwaysOn
                    ? `${row.description ?? ''} Always on.`.trim()
                    : row.description
                }
              />
            </ListItem>
          ))}
        </List>
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            disabled={!dirty || busy}
            onClick={() => void save()}
          >
            {'Save site plugins'}
          </Button>
        </Stack>
      </Stack>
    </CardDisplay>
  )
}
SitePluginsCard.displayName = 'SitePluginsCard'
