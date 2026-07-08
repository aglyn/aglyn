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

import {
  parsePluginPropsJson,
  PLUGIN_DRAWER_CATEGORY,
  pluginInstallToPreset,
} from './plugin'

describe('parsePluginPropsJson (AGL-192)', () => {
  it('parses an object and rejects junk/arrays', () => {
    expect(parsePluginPropsJson('{"city":"NYC"}')).toEqual({ city: 'NYC' })
    expect(parsePluginPropsJson('')).toBeUndefined()
    expect(parsePluginPropsJson('not json')).toBeUndefined()
    expect(parsePluginPropsJson('[1,2]')).toBeUndefined()
  })
})

describe('pluginInstallToPreset (AGL-190)', () => {
  it('builds a Community-category preset pinning the listing id', () => {
    const preset = pluginInstallToPreset({
      $id: 'L1',
      displayName: 'Weather',
      manifest: { name: 'Weather', restrictParent: ['muiStack'] },
    })
    expect(preset).not.toBeNull()
    expect(preset?.$id).toBe('plugin__L1')
    expect(preset?.displayName).toBe('Weather')
    expect(preset?.category).toBe(PLUGIN_DRAWER_CATEGORY)
    expect((preset?.data as any).props.listingId).toBe('L1')
    expect((preset?.data as any).restrictParent).toEqual(['muiStack'])
  })

  it('prefers listingId over $id and falls back to the manifest name', () => {
    const preset = pluginInstallToPreset({
      listingId: 'L2',
      $id: 'other',
      manifest: { name: 'Charts' },
    })
    expect((preset?.data as any).props.listingId).toBe('L2')
    expect(preset?.displayName).toBe('Charts')
  })

  it('returns null without a resolvable listing id', () => {
    expect(pluginInstallToPreset({ displayName: 'x' })).toBeNull()
  })
})
