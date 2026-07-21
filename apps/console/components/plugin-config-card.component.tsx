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
  listPluginConfigSchemas,
  mergePluginConfig,
  validatePluginConfigValues,
  type PluginConfigField,
  type PluginConfigSchema,
} from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { doc, setDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import {
  useFirestore,
  useFirestoreDoc,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../constants/docs-links'

/**
 * Generic per-plugin settings form (AGL-428): renders every field a
 * LOADED plugin declared through `registerPluginConfigSchema`, backed by
 * `orgs/{orgId}/pluginSettings/{pluginId}`. A plugin gets a settings UI
 * without writing one — Strapi `config/plugins` parity, per workspace.
 */
function SchemaForm({
  orgId,
  schema,
  disabled,
}: {
  orgId: string
  schema: PluginConfigSchema
  disabled?: boolean
}) {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { data: stored, status } = useFirestoreDoc<Record<string, unknown>>(
    () => doc(firestore, 'orgs', orgId, 'pluginSettings', schema.pluginId),
    [firestore, orgId, schema.pluginId],
  )
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!dirty && status !== 'loading') {
      setValues(mergePluginConfig(schema, stored ?? null))
    }
    // Reset from the live doc until the user starts editing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored, status])

  const setField = (key: string, value: unknown) => {
    setDirty(true)
    setValues((current) => ({ ...current, [key]: value }))
  }

  const save = async () => {
    const verdict = validatePluginConfigValues(schema, values)
    if (!verdict.ok) {
      enqueueSnackbar(verdict.error ?? 'Invalid settings', { variant: 'error' })
      return
    }
    setBusy(true)
    try {
      await setDoc(
        doc(firestore, 'orgs', orgId, 'pluginSettings', schema.pluginId),
        { ...mergePluginConfig(schema, values), updatedBy: user?.uid ?? null },
        { merge: true },
      )
      setDirty(false)
      enqueueSnackbar('Settings saved', { variant: 'success' })
    } catch {
      enqueueSnackbar('Save failed', { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const label =
    FIRST_PARTY_PLUGINS.find((plugin) => plugin.id === schema.pluginId)
      ?.label ?? schema.pluginId

  const renderField = (field: PluginConfigField) => {
    const value = values[field.key]
    switch (field.type) {
      case 'boolean':
        return (
          <Stack
            key={field.key}
            direction="row"
            sx={{ alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Stack>
              <Typography variant="body2">{field.label}</Typography>
              {field.description ? (
                <Typography variant="caption" color="text.secondary">
                  {field.description}
                </Typography>
              ) : null}
            </Stack>
            <Switch
              checked={value === true}
              disabled={disabled || busy}
              onChange={(event) => setField(field.key, event.target.checked)}
              slotProps={{ input: { 'aria-label': field.label } }}
            />
          </Stack>
        )
      case 'select':
        return (
          <TextField
            key={field.key}
            select
            size="small"
            label={field.label}
            helperText={field.description}
            value={String(value ?? '')}
            disabled={disabled || busy}
            onChange={(event) => setField(field.key, event.target.value)}
          >
            {(field.options ?? []).map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
        )
      case 'number':
        return (
          <TextField
            key={field.key}
            type="number"
            size="small"
            label={field.label}
            helperText={field.description}
            value={value == null ? '' : Number(value)}
            disabled={disabled || busy}
            slotProps={{
              htmlInput: { min: field.min, max: field.max },
            }}
            onChange={(event) =>
              setField(field.key, Number(event.target.value))
            }
          />
        )
      default:
        return (
          <TextField
            key={field.key}
            size="small"
            label={field.label}
            helperText={field.description}
            value={String(value ?? '')}
            disabled={disabled || busy}
            onChange={(event) => setField(field.key, event.target.value)}
          />
        )
    }
  }

  return (
    <CardDisplay
      header={`${label} settings`}
      help={docsHelp('plugins', {
        anchor: '#configure',
        excerpt:
          'Settings this plugin exposes for your workspace — saved per ' +
          'organization and read by the plugin wherever it runs.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2} sx={{ maxWidth: 480 }}>
        {schema.fields.map(renderField)}
        <Stack direction="row">
          <Button
            variant="contained"
            size="small"
            disabled={disabled || !dirty || busy}
            onClick={() => void save()}
          >
            {'Save settings'}
          </Button>
        </Stack>
      </Stack>
    </CardDisplay>
  )
}

export default function PluginConfigCards({
  orgId,
  disabled,
}: {
  orgId: string
  disabled?: boolean
}) {
  const schemas = listPluginConfigSchemas()
  if (!schemas.length) return null
  return (
    <>
      {schemas.map((schema) => (
        <SchemaForm
          key={schema.pluginId}
          orgId={orgId}
          schema={schema}
          disabled={disabled}
        />
      ))}
    </>
  )
}
