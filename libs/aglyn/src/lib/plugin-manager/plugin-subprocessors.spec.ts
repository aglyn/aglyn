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
  foldPluginSubprocessors,
  type PluginSubprocessorDeclaration,
  type PluginSubprocessorManifestEntry,
} from './plugin-subprocessors'

/** What a consumer keeps per host: its own shape, not the declaration's. */
interface Row {
  source: 'base' | 'plugin'
  entity: string
}

const BASE: Readonly<Record<string, Row>> = {
  'payments.example': { source: 'base', entity: 'Payments Example, Inc.' },
}

function declaration(host: string, entity: string): PluginSubprocessorDeclaration {
  return {
    host,
    entity,
    region: 'United States',
    purpose: `What ${entity} does for the plugin`,
    publishedOn: '2026-09-15',
    reason: `The plugin's code reaches ${host}.`,
    dataReceived: `What ${host} receives from the plugin.`,
  }
}

const MAPS_TILES = declaration('tiles.maps.example', 'Maps Example Ltd.')
const AI_INFERENCE = declaration('inference.ai.example', 'Inference Example PBC')

/** Two unrelated plugins, one recipient each. */
const MAPS: PluginSubprocessorManifestEntry = { pluginId: 'maps', subprocessors: [MAPS_TILES] }
const AI: PluginSubprocessorManifestEntry = { pluginId: 'ai', subprocessors: [AI_INFERENCE] }

const toRow = (entry: PluginSubprocessorDeclaration): Row => ({
  source: 'plugin',
  entity: entry.entity,
})

describe('foldPluginSubprocessors', () => {
  it("folds two unrelated plugins' declarations in beside the base, keyed by host", () => {
    const mapping = jest.fn(toRow)
    const registry = foldPluginSubprocessors(BASE, [MAPS, AI], mapping)

    expect(registry).toEqual({
      'payments.example': { source: 'base', entity: 'Payments Example, Inc.' },
      'tiles.maps.example': { source: 'plugin', entity: 'Maps Example Ltd.' },
      'inference.ai.example': { source: 'plugin', entity: 'Inference Example PBC' },
    })
    // Each declaration reaches the mapping whole, once.
    expect(mapping.mock.calls).toEqual([[MAPS_TILES], [AI_INFERENCE]])
    // The base is read, never written.
    expect(registry).not.toBe(BASE)
    expect(Object.keys(BASE)).toEqual(['payments.example'])
  })

  it('refuses a host the base registry already declares, naming both claimants', () => {
    const clash: PluginSubprocessorManifestEntry = {
      pluginId: 'maps',
      subprocessors: [declaration('payments.example', 'Maps Example Ltd.')],
    }
    expect(() => foldPluginSubprocessors(BASE, [clash], toRow)).toThrow(
      "payments.example is declared by the base registry and by plugin 'maps'",
    )
  })

  it('refuses a host another plugin already declared, naming both plugins', () => {
    const clash: PluginSubprocessorManifestEntry = {
      pluginId: 'ai',
      subprocessors: [declaration('tiles.maps.example', 'Inference Example PBC')],
    }
    expect(() => foldPluginSubprocessors(BASE, [MAPS, clash], toRow)).toThrow(
      "tiles.maps.example is declared by plugin 'maps' and by plugin 'ai'",
    )
  })

  it('answers a copy of the base for an empty manifest and for a plugin that declares nothing', () => {
    const empty = foldPluginSubprocessors(BASE, [], toRow)
    expect(empty).toEqual(BASE)
    expect(empty).not.toBe(BASE)
    expect(foldPluginSubprocessors(BASE, [{ pluginId: 'maps', subprocessors: [] }], toRow)).toEqual(
      BASE,
    )
  })

  it('refuses a declaration with no host, naming the plugin', () => {
    const hostless: PluginSubprocessorManifestEntry = {
      pluginId: 'maps',
      subprocessors: [declaration('', 'Maps Example Ltd.')],
    }
    expect(() => foldPluginSubprocessors(BASE, [hostless], toRow)).toThrow(
      "plugin 'maps' declares a subprocessor (Maps Example Ltd.) with no host",
    )
  })
})
