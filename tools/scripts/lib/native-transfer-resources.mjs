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
 * The native screens that list what a workspace and a site can move (AGL-3671).
 *
 * The console's Imports and exports hub lists every transfer resource the
 * workspace's plugins declare (`transferResources` in `plugins.config.json`),
 * each with Export and Import, shown only for a plugin that runs and a plan
 * that carries the resource's feature. The same declarations become the
 * native lists, so a resource added to a plugin shows in the app with no
 * second edit: `generate-native-contracts.mjs` writes
 * `libs/native/screens/transfer-resources.screens.json` from this.
 */

const PACKAGE_EXPORT = 'core.settings.data.packageExport'
const PACKAGE_IMPORT = 'core.settings.data.packageImport'
const RECORDS_IMPORT = 'core.settings.data.import'

const rowOf = (resource) => ({
  key: resource.key,
  label: resource.label,
  description: resource.description ?? '',
  kind: resource.kinds.includes('package') ? 'package' : 'records',
  kindLabel: resource.kinds.includes('package') ? 'Package' : 'Records',
  imports: resource.exportOnly !== true,
  exportFree: (resource.featureFlagExempt ?? []).includes('export'),
})

/** `data.sw.rows[id='crm'].on`: the plugin runs here. */
const runs = (pluginId) => `data.sw.rows[id='${pluginId}'].on`
const entitled = (feature) => `data.ent.features.${feature}`

/** One list of resources of one plugin, one plan feature and one kind. */
function groupBlock({ group, rows, site, importWizard }) {
  const { plugin, label, feature, kind } = group
  const free = rows.some((row) => row.exportFree)
  const host = site ? { hostId: '{site.id}' } : {}
  // A resource whose export stays free on every plan says so itself (`item.exportFree`).
  const exportWhen = feature ? { when: `item.exportFree || ${entitled(feature)}` } : {}
  const importWhen = [feature ? entitled(feature) : '', 'item.imports'].filter(Boolean).join(' && ')
  const actions = []
  if (kind === 'records') {
    actions.push({
      id: 'export',
      label: 'Export',
      icon: 'arrow.down.doc|download',
      ...exportWhen,
      export: { resource: '{item.key}', title: 'Export {item.label}', ...host },
    })
    if (importWizard) {
      actions.push({
        id: 'import',
        label: 'Import',
        icon: 'square.and.arrow.down|upload',
        when: importWhen,
        navigate: { screen: RECORDS_IMPORT, params: { resource: '{item.key}', ...host } },
      })
    }
  } else {
    actions.push({
      id: 'export',
      label: 'Export',
      icon: 'arrow.down.doc|download',
      ...exportWhen,
      navigate: { screen: PACKAGE_EXPORT, params: { resource: '{item.key}' } },
    })
    actions.push({
      id: 'import',
      label: 'Import',
      icon: 'square.and.arrow.down|upload',
      ...(feature ? { when: entitled(feature) } : {}),
      navigate: { screen: PACKAGE_IMPORT },
    })
  }
  return {
    type: 'list',
    title: label,
    when: [runs(plugin), feature && !free ? entitled(feature) : ''].filter(Boolean).join(' && '),
    // A list that holds a free export keeps only what the plan lets the person do something with.
    ...(feature && free ? { filter: `item.exportFree || ${entitled(feature)}` } : {}),
    items: `const.${group.id}`,
    count: false,
    primary: '{item.label}',
    secondary: '{item.description}',
    badges: [{ text: '{item.kindLabel}' }],
    icon: kind === 'package' ? 'shippingbox|inventory_2' : 'tablecells|view_agenda',
    actions,
  }
}

