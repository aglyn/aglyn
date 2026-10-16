import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { pluginSettingsScreen } from './native-plugin-settings.mjs'

const schema = {
  pluginId: 'demo',
  fields: [
    { key: 'on', label: 'On', type: 'boolean' },
    { key: 'days', label: 'Days', type: 'number', min: 1, max: 9, description: 'How long.' },
    { key: 'mode', label: 'Mode', type: 'select', options: [{ value: 'a', label: 'A' }] },
    { key: 'path', label: 'Path', type: 'string' },
  ],
  defaults: { on: true, days: 3, mode: 'a', path: '/' },
}

test('a schema becomes one form that writes every field under the plugin', () => {
  const screen = pluginSettingsScreen({ schema, label: 'Demo' })
  assert.equal(screen.id, 'core.pluginSettings.demo')
  const [form] = screen.blocks
  assert.deepEqual(
    form.fields.map((field) => [field.key, field.kind]),
    [['on', 'toggle'], ['days', 'number'], ['mode', 'select'], ['path', 'text']],
  )
  // `??`, not `|`: a stored false must beat a default of true.
  assert.equal(form.fields[0].initial, '{item.on ?? const.defaults.on}')
  assert.equal(form.fields[1].help, 'How long. Between 1 and 9.')
  assert.deepEqual(screen.constants.defaults, schema.defaults)
  assert.equal(form.submit.write.doc, 'orgs/{org.id}/pluginSettings/demo')
  assert.deepEqual(Object.keys(form.submit.write.fields), ['on', 'days', 'mode', 'path', 'updatedBy'])
})

/**
 * A marketplace plugin's settings are drawn at run time from its manifest by `manifestSettingsScreen`
 * (marketplace-catalog.ts, which the apps replay). It is the very screen the generator makes for a built-in plugin's
 * schema, under an id of its own.
 */
test('a manifest of the same fields draws the screen a built-in plugin gets', async () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  const { createJiti } = createRequire(join(root, 'package.json'))('jiti')
  const jiti = createJiti(join(root, 'package.json'), { interopDefault: true, fsCache: false })
  const { manifestSettingsScreen } = await jiti.import(join(root, 'libs/plugins/marketplace/src/lib/model/marketplace-catalog.ts'))
  const { AI_CONFIG_SCHEMA } = await jiti.import(join(root, 'libs/plugins/ai/src/lib/plugin-config.ts'))
  for (const [candidate, label] of [[schema, 'Demo'], [AI_CONFIG_SCHEMA, 'AI']]) {
    const manifest = { config: { fields: candidate.fields, defaults: candidate.defaults } }
    const drawn = manifestSettingsScreen(candidate.pluginId, label, manifest)
    const generated = pluginSettingsScreen({ schema: candidate, label })
    assert.deepEqual({ ...drawn, id: generated.id }, generated, candidate.pluginId)
    assert.equal(drawn.id, `marketplace.pluginSettings.${candidate.pluginId}`)
  }
  assert.equal(manifestSettingsScreen('demo', 'Demo', {}), null)
})
