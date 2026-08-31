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

/**
 * Per-plugin configuration (AGL-428) — Strapi `config` parity. A plugin
 * DECLARES its settings schema (fields + defaults + validation) at module
 * scope; the org stores overrides in `orgs/{orgId}/pluginSettings/
 * {pluginId}`; every consumer reads the DEFAULTS-MERGED view:
 *
 * - server handlers via `getPluginConfig(orgId, pluginId)`
 *   (tenant-data-admin);
 * - client surfaces via `usePluginConfig(orgId, pluginId)`
 *   (tenant-feature-instance);
 * - the console's Plugins & add-ons hub renders a generic settings form
 *   from the schema, so a plugin gets a settings UI without writing one.
 *
 * Register at MODULE SCOPE in a file imported by both the client barrel
 * and the `/server` entry, so whichever surface loads first the schema is
 * there. Values are coerced defensively on merge — the settings doc is
 * client-writable (org managers), so readers never trust its types.
 */

export interface PluginConfigField {
  key: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'select'
  description?: string
  /** For `select` fields. */
  options?: Array<{ value: string; label: string }>
  /** For `number` fields. */
  min?: number
  max?: number
}

export interface PluginConfigSchema {
  pluginId: string
  fields: PluginConfigField[]
  defaults: Record<string, unknown>
  /** Cross-field validation; returns an error message or null. */
  validate?: (values: Record<string, unknown>) => string | null
}

const schemas = new Map<string, PluginConfigSchema>()

/** Idempotent by pluginId — re-registration replaces the schema. */
export function registerPluginConfigSchema(schema: PluginConfigSchema): void {
  schemas.set(schema.pluginId, schema)
}

export function getPluginConfigSchema(
  pluginId: string,
): PluginConfigSchema | undefined {
  return schemas.get(pluginId)
}

export function listPluginConfigSchemas(): PluginConfigSchema[] {
  return [...schemas.values()]
}

const coerce = (
  field: PluginConfigField,
  raw: unknown,
  fallback: unknown,
): unknown => {
  switch (field.type) {
    case 'boolean':
      return typeof raw === 'boolean' ? raw : fallback
    case 'number': {
      const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : NaN
      if (Number.isNaN(value)) return fallback
      if (field.min != null && value < field.min) return field.min
      if (field.max != null && value > field.max) return field.max
      return value
    }
    case 'select': {
      const value = typeof raw === 'string' ? raw : undefined
      return field.options?.some((option) => option.value === value)
        ? value
        : fallback
    }
    default:
      return typeof raw === 'string' ? raw : fallback
  }
}

/**
 * The defaults-merged, type-coerced config view. Safe against a missing
 * or junk settings doc — unknown keys are dropped, wrong-typed values
 * fall back to the declared default.
 */
export function mergePluginConfig(
  schema: PluginConfigSchema,
  stored: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...schema.defaults }
  if (!stored) return merged
  for (const field of schema.fields) {
    if (field.key in stored) {
      merged[field.key] = coerce(
        field,
        stored[field.key],
        schema.defaults[field.key],
      )
    }
  }
  return merged
}

/** Pre-save validation for the settings UI (coerce + custom validate). */
export function validatePluginConfigValues(
  schema: PluginConfigSchema,
  values: Record<string, unknown>,
): { ok: boolean; error?: string } {
  const merged = mergePluginConfig(schema, values)
  const error = schema.validate?.(merged) ?? null
  return error ? { ok: false, error } : { ok: true }
}

const MANIFEST_CONFIG_FIELD_LIMIT = 50
const FIELD_TYPES: ReadonlySet<string> = new Set([
  'string',
  'number',
  'boolean',
  'select',
])

/**
 * A plugin's declared fields, read from its MANIFEST rather than the registry
 * (AGL-428).
 *
 * The registry is a module-scope map, filled by `registerPluginConfigSchema`
 * at import time. A marketplace plugin cannot fill it: its bundle runs in a
 * sandboxed frame on a separate origin and never executes in the console
 * process, so there is no moment at which its registration could happen. The
 * settings form therefore rendered NOTHING for every plugin a workspace
 * installed, and `resolvePluginConfig` — which is entirely plugin-agnostic and
 * would have layered a third-party plugin's org default under a per-site
 * override without changing a line — was never reached for one.
 *
 * The manifest is denormalized onto every install pin, so it is the one
 * declaration of a marketplace plugin the console already holds.
 *
 * Everything here is re-validated rather than trusted. The manifest is
 * publisher-authored, it is stored on a client-readable document, and a form
 * built from it is a form an org manager saves through — so a junk `type`
 * drops the field rather than rendering an unknown control, and the field
 * count is capped so one manifest cannot turn a settings page into thousands
 * of inputs. Being reviewed once is not the same as being safe to render
 * verbatim forever.
 *
 * Returns `undefined` when the manifest declares nothing usable, which callers
 * must treat as "this plugin has no settings" rather than as an error: most
 * plugins take none.
 */
