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

import * as Aglyn from '@aglyn/aglyn'
import describeElement from './describe-element'

const CONTAINER_ID = 'detail-container'
const LEAF_ID = 'detail-leaf'
const RESTRICTED_ID = 'detail-restricted'
const CHILD_ONLY_ID = 'detail-child-only'
const PLUGIN_ID = 'detail-plugin-element'

/** Registered as COMPONENTS — the facts are read off the component schema. */
const SCHEMAS: any[] = [
  {
    $id: CONTAINER_ID,
    pluginId: 'mui',
    displayName: 'Detail Container',
    description: 'A box that holds things.',
    category: Aglyn.ComponentCategory.LAYOUT,
    attributes: [{ name: 'href', label: 'Link' }, { name: 'target' }],
  },
  {
    $id: LEAF_ID,
    pluginId: 'mui',
    displayName: 'Detail Leaf',
    category: Aglyn.ComponentCategory.TEXT,
    flags: { textEditable: Aglyn.FEATURE_FLAG.ENABLED },
  },
  {
    $id: RESTRICTED_ID,
    pluginId: 'mui',
    displayName: 'Detail Restricted',
    category: Aglyn.ComponentCategory.SURFACE,
    restrictChildren: [
      Aglyn.LinealDirectiveFlag.LIMIT_TO,
      { components: [CHILD_ONLY_ID] },
    ],
  },
  {
    $id: CHILD_ONLY_ID,
    pluginId: 'mui',
    displayName: 'Detail Child Only',
    category: Aglyn.ComponentCategory.SURFACE,
    restrictParent: [
      Aglyn.LinealDirectiveFlag.LIMIT_TO,
      { components: [RESTRICTED_ID] },
    ],
  },
  {
    $id: PLUGIN_ID,
    pluginId: 'commerce',
    displayName: 'Detail Plugin Element',
    category: Aglyn.ComponentCategory.COMMERCE,
  },
]

const factIds = (item: any) =>
  (describeElement(item)?.facts ?? []).map((f) => f.id)
const factLabels = (item: any) =>
  (describeElement(item)?.facts ?? []).map((f) => f.label)

describe('describeElement (AGL-2486)', () => {
  beforeAll(() => {
    SCHEMAS.forEach((schema) =>
      Aglyn.components.registerComponent(
        (() => null) as any,
        schema as Aglyn.ComponentSchema,
      ),
    )
  })

  it('reports whether an element holds other elements', () => {
    expect(factLabels({ $id: CONTAINER_ID })).toContain('Holds other elements')
    // textEditable is one of the four ways a schema says "no slot".
    expect(factLabels({ $id: LEAF_ID })).toContain(
      'Does not hold other elements',
    )
  })

  it('derives lineal relationships in both directions', () => {
    expect(factLabels({ $id: RESTRICTED_ID })).toContain(
      'Only accepts Detail Child Only',
    )
    expect(factLabels({ $id: CHILD_ONLY_ID })).toContain(
      'Must be placed inside Detail Restricted',
    )
  })

  it('says when an element comes from a plugin, and stays quiet for built-ins', () => {
    expect(factIds({ $id: PLUGIN_ID })).toContain('plugin')
    expect(describeElement({ $id: PLUGIN_ID })?.pluginId).toBe('commerce')
    expect(factIds({ $id: CONTAINER_ID })).not.toContain('plugin')
    expect(describeElement({ $id: CONTAINER_ID })?.pluginId).toBeUndefined()
  })

  it('reports that a text-editable element is edited on the canvas', () => {
    expect(factIds({ $id: LEAF_ID })).toContain('text-editable')
  })

  it('lists attribute labels, falling back to the attribute name', () => {
    expect(describeElement({ $id: CONTAINER_ID })?.attributes).toEqual([
      'Link',
      'target',
    ])
  })

  it('shows no prose rather than filler when the schema has none', () => {
    // An element with nothing useful to say shows its derived facts and no
    // description — an invented sentence would be worse than none.
    expect(describeElement({ $id: LEAF_ID })?.description).toBeUndefined()
    expect(describeElement({ $id: LEAF_ID })?.facts.length).toBeGreaterThan(0)
  })

  it('resolves a PRESET to the component it places, keeping the preset prose', () => {
    // Drawer entries are presets: "FAQ" is three stacked Accordions. The
    // facts must come from the component; the words from the preset.
    const preset = {
      $id: 'detail-preset',
      displayName: 'Restricted preset',
      description: 'Preset prose wins over the component description.',
      data: { componentId: RESTRICTED_ID },
    }
    const detail = describeElement(preset)
    expect(detail?.name).toBe('Restricted preset')
    expect(detail?.description).toBe(
      'Preset prose wins over the component description.',
    )
    expect(detail?.componentId).toBe(RESTRICTED_ID)
    expect(detail?.facts.map((f) => f.label)).toContain(
      'Only accepts Detail Child Only',
    )
  })

  it('returns null for nothing', () => {
    expect(describeElement(null)).toBeNull()
    expect(describeElement(undefined)).toBeNull()
  })
})
