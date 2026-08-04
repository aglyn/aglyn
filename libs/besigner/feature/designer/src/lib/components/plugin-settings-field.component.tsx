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

import * as Aglyn from '@aglyn/aglyn'
import { useFieldApi, useFormApi } from '@aglyn/shared-ui-jsx-forms'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'

/** Mapper key for the attributes form (editor-internal, never persisted). */
export const PLUGIN_SETTINGS_FIELD_COMPONENT = 'aglyn-plugin-settings-field'

/** Parses the stored JSON, tolerating anything an author may have typed. */
function parseSettings(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value.trim()) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/** True when the stored value is non-empty but not parseable. */
function isBrokenJson(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    JSON.parse(value)
    return false
  } catch {
    return true
  }
}

const serialize = (settings: Record<string, unknown>): string =>
  Object.keys(settings).length ? JSON.stringify(settings) : ''

/**
 * A plugin's settings, as real fields (AGL-1049).
 *
 * `Plugin settings (JSON)` was a textarea: authors hand-wrote
 * `{"title":"Spring sale"}` with no validation, no defaults, no idea which keys
 * exist, and no feedback when a key was dropped for not being in the manifest.
 * `filterPluginProps` drops anything undeclared, so a typo does not fail — it
 * quietly does nothing, which is the worst of the options.
 *
 * The fields come from `resolvePluginPropFields`, which is driven by
 * `capabilities.props` — THE allowlist — and merely decorated by the
 * publisher's optional `propSchema`. So the form agrees with the filter by
 * construction: it cannot offer a setting the plugin will not receive, and a
 * plugin that predates `propSchema` still gets a field per declared prop as
 * plain text rather than a blank box.
 *
 * ## Which plugin
 *
 * Read from the SIBLING `listingId` field through the form API rather than
 * from props. The two attributes are edited in one form and the settings are
 * meaningless without the selection, so this has to follow it live — picking a
 * different plugin has to re-render against a different manifest, not keep
 * showing the last one's fields.
 *
 * ## The escape hatch stays
 *
 * Raw JSON behind a toggle, per the issue: a plugin may legitimately accept a
 * key no schema covers, and taking that away to make the generated form look
 * tidier would remove the only way to set it. It is not the way in, though —
 * it is the way out.
 */