export function pluginConfigSchemaFromManifest(
  pluginId: string,
  manifest: unknown,
): PluginConfigSchema | undefined {
  if (!pluginId) return undefined
  const declared = (manifest as { config?: unknown } | null | undefined)?.config
  const rawFields = (declared as { fields?: unknown } | undefined)?.fields
  if (!Array.isArray(rawFields)) return undefined
  const seen = new Set<string>()
  const fields: PluginConfigField[] = []
  for (const raw of rawFields) {
    if (fields.length >= MANIFEST_CONFIG_FIELD_LIMIT) break
    const entry = raw as Record<string, unknown> | null
    const key = typeof entry?.['key'] === 'string' ? entry['key'].trim() : ''
    // A duplicate key would give two controls one storage slot, so the second
    // is dropped rather than allowed to shadow the first.
    if (!key || seen.has(key)) continue
    const type = String(entry?.['type'] ?? 'string')
    if (!FIELD_TYPES.has(type)) continue
    const options = Array.isArray(entry?.['options'])
      ? (entry['options'] as unknown[])
          .map((option) => option as Record<string, unknown> | null)
          .filter(
            (option) =>
              typeof option?.['value'] === 'string' &&
              typeof option?.['label'] === 'string',
          )
          .map((option) => ({
            value: String(option?.['value']),
            label: String(option?.['label']),
          }))
      : undefined
    // A `select` with nothing to select is a dropdown that cannot be answered,
    // so it is dropped rather than rendered empty.
    if (type === 'select' && !options?.length) continue
    seen.add(key)
    fields.push({
      key,
      label:
        typeof entry?.['label'] === 'string' && entry['label'].trim()
          ? String(entry['label']).slice(0, 120)
          : key,
      type: type as PluginConfigField['type'],
      description:
        typeof entry?.['description'] === 'string'
          ? String(entry['description']).slice(0, 400)
          : undefined,
      options,
      min: typeof entry?.['min'] === 'number' ? entry['min'] : undefined,
      max: typeof entry?.['max'] === 'number' ? entry['max'] : undefined,
    })
  }
  if (!fields.length) return undefined
  const rawDefaults = (declared as { defaults?: unknown } | undefined)?.defaults
  const defaults: Record<string, unknown> = {}
  for (const field of fields) {
    // Defaults are coerced through the same path stored values take, so a
    // manifest default of the wrong type cannot become the value a site
    // inherits. An absent one falls back to the type's empty value rather than
    // `undefined`, which `pluginConfigOverrides` reads as "not answered".
    const supplied =
      rawDefaults && typeof rawDefaults === 'object'
        ? (rawDefaults as Record<string, unknown>)[field.key]
        : undefined
    const empty =
      field.type === 'boolean'
        ? false
        : field.type === 'number'
          ? (field.min ?? 0)
          : field.type === 'select'
            ? (field.options?.[0]?.value ?? '')
            : ''
    defaults[field.key] = coerce(field, supplied, empty)
  }
  return { pluginId, fields, defaults }
}

/**
 * The three levels a plugin setting can be answered at.
 *
 * A workspace sets a value once and every site it enabled the plugin on
 * follows it; a site that needs a different answer overrides that one field
 * and keeps inheriting the rest. Bookings is the shape this is for — one
 * booking horizon across a chain, with the flagship branch taking bookings
 * further out — and it generalizes to every plugin because none of them get
 * to invent their own inheritance.
 */
export interface PluginConfigSources {
  /** `orgs/{orgId}/pluginSettings/{pluginId}` — the workspace's answer. */
  org?: Record<string, unknown> | null
  /** `hosts/{hostId}/pluginSettings/{pluginId}` — only the keys this site overrides. */
  host?: Record<string, unknown> | null
}

/**
 * Which keys a site is answering for itself.
 *
 * A key is an override when it is PRESENT on the host document, and inherited
 * when it is absent. `undefined` counts as absent, deliberately: a UI that
 * writes `{key: undefined}` to mean "stop overriding" is doing the same thing
 * as one that never wrote the key, and treating the two differently would make
 * "revert to the workspace value" depend on which code path cleared it.
 *
 * ⚠️ Which is also why clearing an override must DELETE the key rather than
 * write an empty value. `setDoc(..., {merge: true})` leaves an existing field
 * exactly as it is when the new object omits it, so a form that drops empty
 * inputs cannot clear anything by saving — the override survives, invisibly,
 * and the site keeps ignoring a workspace value the operator has since
 * changed. Deleting is the only write that returns a field to inherited.
 *
 * Keys the schema does not declare are ignored, so a stale field left behind
 * by a plugin update does not read as an override of a setting that no longer
 * exists.
 */
export function pluginConfigOverrides(
  schema: PluginConfigSchema,
  host: Record<string, unknown> | null | undefined,
): string[] {
  if (!host) return []
  return schema.fields
    .filter((field) => field.key in host && host[field.key] !== undefined)
    .map((field) => field.key)
}

/**
 * What a plugin actually runs with on one site.
 *
 * Schema defaults, then the workspace's stored values, then only the keys the
 * site overrides — each layer narrowing the one before it. Type coercion
 * happens once at the end rather than per level, so a site override of the
 * wrong type falls back to the WORKSPACE value it was trying to replace
 * instead of skipping past it to the schema default. Getting that backwards
 * would have one malformed site setting silently discard a workspace answer
 * the operator can see in their own console.
 */
export function resolvePluginConfig(
  schema: PluginConfigSchema,
  sources: PluginConfigSources,
): Record<string, unknown> {
  const org = mergePluginConfig(schema, sources.org)
  const overrides = pluginConfigOverrides(schema, sources.host)
  if (!overrides.length) return org
  const host = sources.host as Record<string, unknown>
  const merged: Record<string, unknown> = { ...org }
  for (const field of schema.fields) {
    if (!overrides.includes(field.key)) continue
    merged[field.key] = coerce(field, host[field.key], org[field.key])
  }
  return merged
}
