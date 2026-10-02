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

import { pluginIntakeGate, registerPluginIntakeGate } from './plugin-intake-gates'
import { resetPluginServicesForTests } from './plugin-services'

/**
 * A plugin's public door, asked whether it would take the next visitor write
 * without writing (AGL-3080): one gate per door, owned, and absent where no
 * plugin keeps the door.
 */
describe('intake gates', () => {
  beforeEach(() => resetPluginServicesForTests())

  it('answers a door with the plugin that keeps it', async () => {
    registerPluginIntakeGate('form', async () => 'flood-ceiling', { pluginId: 'forms' })
    const door = pluginIntakeGate('form')
    expect(door?.pluginId).toBe('forms')
    expect(await door?.gate({ hostId: 'h1', host: undefined, org: undefined })).toBe('flood-ceiling')
  })

  it('is no gate at all where no plugin keeps the door', () => {
    expect(pluginIntakeGate('form')).toBeNull()
  })

  it('refuses a second plugin gating a door another already answers', () => {
    registerPluginIntakeGate('form', async () => 'open', { pluginId: 'forms' })
    expect(() =>
      registerPluginIntakeGate('form', async () => 'open', { pluginId: 'acme' }),
    ).toThrow('door "form" is already gated by "forms"; refused "acme"')
    expect(pluginIntakeGate('form')?.pluginId).toBe('forms')
  })

  it('lets the owner replace its own gate', async () => {
    registerPluginIntakeGate('form', async () => 'open', { pluginId: 'forms' })
    registerPluginIntakeGate('form', async () => 'switched-off', { pluginId: 'forms' })
    expect(await pluginIntakeGate('form')?.gate({ hostId: 'h1', host: {}, org: {} })).toBe(
      'switched-off',
    )
  })

  it('refuses a gate with no door or no owner', () => {
    expect(() => registerPluginIntakeGate(' ', async () => 'open', { pluginId: 'forms' })).toThrow(
      'an intake gate needs the door it answers for',
    )
    expect(() => registerPluginIntakeGate('form', async () => 'open')).toThrow(
      'the intake gate for "form" was registered with no owner',
    )
  })
})
