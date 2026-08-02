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

import { blockPresets } from '@aglyn/plugins-mui/components/blocks'
import {
  MARKETPLACE_COMPONENT_ID_ALLOWLIST,
  sanitizeMarketplaceDefinition,
} from './marketplace'

/**
 * The palette and the publish gate must agree (AGL-1033).
 *
 * Every Sections & Blocks preset composes `section`, which the allowlist did
 * not carry — so the besigner offered an entire category of elements that the
 * marketplace then refused, with an error naming a component id the author has
 * never seen. This test lives here, in the project that owns the allowlist,
 * because that is the side that has to change when the palette grows.
 */

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
  const presets = blockPresets as Array<{
    displayName?: string
    data?: unknown
  }>

  it('offers presets at all, so an empty import cannot pass this vacuously', () => {
    expect(presets.length).toBeGreaterThan(10)
  })

  it.each(presets.map((preset) => [preset.displayName ?? '(unnamed)', preset]))(
    '"%s" composes only allowlisted components',
    (_name, preset) => {
      const ids = [...componentIdsIn((preset as { data?: unknown }).data)]
      const refused = ids.filter(
        (id) => !MARKETPLACE_COMPONENT_ID_ALLOWLIST.includes(id),
      )
      expect(refused).toEqual([])
    },
  )

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

    const result = sanitizeMarketplaceDefinition({ rootId, nodes })
    expect(result.ok).toBe(true)
  })
})

describe('empty definitions are refused (AGL-1033)', () => {
  /**
   * This used to SUCCEED: the root wrapper alone sanitizes cleanly, so a
   * component whose content had never been published to its document shipped a
   * blank version to every installer and said nothing about it.
   */
  it('refuses a definition that is only the root wrapper', () => {
    const result = sanitizeMarketplaceDefinition({
      rootId: '_@_',
      nodes: { '_@_': { $id: '_@_', componentId: 'div', nodes: [] } as never },
    })
    expect(result.ok).toBe(false)
    if (result.ok === false) {
      expect(result.error).toMatch(/nothing to publish/i)
    }
  })
})
