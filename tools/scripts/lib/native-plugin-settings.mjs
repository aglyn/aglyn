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
 * The native screens for a plugin's workspace settings (AGL-3671).
 *
 * The console draws `PluginConfigCards` from each plugin's `PluginConfigSchema`
 * and saves them to `orgs/{org}/pluginSettings/{plugin}`. The same schemas
 * become one native screen each, so the app's fields, options and defaults are
 * the console's and cannot drift: `generate-native-contracts.mjs` writes
 * `libs/native/screens/plugin-settings.screens.json` from this.
 */

const KIND = { string: 'text', number: 'number', boolean: 'toggle', select: 'select' }

/** The help line a field shows: its description, then the band a number sits in. */
function helpFor(field) {
  const band =
    field.type === 'number' && (field.min != null || field.max != null)
      ? `Between ${field.min ?? 'any'} and ${field.max ?? 'any'}.`
      : ''
  return [field.description, band].filter(Boolean).join(' ') || undefined
}

/** One schema as a native screen spec. */
export function pluginSettingsScreen({ schema, label }) {
  const id = schema.pluginId
  const fields = schema.fields.map((field) => {
    const out = {
      key: field.key,
      label: field.label,
      kind: KIND[field.type] ?? 'text',
      // `??` keeps a stored false or 0, which `|` would skip for the default.
      initial: `{item.${field.key} ?? const.defaults.${field.key}}`,
    }
    if (field.type === 'select') out.options = (field.options ?? []).map(({ value, label: text }) => ({ value, label: text }))
    const help = helpFor(field)
    if (help) out.help = help
    return out
  })
  const written = Object.fromEntries(schema.fields.map((field) => [field.key, `{form.${field.key}}`]))
  return {
    id: `core.pluginSettings.${id}`,
    title: `${label} settings`,
    subtitle: `How ${label} behaves for this workspace`,
    icon: 'gearshape|settings',
    scope: 'org',
    requires: 'org.manager',
    constants: { defaults: schema.defaults },
    load: { settings: { doc: `orgs/{org.id}/pluginSettings/${id}`, optional: true } },
    blocks: [
      {
        type: 'form',
        id: 'settings',
        object: 'data.settings',
        footer: 'A site can override these on its own plugin page.',
        fields,
        submit: {
          label: 'Save settings',
          write: { doc: `orgs/{org.id}/pluginSettings/${id}`, fields: { ...written, updatedBy: '{user.uid}' } },
          success: 'Settings saved',
        },
      },
    ],
  }
}

/**
 * A schema as the site's screen: the console's `SchemaForm` with a `hostId`. Editing a field at site
 * scope IS overriding it, so each field carries an "Override for this site" switch (on when the site's
 * own document holds the key); a save writes the overridden fields and removes the rest, and the site's
 * pages are republished when the schema says its fields shape them.
 */
export function sitePluginSettingsScreen({ schema, label }) {
  const id = schema.pluginId
  const fields = []
  const written = { updatedBy: '{user.uid}' }
  for (const field of schema.fields) {
    fields.push({
      key: `ov_${field.key}`,
      label: `Override ${field.label} for this site`,
      kind: 'toggle',
      initial: `{data.site.${field.key}:present}`,
    })
    const control = {
      key: field.key,
      label: field.label,
      kind: KIND[field.type] ?? 'text',
      initial: `{data.site.${field.key} ?? data.org.${field.key} ?? const.defaults.${field.key}}`,
      when: `form.ov_${field.key}`,
    }
    if (field.type === 'select') control.options = (field.options ?? []).map(({ value, label: text }) => ({ value, label: text }))
    const help = helpFor(field)
    if (help) control.help = help
    fields.push(control)
    written[field.key] = { $if: `form.ov_${field.key}`, then: `{form.${field.key}}`, else: { $delete: true } }
  }
  return {
    id: `core.sitePluginSettings.${id}`,
    title: `${label} settings for this site`,
    label: 'Settings for this site',
    subtitle: 'Override a workspace value on this site',
    icon: 'gearshape|settings',
    scope: 'site',
    zones: ['sitePluginSettings'],
    requires: `org.manager && params.pluginId == ${id}`,
    constants: { defaults: schema.defaults },
    load: {
      org: { doc: `orgs/{org.id}/pluginSettings/${id}`, optional: true },
      site: { doc: `hosts/{site.id}/pluginSettings/${id}`, optional: true },
    },
    blocks: [
      {
        type: 'form',
        id: 'settings',
        footer: 'A field you do not override follows the workspace value.',
        fields,
        submit: {
          label: 'Save settings',
          write: { doc: `hosts/{site.id}/pluginSettings/${id}`, fields: written },
          ...(schema.affectsPublishedPages ? { siteWide: true } : {}),
          success: 'Settings saved',
        },
      },
    ],
  }
}

/** The spec file: a workspace screen and a site screen per schema, in plugin order. */
export function pluginSettingsSpec(entries) {
  return (
    JSON.stringify(
      {
        $comment:
          "Generated by tools/scripts/generate-native-contracts.mjs from each plugin's PluginConfigSchema (AGL-3671). Do not edit: the schema is the console's own.",
        screens: entries.flatMap((entry) => [pluginSettingsScreen(entry), sitePluginSettingsScreen(entry)]),
      },
      null,
      2,
    ) + '\n'
  )
}
