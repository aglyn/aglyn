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

import { getPluginConfigSchema } from '@aglyn/aglyn/plugin-manager/plugin-config'
import {
  labelContactSource,
  pluginContactSource,
} from '@aglyn/aglyn/plugin-manager/plugin-contact-capture'
import { WAIVERS_CONTACT_SOURCE, WAIVERS_PLUGIN_ID } from './constants/bundle-common'
import { registerWaiversDeclarations } from './declarations'

/**
 * Waivers' light declarations (AGL-4042), which the console's browser and
 * both servers load before anything renders: the CRM capture door a
 * signature files a person under, so the CRM reads a signer's source as the
 * plugin's label rather than the raw word `waiver`.
 */
describe('registerWaiversDeclarations', () => {
  it('declares the waiver capture door with its label and link', () => {
    registerWaiversDeclarations()
    expect(pluginContactSource(WAIVERS_CONTACT_SOURCE)).toEqual({
      source: 'waiver',
      label: 'Waiver signed',
      openLabel: 'Open waiver',
      pluginId: WAIVERS_PLUGIN_ID,
    })
  })

  it('so a contact a signature created reads by its label', () => {
    expect(labelContactSource('waiver')).toBe('Waiver signed')
  })

  it('declares the settings the eraser and the retention job read: years kept after an erasure request', () => {
    registerWaiversDeclarations()
    expect(getPluginConfigSchema(WAIVERS_PLUGIN_ID)).toMatchObject({
      pluginId: 'waivers',
      defaults: { retentionYears: 7 },
      help: { topic: 'waivers', anchor: '#keeping-signed-waivers' },
    })
  })
})
