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

import { components } from '@aglyn/aglyn'
import { autorun } from 'mobx'
import { muiPluginInstallToPresets, PLUGIN_DRAWER_CATEGORY, realmRegistersItsSiteElements } from './plugin-install-presets'

/**
 * A signed plugin that registers its own site elements is offered once, by
 * those elements; the generic sandboxed "Marketplace" entry beside it placed a
 * frame that drew nothing for it (AGL-4196). A sandboxed plugin keeps it.
 */

const ELEMENT = 'aglyn.google-reviews.reviews'
const SIGNED = {
  listingId: 'listing-reviews',
  displayName: 'Google reviews',
  manifest: { name: 'Google reviews', contributes: { site: { components: [ELEMENT] } } },
}
const SANDBOXED = { listingId: 'listing-weather', displayName: 'Weather', manifest: { name: 'Weather' } }

const Element = () => null

afterEach(() => {
  if (components.getSchema(ELEMENT)) components.unregisterComponent(ELEMENT)
})

const register = () =>
  components.registerComponent(Element as never, { $id: ELEMENT, displayName: 'Google reviews', category: 'Data Display' } as never)

describe('the generic Marketplace entry for a signed plugin (AGL-4196)', () => {
  it('is dropped once the signed bundle has registered every element it declares', () => {
    register()
    expect(realmRegistersItsSiteElements(SIGNED)).toBe(true)
    const presets = muiPluginInstallToPresets(SIGNED)
    expect(presets.find((preset) => preset.category === PLUGIN_DRAWER_CATEGORY && preset.$id === 'plugin__listing-reviews')).toBeUndefined()
  })

  it('stays while the bundle has not loaded (sandboxed, unverified or still loading)', () => {
    expect(realmRegistersItsSiteElements(SIGNED)).toBe(false)
    expect(muiPluginInstallToPresets(SIGNED).map((preset) => preset.$id)).toContain('plugin__listing-reviews')
  })

  it('stays for a plugin that declares no site elements of its own', () => {
    register()
    expect(realmRegistersItsSiteElements(SANDBOXED)).toBe(false)
    expect(muiPluginInstallToPresets(SANDBOXED).map((preset) => preset.$id)).toEqual(['plugin__listing-weather'])
  })

  it('stays when only some of the declared elements are registered', () => {
    register()
    const partial = { ...SIGNED, manifest: { contributes: { site: { components: [ELEMENT, 'aglyn.google-reviews.badge'] } } } }
    expect(realmRegistersItsSiteElements(partial)).toBe(false)
  })

  it('is read through the observable registry, so the drawer re-runs when the bundle loads', () => {
    const seen: boolean[] = []
    const dispose = autorun(() => seen.push(realmRegistersItsSiteElements(SIGNED)))
    register()
    dispose()
    expect(seen).toEqual([false, true])
  })
})
