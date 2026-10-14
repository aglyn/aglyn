import assert from 'node:assert/strict'
import { test } from 'node:test'

import { transferResourcesSpec } from './native-transfer-resources.mjs'

const plugins = [
  {
    id: 'crm',
    catalog: { label: 'CRM' },
    transferResources: [
      { key: 'crm.contacts', label: 'Contacts', scope: 'org', kinds: ['records'], featureFlag: 'crm', featureFlagExempt: ['export'] },
      { key: 'crm.deals', label: 'Deals', scope: 'org', kinds: ['records'], featureFlag: 'crm' },
      { key: 'crm.email-templates', label: 'Email templates', scope: 'org', kinds: ['package'], featureFlag: 'crm' },
    ],
  },
  {
    id: 'redirects',
    catalog: { label: 'Redirects' },
    transferResources: [{ key: 'redirects', label: 'Redirects', scope: 'host', kinds: ['records'], featureFlag: 'redirects' }],
  },
  {
    id: 'data',
    catalog: { label: 'Data' },
    transferResources: [
      { key: 'data.dataset', label: 'Dataset records', scope: 'org', kinds: ['records'], featureFlag: 'dataStore', instances: true },
    ],
  },
  {
    id: 'forms',
    catalog: { label: 'Forms' },
    transferResources: [{ key: 'forms.submissions', label: 'Form submissions', scope: 'host', kinds: ['records'], exportOnly: true }],
  },
]

const spec = (importWizard) =>
  transferResourcesSpec({
    plugins,
    planLabelFor: (feature) => (feature === 'crm' ? 'Starter' : undefined),
    featureKeys: ['crm', 'redirects', 'dataStore'],
    importWizard,
  })

const screen = (built, id) => built.screens.find((one) => one.id === id)

test('a workspace resource shows only while its plugin runs and its plan carries it', () => {
  const records = screen(spec(false), 'core.settings.data.records')
  const lists = records.blocks.filter((block) => block.type === 'list')
  const crm = lists.find((block) => block.title === 'CRM')
  assert.equal(crm.when, "data.sw.rows[id='crm'].on")
  // A resource whose export stays free keeps the list on any plan, and the list keeps only what the plan allows.
  assert.equal(crm.filter, 'item.exportFree || data.ent.features.crm')
  assert.deepEqual(records.constants[crm.items.replace('const.', '')].map((row) => row.key), ['crm.contacts', 'crm.deals'])
  const packages = lists.find((block) => block.title === 'CRM packages')
  assert.equal(packages.when, "data.sw.rows[id='crm'].on && data.ent.features.crm")
})

test('what the plan lacks is said once, with the plan that has it', () => {
  const notices = screen(spec(false), 'core.settings.data.records').blocks.filter((block) => block.type === 'notice' && block.when)
  assert.equal(notices.length, 1)
  assert.equal(notices[0].when, "data.sw.rows[id='crm'].on && !data.ent.features.crm")
  assert.match(notices[0].text, /Deals, Email templates: not included in your current plan\./)
  assert.match(notices[0].text, /Contacts: exporting stays free on every plan; importing is not included/)
  assert.match(notices[0].text, /Included from Starter\.$/)
})

test('a records resource exports through the platform sheet; a package opens the package screens', () => {
  const records = screen(spec(false), 'core.settings.data.records')
  const [exportAction] = records.blocks.find((block) => block.title === 'CRM').actions
  assert.deepEqual(exportAction.export, { resource: '{item.key}', title: 'Export {item.label}' })
  const packageActions = records.blocks.find((block) => block.title === 'CRM packages').actions
  assert.deepEqual(packageActions.map((action) => action.navigate.screen), [
    'core.settings.data.packageExport',
    'core.settings.data.packageImport',
  ])
  assert.deepEqual(packageActions[0].navigate.params, { resource: '{item.key}' })
})

test('the import button waits for the wizard and never shows for an export-only resource', () => {
  const without = screen(spec(false), 'core.settings.data.records').blocks.find((block) => block.title === 'CRM')
  assert.deepEqual(without.actions.map((action) => action.id), ['export'])
  const wizard = screen(spec(true), 'core.settings.data.records').blocks.find((block) => block.title === 'CRM')
  const open = wizard.actions.find((action) => action.id === 'import')
  assert.equal(open.when, 'data.ent.features.crm && item.imports')
  assert.deepEqual(open.navigate, { screen: 'core.settings.data.import', params: { resource: '{item.key}' } })
  const forms = screen(spec(true), 'core.site.data').blocks.find((block) => block.title === 'Forms')
  const rows = screen(spec(true), 'core.site.data').constants[forms.items.replace('const.', '')]
  assert.equal(rows[0].imports, false)
})

test('a site lists its own resources under the site, naming the site in every action', () => {
  const site = screen(spec(true), 'core.site.data')
  assert.equal(site.scope, 'site')
  const redirects = site.blocks.find((block) => block.title === 'Redirects')
  assert.equal(redirects.when, "data.sw.rows[id='redirects'].on && data.ent.features.redirects")
  assert.equal(redirects.actions[0].export.hostId, '{site.id}')
  assert.equal(redirects.actions[1].navigate.params.hostId, '{site.id}')
})

test('a dataset is listed one at a time from the workspace datasets', () => {
  const records = screen(spec(false), 'core.settings.data.records')
  const datasets = records.blocks.find((block) => block.title === 'Dataset records')
  assert.equal(datasets.items, 'data.datasets.items')
  assert.equal(datasets.actions[0].export.resource, 'data.dataset:{item.$id}')
  assert.deepEqual(records.load.datasets.query, { collection: 'orgs/{org.id}/datasets', orderBy: 'name', limit: 100 })
})

test('a plan feature the entitlements do not return is refused', () => {
  assert.throws(
    () => transferResourcesSpec({ plugins, planLabelFor: () => undefined, featureKeys: ['crm'] }),
    /redirects, which the entitlements do not return|names the plan feature/,
  )
})
