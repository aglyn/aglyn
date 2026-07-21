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
  resolveEnabledPlugins,
  type ReleaseFlagKey,
} from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import {
  Button,
  Chip,
  List,
  ListItem,
  ListItemText,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import { useReleaseFlags } from '../hooks/use-release-flags'

export interface OrgPluginsCardProps {
  /** The org doc (billing/org shape) carrying `enabledPlugins`. */
  org: { enabledPlugins?: string[] } | undefined
  disabled?: boolean
  /** Persists the new list (the settings API `set-enabled-plugins` action). */
  onSave: (enabledPlugins: string[]) => Promise<void>
}

/**
 * Org plugin switchboard (AGL-416): toggles which plugins the workspace
 * LOADS — nav items, pages, site components, and API surface all follow the
 * loader (AGL-417). Always-on plugins (base components) render disabled.
 * Entitlement gating still applies on top: enabling a plugin the plan
 * doesn't include shows its surfaces locked, exactly as before.
 */
export default function OrgPluginsCard(props: OrgPluginsCardProps) {
  const { org, disabled, onSave } = props
  const [enabled, setEnabled] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  // Platform release state per plugin (AGL-422): a flagged-off plugin is
  // hidden from customers regardless of the org toggle — staff see it with
  // a warning chip instead (the usual staff-preview bypass).
  const { flags, isStaff } = useReleaseFlags()

  useEffect(() => {
    if (!dirty) setEnabled(resolveEnabledPlugins(org))
    // Reset from the live doc until the user starts editing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org?.enabledPlugins])

  const toggle = (id: string) => {
    setDirty(true)
    setEnabled((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    )
  }

  const save = async () => {
    setBusy(true)
    try {
      await onSave(enabled)
      setDirty(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <CardDisplay
      header="Plugins"
      help={docsHelp('plugins', {
        anchor: '#how-plugins-run',
        excerpt:
          'Choose which plugins this workspace loads — disabled plugins ' +
          'disappear from navigation, the editor, published sites, and the ' +
          'API.',
      })}
      contentGutterX
      contentGutterY
      sx={{ mt: 3 }}
    >
      <Stack spacing={1} sx={{ maxWidth: 560 }}>
        <Typography variant="body2" color="text.secondary">
          {'Choose which plugins this workspace loads. Disabled plugins ' +
            'disappear from navigation, the editor, published sites, and ' +
            'the API. Plan entitlements still apply to enabled plugins.'}
        </Typography>
        <List dense disablePadding>
          {FIRST_PARTY_PLUGINS.map((plugin) => {
            const flagState = plugin.releaseFlag
              ? flags[plugin.releaseFlag as ReleaseFlagKey]
              : undefined
            const flaggedOff = flagState ? !flagState.released : false
            const rolloutPercent = flagState?.value.enabled
              ? undefined
              : flagState?.value.rolloutPercent
            return (
              <ListItem
                key={plugin.id}
                disableGutters
                secondaryAction={
                  <Switch
                    edge="end"
                    checked={plugin.alwaysOn || enabled.includes(plugin.id)}
                    disabled={Boolean(disabled) || plugin.alwaysOn || busy}
                    onChange={() => toggle(plugin.id)}
                    slotProps={{
                      input: { 'aria-label': `Toggle ${plugin.label}` },
                    }}
                  />
                }
              >
                <ListItemText
                  primary={
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center' }}
                    >
                      <span>{plugin.label}</span>
                      {flaggedOff ? (
                        <Tooltip
                          title={
                            isStaff
                              ? 'Release flag is off — customers cannot load ' +
                                'this plugin; you see it via the staff bypass.'
                              : 'Not released to your workspace yet.'
                          }
                        >
                          <Chip
                            size="small"
                            color="warning"
                            variant="outlined"
                            label={
                              rolloutPercent
                                ? `${rolloutPercent}% rollout`
                                : 'Not released'
                            }
                          />
                        </Tooltip>
                      ) : null}
                    </Stack>
                  }
                  secondary={
                    plugin.alwaysOn
                      ? `${plugin.description ?? ''} Always on.`.trim()
                      : plugin.description
                  }
                />
              </ListItem>
            )
          })}
        </List>
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            disabled={Boolean(disabled) || !dirty || busy}
            onClick={() => void save()}
          >
            {'Save plugins'}
          </Button>
        </Stack>
      </Stack>
    </CardDisplay>
  )
}
