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
  type FoldPluginEgressOptions,
  type PluginEgressHostDeclaration,
  type PluginEgressUseDeclaration,
  type PluginSubprocessorDeclaration,
  type PluginSubprocessorManifestEntry,
} from './plugin-subprocessors'

/** What a consumer keeps per host: its own shape, not the declaration's. */
interface Row {
  source: 'base' | 'plugin'
  entity: string
  disposition?: string
  reason?: string
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

describe('foldPluginSubprocessors — hosts that are not recipients, and uses (AGL-2978)', () => {
  const BASE_WITH_REASON: Readonly<Record<string, Row>> = {
    'token.example': { source: 'base', entity: 'Token Example LLC', reason: 'Token exchange.' },
  }
  const WIDGET: PluginEgressHostDeclaration = {
    host: 'widgets.example',
    disposition: 'not-a-subprocessor',
    reason: "The customer's own widget host.",
    dataReceived: 'What the customer sends to their own provider.',
  }
  const CONSENT: PluginEgressHostDeclaration = {
    host: 'consent.example',
    disposition: 'no-request',
    reason: 'An address handed to the browser.',
    dataReceived: 'Nothing from our servers.',
  }
  const TOKEN_USE: PluginEgressUseDeclaration = {
    host: 'token.example',
    reason: 'Also the widgets plugin’s own grant.',
    dataReceived: 'For widgets: the grant.',
  }
  const options: FoldPluginEgressOptions<Row> = {
    toHostEntry: (declaration) => ({
      source: 'plugin',
      entity: '',
      disposition: declaration.disposition,
      reason: declaration.reason,
    }),
    withUse: (entry, use, pluginId) => ({ ...entry, reason: `${entry.reason} [${pluginId}] ${use.reason}` }),
  }

  it('folds a plugin’s other hosts in with their dispositions, and adds its use to a declared host', () => {
    const widgets: PluginSubprocessorManifestEntry = {
      pluginId: 'widgets',
      subprocessors: [],
      hosts: [WIDGET, CONSENT],
      uses: [TOKEN_USE],
    }
    const registry = foldPluginSubprocessors(BASE_WITH_REASON, [widgets], toRow, options)
    expect(registry).toEqual({
      'token.example': {
        source: 'base',
        entity: 'Token Example LLC',
        reason: 'Token exchange. [widgets] Also the widgets plugin’s own grant.',
      },
      'widgets.example': {
        source: 'plugin',
        entity: '',
        disposition: 'not-a-subprocessor',
        reason: "The customer's own widget host.",
      },
      'consent.example': {
        source: 'plugin',
        entity: '',
        disposition: 'no-request',
        reason: 'An address handed to the browser.',
      },
    })
    // The base entry the use was added to is a new value; the base is untouched.
    expect(BASE_WITH_REASON['token.example'].reason).toBe('Token exchange.')
  })

  it('lets a use name a host a LATER plugin declares', () => {
    const early: PluginSubprocessorManifestEntry = {
      pluginId: 'early',
      subprocessors: [],
      uses: [{ ...TOKEN_USE, host: 'widgets.example' }],
    }
    const late: PluginSubprocessorManifestEntry = { pluginId: 'widgets', subprocessors: [], hosts: [WIDGET] }
    const registry = foldPluginSubprocessors(BASE_WITH_REASON, [early, late], toRow, options)
    expect(registry['widgets.example'].reason).toBe(
      "The customer's own widget host. [early] Also the widgets plugin’s own grant.",
    )
  })

  it('refuses a host a recipient or the base already declares, naming both claimants', () => {
    const clash: PluginSubprocessorManifestEntry = {
      pluginId: 'widgets',
      subprocessors: [],
      hosts: [{ ...WIDGET, host: 'token.example' }],
    }
    expect(() => foldPluginSubprocessors(BASE_WITH_REASON, [clash], toRow, options)).toThrow(
      "token.example is declared by the base registry and by plugin 'widgets'",
    )
  })

  it('refuses a use of a host nothing declares, and a use of the plugin’s own host', () => {
    const orphan: PluginSubprocessorManifestEntry = {
      pluginId: 'widgets',
      subprocessors: [],
      uses: [{ ...TOKEN_USE, host: 'nowhere.example' }],
    }
    expect(() => foldPluginSubprocessors(BASE_WITH_REASON, [orphan], toRow, options)).toThrow(
      "plugin 'widgets' declares a use of nowhere.example, which nothing declares",
    )
    const own: PluginSubprocessorManifestEntry = {
      pluginId: 'widgets',
      subprocessors: [],
      hosts: [WIDGET],
      uses: [{ ...TOKEN_USE, host: 'widgets.example' }],
    }
    expect(() => foldPluginSubprocessors(BASE_WITH_REASON, [own], toRow, options)).toThrow(
      "plugin 'widgets' declares both widgets.example and a use of it",
    )
  })

  it('refuses a disposition the registry does not know, and a host with none', () => {
    const odd: PluginSubprocessorManifestEntry = {
      pluginId: 'widgets',
      subprocessors: [],
      hosts: [{ ...WIDGET, disposition: 'subprocessor' as never }],
    }
    expect(() => foldPluginSubprocessors(BASE_WITH_REASON, [odd], toRow, options)).toThrow(
      "plugin 'widgets' declares widgets.example as 'subprocessor', which is not a disposition a host may carry",
    )
    const hostless: PluginSubprocessorManifestEntry = {
      pluginId: 'widgets',
      subprocessors: [],
      hosts: [{ ...WIDGET, host: '' }],
    }
    expect(() => foldPluginSubprocessors(BASE_WITH_REASON, [hostless], toRow, options)).toThrow(
      "plugin 'widgets' declares a not-a-subprocessor host with no host",
    )
  })

  it('refuses hosts and uses a consumer gave no way to fold, rather than dropping them', () => {
    const widgets: PluginSubprocessorManifestEntry = { pluginId: 'widgets', subprocessors: [], hosts: [WIDGET] }
    expect(() => foldPluginSubprocessors(BASE_WITH_REASON, [widgets], toRow)).toThrow(
      "plugin 'widgets' declares widgets.example, and this registry folds no hosts",
    )
    const using: PluginSubprocessorManifestEntry = { pluginId: 'widgets', subprocessors: [], uses: [TOKEN_USE] }
    expect(() => foldPluginSubprocessors(BASE_WITH_REASON, [using], toRow)).toThrow(
      "plugin 'widgets' declares a use of token.example, and this registry folds no uses",
    )
  })
})
