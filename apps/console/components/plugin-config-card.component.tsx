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
  pluginConfigOverrides,
  resolvePluginConfig,
  validatePluginConfigValues,
  type PluginConfigField,
  type PluginConfigSchema,
} from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Chip,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { deleteField, doc, setDoc } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import {
  useFirestore,
  useFirestoreDoc,
  useUser,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../constants/docs-links'

/**
 * Generic per-plugin settings form (AGL-428), at either scope.
 *
 * It renders every field a LOADED plugin declared through
 * `registerPluginConfigSchema`, so a plugin gets a settings UI without
 * writing one — Strapi `config/plugins` parity. Without a `hostId` it is the
 * WORKSPACE form, backed by `orgs/{orgId}/pluginSettings/{pluginId}`. With
 * one it is the SITE form, backed by `hosts/{hostId}/pluginSettings/
 * {pluginId}`, which holds only the keys that site answers for itself and
 * inherits the rest.
 *
 * ONE component for both scopes deliberately. The two forms share their
 * coercion, their cross-field validation and their seed guard; a second copy
 * would be a second set of those, and the copy that drifted would be the one
 * nobody was looking at.
 */
function SchemaForm({
  orgId,
  hostId,
  schema,
  disabled,
}: {
  orgId: string
  hostId?: string
  schema: PluginConfigSchema
  disabled?: boolean
}) {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const siteScoped = Boolean(hostId)
  /**
   * Held at null until the scope is known, never addressed as
   * `orgs/-pending-` or `hosts/-pending-` (AGL-1440). `pluginSettings` is
   * member-gated at both scopes, so a sentinel id is a guaranteed permission
   * denial on every mount rather than a read that might succeed.
   */
  const {
    data: orgStored,
    status: orgStatus,
    fromCache: orgFromCache,
  } = useFirestoreDoc<Record<string, unknown>>(
    () =>
      orgId
        ? doc(firestore, 'orgs', orgId, 'pluginSettings', schema.pluginId)
        : null,
    [firestore, orgId, schema.pluginId],
  )
  const {
    data: hostStored,
    status: hostStatus,
    fromCache: hostFromCache,
  } = useFirestoreDoc<Record<string, unknown>>(
    () =>
      hostId
        ? doc(firestore, 'hosts', hostId, 'pluginSettings', schema.pluginId)
        : null,
    [firestore, hostId, schema.pluginId],
  )
  const [values, setValues] = useState<Record<string, unknown>>({})
  /**
   * The keys this SITE is answering for itself, as the form currently stands
   * — the local counterpart of `pluginConfigOverrides` over the stored
   * document. Empty and unused at workspace scope, where every key is an
   * answer by definition.
   */
  const [overridden, setOverridden] = useState<string[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)

  /** What the workspace answers, which is what an inherited field follows. */
  const workspace = useMemo(
    () => mergePluginConfig(schema, orgStored ?? null),
    [schema, orgStored],
  )
  /** The keys the STORED site document overrides, i.e. what a save must clear. */
  const storedOverrides = useMemo(
    () => (siteScoped ? pluginConfigOverrides(schema, hostStored ?? null) : []),
    [siteScoped, schema, hostStored],
  )

  const settled =
    orgStatus !== 'loading' && (!siteScoped || hostStatus !== 'loading')

  useEffect(() => {
    if (dirty || !settled) return
    // Reset from the live docs until the user starts editing.
    setValues(
      siteScoped
        ? resolvePluginConfig(schema, {
            org: orgStored ?? null,
            host: hostStored ?? null,
          })
        : mergePluginConfig(schema, orgStored ?? null),
    )
    setOverridden(storedOverrides)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgStored, hostStored, settled])

  /**
   * Editing a field at site scope IS overriding it. A separate "override
   * this" switch would let a site hold a typed value that is not in force,
   * which is the state the whole card exists to make unambiguous.
   */
  const setField = (key: string, value: unknown) => {
    setDirty(true)
    setValues((current) => ({ ...current, [key]: value }))
    if (siteScoped) {
      setOverridden((current) =>
        current.includes(key) ? current : [...current, key],
      )
    }
  }

  /** The one action back to following the workspace. */
  const inherit = (key: string) => {
    setDirty(true)
    setOverridden((current) => current.filter((item) => item !== key))
    setValues((current) => ({ ...current, [key]: workspace[key] }))
  }

  const save = async () => {
    /**
     * Validated against what the site will RUN with, not against the
     * overrides alone. A cross-field rule (`schema.validate`) is a statement
     * about the effective config, so checking a partial document would pass
     * a site whose one override contradicts an inherited neighbor.
     */
    const effective = siteScoped
      ? { ...workspace, ...pick(values, overridden) }
      : values
    const valid = validatePluginConfigValues(schema, effective)
    if (!valid.ok) {
      enqueueSnackbar(valid.error ?? 'Invalid settings', { variant: 'error' })
      return
    }
    setBusy(true)
    try {
      /**
       * Never write settings seeded from a read we cannot trust (AGL-1066,
       * AGL-1358, AGL-1449).
       *
       * The workspace form is seeded from `orgStored` and carries the WHOLE
       * config object, not the one field that changed — `merge: true`
       * protects nothing there, because every untouched key is in the
       * payload, so a save against a bad seed rewrites every other setting to
       * whatever that seed held.
       *
       * The site form is narrower but seeded the same way twice over: every
       * key it still calls an override is written from that seed, and the
       * keys it clears are the keys the seed said were stored. A cached seed
       * therefore both restores a stale value another admin has since changed
       * and leaves a newer override it never saw.
       *
       * This used to be two inline `if`s, and that is exactly why it needed
       * fixing (AGL-1449): they covered `fromCache` and the session heuristic
       * and had nothing for `unreadable`, so a listen that went terminal —
       * where `useFirestoreDoc` clears `data` and this form re-seeds from
       * `mergePluginConfig(schema, null)`, i.e. every field at its SCHEMA
       * DEFAULT — sailed straight through and reset the stored document to
       * defaults while reporting "Settings saved". A hand-rolled guard only
       * ever holds the conditions whoever wrote it thought of.
       *
       * The guard WRAPS the write for the same reason: an early return is a
       * shape you can keep while losing the protection.
       */
      const verdict = await writeGuardedBySeed(
        {
          subject: siteScoped ? 'site plugin settings' : 'plugin settings',
          unreadable:
            orgStatus === 'error' || (siteScoped && hostStatus === 'error'),
          fromCache: orgFromCache || (siteScoped && hostFromCache),
        },
        async () => {
          if (!siteScoped) {
            await setDoc(
              doc(firestore, 'orgs', orgId, 'pluginSettings', schema.pluginId),
              {
                ...mergePluginConfig(schema, values),
                updatedBy: user?.uid ?? null,
              },
              { merge: true },
            )
            return
          }
          /**
           * ⚠️ CLEARING AN OVERRIDE IS A FIELD DELETE, NEVER AN EMPTY VALUE.
           *
           * `setDoc(…, {merge: true})` leaves a field the payload omits
           * exactly as it is, so a form that simply stops sending a key
           * cannot clear anything by saving: the override survives
           * invisibly, and the site keeps ignoring a workspace value that
           * has since changed. `deleteField()` is the only write that
           * returns a key to inherited — the same trap, and the same fix, as
           * the host tracking ids (AGL-1608).
           *
           * The key is written LITERALLY, which is correct here and is the
           * half of that fix worth restating: `setDoc` with `merge` treats a
           * dotted key as a literal field name and only `updateDoc` reads it
           * as a path. A nested `deleteField()` would have to be buried in a
           * nested object — but nothing is nested at this path.
           * `mergePluginConfig` and `pluginConfigOverrides` both address the
           * stored document as `stored[field.key]`, so the document is flat
           * by construction and the delete has to address it the same way the
           * readers do. `updateDoc` is not an option either way: a site with
           * no overrides yet has no document, and `updateDoc` refuses a
           * missing one.
           */
          const coerced = mergePluginConfig(schema, effective)
          const payload: Record<string, unknown> = {
            updatedBy: user?.uid ?? null,
          }
          for (const field of schema.fields) {
            if (overridden.includes(field.key)) {
              payload[field.key] = coerced[field.key]
            } else if (storedOverrides.includes(field.key)) {
              payload[field.key] = deleteField()
            }
          }
          await setDoc(
            doc(firestore, 'hosts', hostId, 'pluginSettings', schema.pluginId),
            payload,
            { merge: true },
          )
        },
      )
      if (!verdict.ok) {
        // `dirty` stays true and the fields keep what was typed, so the user
        // can retry rather than discover later that nothing was stored.
        return void enqueueSnackbar(verdict.message, { variant: 'warning' })
      }
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

  const control = (field: PluginConfigField) => {
    const value = values[field.key]
    switch (field.type) {
      case 'boolean':
        return (
          <Stack
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
            type="number"
            size="small"
            label={field.label}
            helperText={field.description}
            value={value == null ? '' : Number(value)}
            disabled={disabled || busy}
            slotProps={{
              htmlInput: { min: field.min, max: field.max },
            }}
            onChange={(event) => setField(field.key, Number(event.target.value))}
          />
        )
      default:
        return (
          <TextField
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

  /**
   * Where this field's answer comes from, said on the field itself.
   *
   * Both halves are load-bearing. The chip says whether the site is following
   * the workspace, and the workspace's own value is spelled out beside it —
   * without it, "inherited" tells an operator that a number exists somewhere
   * else but not what it is, and deciding whether to override means leaving
   * the page.
   */
  const provenance = (field: PluginConfigField) => {
    const isOverridden = overridden.includes(field.key)
    return (
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
      >
        <Chip
          size="small"
          color={isOverridden ? 'primary' : 'default'}
          variant={isOverridden ? 'filled' : 'outlined'}
          label={isOverridden ? 'Set for this site' : 'Inherited'}
        />
        <Typography variant="caption" color="text.secondary">
          {`Workspace: ${describeValue(field, workspace[field.key])}`}
        </Typography>
        {isOverridden ? (
          <Button
            size="small"
            disabled={disabled || busy}
            onClick={() => inherit(field.key)}
          >
            {'Use workspace value'}
          </Button>
        ) : null}
      </Stack>
    )
  }

  return (
    <CardDisplay
      header={`${label} settings`}
      help={docsHelp('plugins', {
        anchor: '#configure',
        excerpt: siteScoped
          ? 'Settings this plugin exposes for this site — each one either ' +
            'follows the workspace or is answered here for this site alone.'
          : 'Settings this plugin exposes for your workspace — saved per ' +
            'organization and read by the plugin wherever it runs.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2} sx={{ maxWidth: 480 }}>
        {siteScoped ? (
          <Typography variant="body2" color="text.secondary">
            {'This site follows the workspace until you answer a field here. ' +
              'A field you change applies to this site only; the rest keep ' +
              'following the workspace, including changes made there later.'}
          </Typography>
        ) : null}
        {schema.fields.map((field) => (
          <Stack key={field.key} spacing={1}>
            {control(field)}
            {siteScoped ? provenance(field) : null}
          </Stack>
        ))}
        <Stack direction="row">
          <Button
            variant="contained"
            size="small"
            disabled={disabled || !dirty || busy}
            onClick={() => void save()}
          >
            {siteScoped ? 'Save site settings' : 'Save settings'}
          </Button>
        </Stack>
      </Stack>
    </CardDisplay>
  )
}

/** The subset of `values` named by `keys`, in schema-agnostic form. */
function pick(
  values: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const picked: Record<string, unknown> = {}
  for (const key of keys) picked[key] = values[key]
  return picked
}

/**
 * A field value as an operator reads it. `select` resolves to its option
 * label rather than its stored value, and an empty string reads as "Not set"
 * — an inheritance line that renders as `Workspace: ` says nothing at all.
 */
function describeValue(field: PluginConfigField, value: unknown): string {
  if (field.type === 'boolean') return value === true ? 'On' : 'Off'
  if (field.type === 'select') {
    const option = field.options?.find((entry) => entry.value === value)
    if (option) return option.label
  }
  if (value == null || value === '') return 'Not set'
  return String(value)
}

export default function PluginConfigCards({
  orgId,
  hostId,
  disabled,
  pluginId,
}: {
  orgId: string
  /**
   * Render the SITE form for this host instead of the workspace one
   * (AGL-428, AGL-1014). The site's stored document holds only the keys it
   * answers for itself, and every other field follows the workspace.
   */
  hostId?: string
  disabled?: boolean
  /**
   * Render only this plugin's settings (AGL-1007). The installation detail
   * page is about one plugin, and its settings are the reason that page
   * exists — without this it would have to re-implement the schema form
   * rather than show the one every plugin already gets for free.
   */
  pluginId?: string
}) {
  const schemas = listPluginConfigSchemas().filter(
    (schema) => !pluginId || schema.pluginId === pluginId,
  )
  if (!schemas.length) return null
  return (
    <>
      {schemas.map((schema) => (
        <SchemaForm
          key={schema.pluginId}
          orgId={orgId}
          hostId={hostId}
          schema={schema}
          disabled={disabled}
        />
      ))}
    </>
  )
}
