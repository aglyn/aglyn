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
 * A MARKETPLACE plugin's declared settings reach the same two-level model a
 * first-party plugin's do (AGL-428).
 *
 * `resolvePluginConfig` was already plugin-agnostic — schema defaults, then
 * the workspace's stored answer, then only the keys one site overrides — and
 * it was never reached for a third-party plugin, because the only way to
 * declare a schema was `registerPluginConfigSchema`, a module-scope call a
 * sandboxed bundle running on another origin can never make. The manifest is
 * the declaration the console does hold, so these tests pin BOTH halves: that
 * a manifest becomes a schema, and that the schema then behaves like any
 * other through the resolver whose layering is not being changed.
 */

import {
  pluginConfigOverrides,
  pluginConfigSchemaFromManifest,
  resolvePluginConfig,
} from './plugin-config'

const manifest = {
  id: 'listing-abc',
  name: 'Loyalty Points',
  version: '2.1.0',
  entry: 'index.js',
  config: {
    fields: [
      { key: 'pointsPerDollar', label: 'Points per dollar', type: 'number', min: 1 },
      { key: 'welcomeBonus', label: 'Welcome bonus', type: 'number' },
      { key: 'showBadge', label: 'Show badge', type: 'boolean' },
      {
        key: 'tier',
        label: 'Tier',
        type: 'select',
        options: [
          { value: 'basic', label: 'Basic' },
          { value: 'plus', label: 'Plus' },
        ],
      },
    ],
    defaults: { pointsPerDollar: 5, welcomeBonus: 100, showBadge: true, tier: 'basic' },
  },
}

describe('pluginConfigSchemaFromManifest', () => {
  it('turns a declared config block into a schema keyed by the plugin id', () => {
    const schema = pluginConfigSchemaFromManifest('listing-abc', manifest)
    expect(schema?.pluginId).toBe('listing-abc')
    expect(schema?.fields.map((field) => field.key)).toEqual([
      'pointsPerDollar',
      'welcomeBonus',
      'showBadge',
      'tier',
    ])
    expect(schema?.defaults['pointsPerDollar']).toBe(5)
  })

  /**
   * The CONTROL for this half. Most plugins declare no settings, and a schema
   * invented for one would render an empty settings card on every marketplace
   * plugin page in the console — so "no declaration" has to be distinguishable
   * from "a declaration with no fields".
   */
  it('answers undefined for a manifest that declares nothing', () => {
    expect(pluginConfigSchemaFromManifest('listing-abc', { id: 'x' })).toBeUndefined()
    expect(
      pluginConfigSchemaFromManifest('listing-abc', { config: { fields: [] } }),
    ).toBeUndefined()
    expect(pluginConfigSchemaFromManifest('listing-abc', null)).toBeUndefined()
    expect(pluginConfigSchemaFromManifest('', manifest)).toBeUndefined()
  })

  it('drops what it cannot render rather than rendering it', () => {
    const schema = pluginConfigSchemaFromManifest('listing-abc', {
      config: {
        fields: [
          { key: 'ok', label: 'Fine', type: 'string' },
          // No key at all.
          { label: 'Nameless', type: 'string' },
          // A type the form has no control for.
          { key: 'weird', label: 'Weird', type: 'richtext' },
          // A select with nothing to select is a dropdown nobody can answer.
          { key: 'empty', label: 'Empty', type: 'select', options: [] },
          // A duplicate would give two controls one storage slot.
          { key: 'ok', label: 'Fine again', type: 'string' },
        ],
      },
    })
    expect(schema?.fields.map((field) => field.key)).toEqual(['ok'])
  })

  it('coerces a manifest default through the same path a stored value takes', () => {
    const schema = pluginConfigSchemaFromManifest('listing-abc', {
      config: {
        fields: [{ key: 'points', label: 'Points', type: 'number', min: 1 }],
        // A string where a number belongs. Left alone it would become the
        // value every site inherits.
        defaults: { points: 'lots' },
      },
    })
    expect(schema?.defaults['points']).toBe(1)
  })
})

describe('a marketplace plugin through resolvePluginConfig', () => {
  const schema = pluginConfigSchemaFromManifest('listing-abc', manifest)

  it('falls back to the manifest defaults when nothing is stored', () => {
    expect(resolvePluginConfig(schema as never, {})).toEqual({
      pointsPerDollar: 5,
      welcomeBonus: 100,
      showBadge: true,
      tier: 'basic',
    })
  })

  it('a site overrides ONE key and keeps inheriting the rest', () => {
    const resolved = resolvePluginConfig(schema as never, {
      org: { pointsPerDollar: 10, welcomeBonus: 250, tier: 'plus' },
      host: { pointsPerDollar: 20 },
    })
    expect(resolved['pointsPerDollar']).toBe(20)
    // The keys the site said nothing about still follow the workspace,
    // including one the workspace changed after the override was written.
    expect(resolved['welcomeBonus']).toBe(250)
    expect(resolved['tier']).toBe('plus')
    expect(pluginConfigOverrides(schema as never, { pointsPerDollar: 20 })).toEqual([
      'pointsPerDollar',
    ])
  })

  it('a FALSY site override is still an override', () => {
    // The rule that makes "off" storable at site scope: presence decides, not
    // truthiness, so a site can switch a badge off under a workspace that has
    // it on.
    const resolved = resolvePluginConfig(schema as never, {
      org: { showBadge: true },
      host: { showBadge: false },
    })
    expect(resolved['showBadge']).toBe(false)
  })

  /**
   * The CONTROL for this half. Every assertion above would pass for a
   * resolver that simply merged the two documents; this is the one that fails
   * if the site layer stops being narrowed to declared overrides.
   */
  it('a key the site never wrote is not an override', () => {
    const resolved = resolvePluginConfig(schema as never, {
      org: { welcomeBonus: 250 },
      host: { pointsPerDollar: 20 },
    })
    expect(resolved['welcomeBonus']).toBe(250)
    expect(pluginConfigOverrides(schema as never, { pointsPerDollar: 20 })).not.toContain(
      'welcomeBonus',
    )
  })
})
