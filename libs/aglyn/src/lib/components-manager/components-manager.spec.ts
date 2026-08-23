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

// This module participates in a require cycle (components-manager →
// lifecycle → aglyn → components-manager). Evaluate the runtime entry
// first — as production does — so the class export is fully initialized.
import '../aglyn'
import { COMPONENT_CATEGORY_ORDER } from '../foundation'
import { ComponentCategory, NodeType } from '../types/nodes'
import { ComponentManager } from './components-manager'

const makePreset = (id: string, category: string) =>
  ({
    $id: id,
    type: NodeType.PRESET,
    displayName: id,
    pluginId: 'test-plugin',
    description: id,
    category,
    icon: { path: '' },
    data: {
      $id: null,
      componentId: 'div',
      pluginId: 'test-plugin',
      props: {},
    },
  }) as any

/**
 * Element drawer/picker grouping (AGL-538): curated categories follow the
 * explicit rank — Sections & Blocks first — with plugin-registered
 * categories after them alphabetically and Uncategorized always last.
 */
describe('ComponentManager.schemasBySortedCategories (AGL-538)', () => {
  const manager = new ComponentManager()

  beforeAll(() => {
    manager.registerPreset([
      makePreset('p-uncat', ComponentCategory.UNCATEGORIZED),
      makePreset('p-input', ComponentCategory.INPUT),
      makePreset('p-marketplace', 'Marketplace'),
      makePreset('p-blocks', ComponentCategory.BLOCKS),
      makePreset('p-data', ComponentCategory.DATA_DISPLAY),
      makePreset('p-yours', 'Your components'),
      makePreset('p-layout', ComponentCategory.LAYOUT),
      makePreset('p-surface', ComponentCategory.SURFACE),
      makePreset('p-nav', ComponentCategory.NAVIGATION),
      makePreset('p-text', ComponentCategory.TEXT),
      // Logical groups added by the regroup pass (AGL-541).
      makePreset('p-forms', ComponentCategory.FORMS),
      makePreset('p-media', ComponentCategory.MEDIA),
      makePreset('p-commerce', ComponentCategory.COMMERCE),
    ])
  })

  it('puts Sections & Blocks first and follows the curated rank', () => {
    const labels = manager.schemasBySortedCategories.map((c) => c.label)
    expect(labels[0]).toBe(ComponentCategory.BLOCKS)
    const ranked = labels.filter((label) =>
      COMPONENT_CATEGORY_ORDER.includes(label),
    )
    expect(ranked).toEqual(
      COMPONENT_CATEGORY_ORDER.filter((label) => labels.includes(label)),
    )
  })

  it('sorts unknown (plugin) categories after ranked ones, alphabetically', () => {
    const labels = manager.schemasBySortedCategories.map((c) => c.label)
    const lastRanked = Math.max(
      ...COMPONENT_CATEGORY_ORDER.filter((label) =>
        labels.includes(label),
      ).map((label) => labels.indexOf(label)),
    )
    const marketplace = labels.indexOf('Marketplace')
    const yours = labels.indexOf('Your components')
    expect(marketplace).toBeGreaterThan(lastRanked)
    expect(yours).toBeGreaterThan(marketplace)
  })

  it('keeps Uncategorized at the bottom', () => {
    const labels = manager.schemasBySortedCategories.map((c) => c.label)
    expect(labels[labels.length - 1]).toBe(ComponentCategory.UNCATEGORIZED)
  })

  it('groups every registered preset under its category', () => {
    const blocks = manager.schemasBySortedCategories.find(
      (category) => category.label === ComponentCategory.BLOCKS,
    )
    expect(blocks?.items?.map((item) => item.$id)).toEqual(['p-blocks'])
  })
  it('keeps every field the preset schema carries, not a hand-picked list', () => {
    // The constructor used to copy field by field, so anything added to
    // PresetSchema later was silently dropped at registration — which had
    // already happened once to `interactions` (AGL-589), and needed its own
    // line to come back. Registration must not have an opinion about which
    // fields exist (AGL-2486).
    const preset = {
      ...makePreset('p-fields', ComponentCategory.LAYOUT),
      tags: ['picture', 'photo'],
      keywords: ['snapshot'],
      interactions: [{ presetRef: 'x' }],
    } as any
    manager.registerPreset([preset])

    const registered = manager.presets['p-fields'] as any
    expect(registered.tags).toEqual(['picture', 'photo'])
    expect(registered.keywords).toEqual(['snapshot'])
    // The field that proves the old shape was already lossy.
    expect(registered.interactions).toEqual([{ presetRef: 'x' }])
    // And the invariants registration DOES own still hold.
    expect(registered.type).toBe(NodeType.PRESET)
    expect(registered.category).toBe(ComponentCategory.LAYOUT)
  })
})