export function PluginSettingsField(props: Record<string, unknown>) {
  const { input, label, description, isDisabled } = useFieldApi(props as never)
  const formApi = useFormApi()
  const [rawMode, setRawMode] = useState(false)

  // The sibling selection. `getState()` rather than a subscription: the
  // attributes form re-renders on every value change already, so reading here
  // is current without a second subscription to keep in step.
  const listingId = String(
    (formApi.getState().values as Record<string, unknown>)?.['listingId'] ?? '',
  )
  const install = Aglyn.getKnownPluginInstall(listingId || undefined)
  const fields = useMemo(
    () => Aglyn.resolvePluginPropFields(install),
    [install],
  )

  const settings = useMemo(() => parseSettings(input.value), [input.value])
  const broken = isBrokenJson(input.value)
  const unknownKeys = useMemo(
    () => Aglyn.unknownPluginPropKeys(install, settings),
    [install, settings],
  )

  const setKey = (name: string, value: unknown) => {
    const next = { ...settings }
    // Removing the key is not the same as storing `""`. An absent key lets the
    // plugin apply its own default; an empty string overrides it with nothing.
    if (value === undefined || value === '' || value === null) delete next[name]
    else next[name] = value
    input.onChange(serialize(next))
  }

  if (!listingId) {
    return (
      <Typography variant="caption" color="text.secondary">
        {'Choose a plugin above to see its settings.'}
      </Typography>
    )
  }

  return (
    <Stack spacing={1.5}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Typography variant="subtitle2">{label ?? 'Plugin settings'}</Typography>
        <Button size="small" onClick={() => setRawMode((raw) => !raw)}>
          {rawMode ? 'Use fields' : 'Edit as JSON'}
        </Button>
      </Stack>
      {description ? (
        <Typography variant="caption" color="text.secondary">
          {description}
        </Typography>
      ) : null}

      {broken ? (
        <Alert severity="warning">
          {'These settings are not valid JSON, so the plugin receives none of ' +
            'them. Fix them below, or clear the box.'}
        </Alert>
      ) : null}

      {unknownKeys.length ? (
        // The silent failure, named. This is the whole complaint in AGL-1049.
        <Alert severity="warning">
          {`This plugin does not declare ${unknownKeys
            .map((key) => `"${key}"`)
            .join(', ')}, so ${
            unknownKeys.length === 1 ? 'it is' : 'they are'
          } ignored. Check the spelling, or remove ${
            unknownKeys.length === 1 ? 'it' : 'them'
          }.`}
        </Alert>
      ) : null}

      {rawMode || broken ? (
        <TextField
          size="small"
          multiline
          minRows={3}
          fullWidth
          value={typeof input.value === 'string' ? input.value : ''}
          disabled={isDisabled}
          onChange={(event) => input.onChange(event.target.value)}
          placeholder='{"title":"Spring sale"}'
          helperText="Raw JSON — for keys no field covers."
        />
      ) : !fields.length ? (
        <Typography variant="caption" color="text.secondary">
          {'This plugin declares no settings, so there is nothing to configure.'}
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          {fields.map((field) => {
            const stored = settings[field.name]
            const shared = {
              key: field.name,
              size: 'small' as const,
              fullWidth: true,
              label: field.label,
              disabled: isDisabled,
              helperText: field.description,
            }
            if (field.type === 'boolean') {
              return (
                <Box key={field.name}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={
                          stored === undefined
                            ? Boolean(field.default)
                            : Boolean(stored)
                        }
                        disabled={isDisabled}
                        onChange={(event) =>
                          setKey(field.name, event.target.checked)
                        }
                      />
                    }
                    label={field.label}
                  />
                  {field.description ? (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block' }}
                    >
                      {field.description}
                    </Typography>
                  ) : null}
                </Box>
              )
            }
            if (field.type === 'select') {
              return (
                <TextField
                  {...shared}
                  select
                  // MUI renders an empty Select as a collapsed box without
                  // this, so "not set" would be invisible.
                  slotProps={{ inputLabel: { shrink: true } }}
                  value={String(stored ?? field.default ?? '')}
                  onChange={(event) => setKey(field.name, event.target.value)}
                >
                  <MenuItem value="">
                    {field.default !== undefined
                      ? `Default (${field.default})`
                      : 'Not set'}
                  </MenuItem>
                  {(field.options ?? []).map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label ?? option.value}
                    </MenuItem>
                  ))}
                </TextField>
              )
            }
            const inputType =
              field.type === 'number'
                ? 'number'
                : field.type === 'date'
                  ? 'datetime-local'
                  : field.type === 'color'
                    ? 'color'
                    : field.type === 'url'
                      ? 'url'
                      : 'text'
            return (
              <TextField
                {...shared}
                type={inputType}
                // The manifest's default as the placeholder, so "what happens
                // if I leave this alone" is visible without guessing.
                placeholder={
                  field.default !== undefined ? String(field.default) : undefined
                }
                slotProps={
                  field.type === 'date' || field.type === 'color'
                    ? { inputLabel: { shrink: true } }
                    : undefined
                }
                value={stored === undefined ? '' : String(stored)}
                onChange={(event) =>
                  setKey(
                    field.name,
                    field.type === 'number' && event.target.value !== ''
                      ? Number(event.target.value)
                      : event.target.value,
                  )
                }
              />
            )
          })}
        </Stack>
      )}
    </Stack>
  )
}
PluginSettingsField.displayName = 'PluginSettingsField'

export default PluginSettingsField