/** The screens, from the plugins' declarations. */
export function transferResourcesSpec({ plugins, planLabelFor, featureKeys, importWizard = false }) {
  const groups = new Map()
  const instanced = []
  for (const plugin of plugins) {
    for (const resource of plugin.transferResources ?? []) {
      if (resource.featureFlag && !featureKeys.includes(resource.featureFlag)) {
        throw new Error(`${resource.key} names the plan feature ${resource.featureFlag}, which the entitlements do not return`)
      }
      if (resource.instances) {
        instanced.push({ plugin: plugin.id, label: plugin.catalog?.label ?? plugin.id, resource })
        continue
      }
      const kind = resource.kinds.includes('package') ? 'package' : 'records'
      const scope = resource.scope === 'host' ? 'site' : 'org'
      const key = [scope, plugin.id, resource.featureFlag ?? '', kind].join('|')
      if (!groups.has(key)) {
        groups.set(key, {
          scope,
          plugin: plugin.id,
          label: plugin.catalog?.label ?? plugin.id,
          feature: resource.featureFlag ?? null,
          kind,
          rows: [],
        })
      }
      groups.get(key).rows.push(rowOf(resource))
    }
  }

  const build = (scope) => {
    const site = scope === 'site'
    const mine = [...groups.values()].filter((group) => group.scope === scope)
    const constants = {}
    const blocks = []
    const titled = new Set()
    mine.forEach((group, index) => {
      group.id = `g${index}`
      constants[group.id] = group.rows
      const block = groupBlock({ group, rows: group.rows, site, importWizard })
      // A plugin's later lists (another plan feature) continue the first, so they carry no second title.
      const heading = `${group.plugin}|${group.kind}`
      if (titled.has(heading)) delete block.title
      else if (group.kind === 'package') block.title = `${group.label} packages`
      titled.add(heading)
      blocks.push(block)
    })
    // What a plan lacks, said once per plugin and feature: what is not included at all, and what is only
    // exported (an export that stays free on every plan).
    const missing = new Map()
    for (const group of mine) {
      if (!group.feature) continue
      const key = `${group.plugin}|${group.feature}`
      const entry = missing.get(key) ?? { plugin: group.plugin, feature: group.feature, none: [], exportOnly: [] }
      for (const row of group.rows) (row.exportFree ? entry.exportOnly : entry.none).push(row.label)
      missing.set(key, entry)
    }
    for (const entry of missing.values()) {
      const plan = planLabelFor(entry.feature)
      const from = plan ? ` Included from ${plan}.` : ''
      const sentences = [
        entry.none.length ? `${entry.none.join(', ')}: not included in your current plan.` : '',
        entry.exportOnly.length ? `${entry.exportOnly.join(', ')}: exporting stays free on every plan; importing is not included in your current plan.` : '',
      ].filter(Boolean)
      blocks.push({
        type: 'notice',
        tone: 'info',
        when: `${runs(entry.plugin)} && !${entitled(entry.feature)}`,
        text: `${sentences.join(' ')}${from}`,
      })
    }
    return { constants, blocks, mine }
  }

  const org = build('org')
  const site = build('site')

  // Datasets are moved one at a time: each dataset the workspace holds is listed under the resource.
  const dataset = instanced.find((entry) => entry.resource.key === 'data.dataset')
  const datasetBlock = dataset && {
    type: 'list',
    title: 'Dataset records',
    when: [runs(dataset.plugin), dataset.resource.featureFlag ? entitled(dataset.resource.featureFlag) : ''].filter(Boolean).join(' && '),
    items: 'data.datasets.items',
    count: false,
    primary: '{item.name|item.$id}',
    secondary: dataset.resource.description ?? '',
    badges: [{ text: 'Records' }],
    icon: 'cylinder|storage',
    empty: 'No datasets yet.',
    actions: [
      {
        id: 'export',
        label: 'Export',
        icon: 'arrow.down.doc|download',
        export: { resource: `${dataset.resource.key}:{item.$id}`, title: 'Export {item.name|item.$id}' },
      },
      ...(importWizard
        ? [
            {
              id: 'import',
              label: 'Import',
              icon: 'square.and.arrow.down|upload',
              navigate: { screen: RECORDS_IMPORT, params: { resource: `${dataset.resource.key}:{item.$id}` } },
            },
          ]
        : []),
    ],
  }

  const notice = (text) => ({ type: 'notice', tone: 'info', text })
  const siteInstanced = instanced.filter((entry) => entry.resource.scope === 'host')

  const records = {
    id: 'core.settings.data.records',
    title: 'Records and packages',
    subtitle: 'Export what each plugin keeps, or move a package',
    icon: 'tablecells|view_agenda',
    scope: 'org',
    requires: 'org.manager',
    load: {
      sw: { switchboard: 'org' },
      ent: { url: '/api/orgs/entitlements?orgId={org.id}', optional: true },
      ...(datasetBlock ? { datasets: { query: { collection: 'orgs/{org.id}/datasets', orderBy: 'name', limit: 100 }, optional: true } } : {}),
    },
    constants: org.constants,
    blocks: [
      notice(
        'Every plugin this workspace runs that keeps records or packages is listed. A site’s own records are under the site: open it and choose Imports and exports.',
      ),
      ...org.blocks,
      ...(datasetBlock ? [datasetBlock] : []),
    ],
  }

  const siteScreen = {
    id: 'core.site.data',
    title: 'Imports and exports',
    subtitle: 'Move this site’s records in and out',
    icon: 'arrow.up.arrow.down|sync',
    scope: 'site',
    group: 'site',
    order: 61,
    requires: 'org.manager',
    load: {
      sw: { switchboard: 'site' },
      ent: { url: '/api/orgs/entitlements?orgId={org.id}', optional: true },
    },
    constants: site.constants,
    blocks: [
      notice('Records of the plugins this site runs. Workspace records and packages are under Workspace settings.'),
      ...site.blocks,
      ...siteInstanced.map((entry) =>
        notice(`${entry.resource.label}: moved one at a time, from the page that holds them. ${entry.resource.description ?? ''}`.trim()),
      ),
      {
        type: 'links',
        items: [
          {
            title: 'Site package',
            subtitle: 'Its pages, emails, forms, theme and content as one file: a backup, or items for another site.',
            icon: 'externaldrive|backup',
            screen: 'core.site.backup',
          },
        ],
      },
    ],
  }

  return {
    $comment:
      'Generated by tools/scripts/generate-native-contracts.mjs from the plugins’ transferResources in plugins.config.json (AGL-3671). Do not edit.',
    screens: [records, siteScreen],
  }
}
