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

/**
 * The schema's pre-save check (the console's `validate`) as the apps replay it: a form's `refuse` entry naming a check
 * both kits implement (`PluginSettingsChecks`), asked over the values the form will save, or on a site over the values
 * it will RUN with (its own override where it has one, else the workspace's, else the default). The console's own
 * answers to `checkInputs` are recorded beside the spec (`checkCases`), and both kits replay them, so a rule or a word
 * the console changes fails the apps' tests rather than drifting.
 */
export function checkRefusal(check, { site = false } = {}) {
  return site ? [{ check, site: true }] : [{ check }]
}

/** The console's answers to each `check`'s inputs: `{ [check]: [{ values, result }] }`. */
export function checkCases(entries) {
  const out = {}
  for (const { schema, check, checkInputs = [] } of entries) {
    if (!check) continue
    if (!schema.validate) throw new Error(`${schema.pluginId}: names check ${check} but its schema has no validate`)
    if (!checkInputs.length) throw new Error(`${schema.pluginId}: check ${check} has no inputs to record`)
    const cases = checkInputs.map((values) => ({ values, result: schema.validate(values) ?? null }))
    if (!cases.some(({ result }) => result)) throw new Error(`${schema.pluginId}: validate refuses none of its inputs`)
    out[check] = cases
  }
  return out
}

/**
 * One schema as a native screen spec. `checking` names what the form's Save holds on while the device cache alone has
 * answered ("Checking your plugin settings with the server…"); the spec file passes it, and a marketplace plugin's
 * run-time screen (`manifestSettingsScreen`) is this screen without it.
 */
export function pluginSettingsScreen({ schema, label, checking, check }) {
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
    // A key or code is kept as typed: the apps' keyboards neither capitalize nor correct it, as the console's input.
    if (field.verbatim) out.verbatim = true
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
    requires: 'org.can[org.settings]',
    constants: { defaults: schema.defaults },
    load: { settings: { doc: `orgs/{org.id}/pluginSettings/${id}`, optional: true } },
    blocks: [
      // The schema's notice, as the console's card draws it above the fields (an info alert).
      ...noticeBlocks(schema),
      {
        type: 'form',
        ...(checking ? { checking } : {}),
        id: 'settings',
        object: 'data.settings',
        footer: 'A site can override these on its own plugin page.',
        fields,
        ...(check ? { refuse: checkRefusal(check) } : {}),
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
export function sitePluginSettingsScreen({ schema, label, check }) {
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
    if (field.verbatim) control.verbatim = true
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
    requires: `site.can[site.manage] && params.pluginId == ${id}`,
    constants: { defaults: schema.defaults },
    load: {
      org: { doc: `orgs/{org.id}/pluginSettings/${id}`, optional: true },
      site: { doc: `hosts/{site.id}/pluginSettings/${id}`, optional: true },
    },
    blocks: [
      // The schema's notice, as the console's card draws it above the fields (an info alert).
      ...noticeBlocks(schema),
      {
        type: 'form',
        checking: 'site plugin settings',
        id: 'settings',
        footer: 'A field you do not override follows the workspace value.',
        fields,
        ...(check ? { refuse: checkRefusal(check, { site: true }) } : {}),
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

/** The schema's `notice` as an info notice block, or none. */
function noticeBlocks(schema) {
  return schema.notice ? [{ type: 'notice', tone: 'info', text: schema.notice }] : []
}

/** The spec file: a workspace screen and a site screen per schema, in plugin order. */
export function pluginSettingsSpec(entries) {
  return (
    JSON.stringify(
      {
        $comment:
          "Generated by tools/scripts/generate-native-contracts.mjs from each plugin's PluginConfigSchema (AGL-3671). Do not edit: the schema is the console's own.",
        screens: entries.flatMap((entry) => [
          pluginSettingsScreen({ ...entry, checking: 'plugin settings' }),
          sitePluginSettingsScreen(entry),
        ]),
      },
      null,
      2,
    ) + '\n'
  )
}
