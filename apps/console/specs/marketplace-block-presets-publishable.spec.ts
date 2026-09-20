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

import { CONSOLE_PLUGIN_MANIFEST } from '../constants/plugins.client.generated'

/**
 * The palette and the publish gate must agree (AGL-1033).
 *
 * Every Sections & Blocks preset composes `section`, which the allowlist did
 * not carry — so the besigner offered an entire category of elements that the
 * marketplace then refused, with an error naming a component id the author has
 * never seen. It is about two plugins at once — the one that owns the palette
 * and the one that owns the allowlist — so it lives where both are reached
 * through the generated manifest, and neither imports the other.
 */

type Preset = { displayName?: string; data?: unknown }

async function pluginModule(id: string): Promise<Record<string, unknown>> {
  const entry = CONSOLE_PLUGIN_MANIFEST.find((one) => one.id === id)
  if (!entry) throw new Error(`no manifest entry for "${id}"`)
  return (await entry.load()) as Record<string, unknown>
}

/** Every component id a preset's node tree reaches, root included. */
function componentIdsIn(node: unknown, found = new Set<string>()): Set<string> {
  if (!node || typeof node !== 'object') return found
  const entry = node as { componentId?: unknown; nodes?: unknown }
  if (typeof entry.componentId === 'string' && entry.componentId) {
    found.add(entry.componentId)
  }
  if (Array.isArray(entry.nodes)) {
    for (const child of entry.nodes) componentIdsIn(child, found)
  }
  return found
}

describe('block presets are publishable (AGL-1033)', () => {
  let presets: Preset[] = []
  let allowlist: readonly string[] = []
  let sanitize: (definition: unknown) => { ok: boolean } = () => ({ ok: false })

  beforeAll(async () => {
    const mui = await pluginModule('mui')
    const loadMuiBundle = mui['loadMuiBundle'] as (
      ids: readonly string[],
    ) => Promise<Array<{ presets?: Preset[] }>>
    // The Sections & Blocks presets ride the element that carries them.
    presets = (await loadMuiBundle(['videoEmbed'])).flatMap(
      (entry) => entry.presets ?? [],
    )
    const marketplace = await pluginModule('marketplace')
    allowlist = marketplace['MARKETPLACE_COMPONENT_ID_ALLOWLIST'] as readonly string[]
    sanitize = marketplace['sanitizeMarketplaceDefinition'] as typeof sanitize
  })

  it('offers presets at all, so an empty import cannot pass this vacuously', () => {
    expect(presets.length).toBeGreaterThan(10)
  })

  it('every preset composes only allowlisted components', () => {
    // One assertion over all of them, because the presets arrive from an
    // async load and `it.each` is fixed before it; a refusal still names its
    // preset and the component the marketplace would have refused.
    expect(Array.isArray(allowlist) && allowlist.length > 0).toBe(true)
    const refused = presets.flatMap((preset) =>
      [...componentIdsIn(preset.data)]
        .filter((id) => !allowlist.includes(id))
        .map((id) => `${preset.displayName ?? '(unnamed)'}: ${id}`),
    )
    expect(refused).toEqual([])
  })

  /**
   * The end-to-end version of the same claim: a preset dropped on a canvas and
   * published must survive sanitization, not merely pass an id check.
   */
  it('sanitizes a Footer preset rather than refusing it', () => {
    const footer = presets.find((preset) => preset.displayName === 'Footer')
    expect(footer).toBeDefined()
    // The canvas shape: a root wrapper holding the preset's tree, with ids
    // assigned. Flattened the way the publish route receives it.
    const nodes: Record<string, any> = {}
    let next = 0
    const flatten = (node: any, parentId: string | null): string => {
      const id = `n${(next += 1)}`
      nodes[id] = {
        $id: id,
        componentId: node.componentId,
        parentId,
        props: node.props ?? {},
        nodes: [] as string[],
      }
      for (const child of node.nodes ?? []) {
        nodes[id].nodes.push(flatten(child, id))
      }
      return id
    }
    const rootId = '_@_'
    nodes[rootId] = { $id: rootId, componentId: 'div', parentId: null, nodes: [] }
    nodes[rootId].nodes.push(flatten((footer as any).data, rootId))

    const result = sanitize({ rootId, nodes })
    expect(result.ok).toBe(true)
  })
})
