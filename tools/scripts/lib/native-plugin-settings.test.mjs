import assert from 'node:assert/strict'
import { test } from 'node:test'

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
