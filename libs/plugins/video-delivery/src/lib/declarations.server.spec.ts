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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mediaDeliveryProvider } from '@aglyn/aglyn/plugin-manager/media-delivery-provider'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { VIDEO_DELIVERY_PLUGIN_ID } from './constants'
import { registerVideoDeliveryServerDeclarations } from './declarations.server'

/**
 * The plugin reaches core only through its server declarations (AGL-2824):
 * a call by name from the generated manifest, never a bare import, which a
 * bundler drops when `sideEffects` omits the file (AGL-3025).
 */

const ENV_NAMES = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_VIDEO_BUCKET',
  'MEDIA_VIDEO_DELIVERY_HOST',
  'MEDIA_VIDEO_DELIVERY_SECRET',
]

const saved = { ...process.env }
beforeEach(() => {
  for (const name of ENV_NAMES) delete process.env[name]
  resetPluginServicesForTests()
})
afterAll(() => {
  process.env = saved
})

describe('the video delivery plugin’s server declarations (AGL-2824)', () => {
  it('fills core’s delivery slot, which stays unconfigured until the settings exist', () => {
    registerVideoDeliveryServerDeclarations()
    expect(mediaDeliveryProvider('deliver')).toBeNull()
    expect(mediaDeliveryProvider('store')).toBeNull()

    process.env['MEDIA_VIDEO_DELIVERY_HOST'] = 'video.example.workers.dev'
    process.env['MEDIA_VIDEO_DELIVERY_SECRET'] = 'b'.repeat(64)
    expect(mediaDeliveryProvider('deliver')).not.toBeNull()
    expect(mediaDeliveryProvider('store')).toBeNull()

    process.env['R2_ACCOUNT_ID'] = '0123456789abcdef0123456789abcdef'
    process.env['R2_ACCESS_KEY_ID'] = 'key-id'
    process.env['R2_SECRET_ACCESS_KEY'] = 'key-secret'
    process.env['R2_VIDEO_BUCKET'] = 'aglyn-video'
    expect(mediaDeliveryProvider('store')).not.toBeNull()
  })

  it('may run twice, as a second boot of the same process does', () => {
    registerVideoDeliveryServerDeclarations()
    expect(() => registerVideoDeliveryServerDeclarations()).not.toThrow()
  })

  it('is what plugins.config.json names, under the plugin id core records', () => {
    const config = JSON.parse(
      readFileSync(join(__dirname, '../../../../../plugins.config.json'), 'utf8'),
    ) as { plugins: Array<{ id: string; package: string; register: Record<string, string> }> }
    const entry = config.plugins.find((plugin) => plugin.id === VIDEO_DELIVERY_PLUGIN_ID)
    expect(entry?.package).toBe('@aglyn/plugins-video-delivery')
    expect(entry?.register).toEqual({
      serverDeclarations: 'registerVideoDeliveryServerDeclarations',
    })
  })
})
