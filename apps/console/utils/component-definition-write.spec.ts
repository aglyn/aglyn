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

import { CANVAS_ROOT_ELEMENT_ID, compress } from '@aglyn/aglyn'
import resolveComponentDefinition, {
  isComponentDefinitionRefusal,
} from './component-definition-write'

/**
 * The definition a component publish writes (AGL-2878), from each form a tree
 * is found in. The besigner publishes from the CANVAS; the Versions dialog
 * publishes from a stored VERSION, which is canvas-shaped once the besigner
 * has saved it and definition-shaped when it was minted from a promotion.
 * All three must land on the parent as the same definition.
 */
describe('resolveComponentDefinition', () => {
  const PROPS = [{ name: 'headline', type: 'text' as const }]

  /** Promoted straight from a page: the root is the selected node. */
  const DEFINITION = {
    hero: { $id: 'hero', componentId: 'box', parentId: null, nodes: ['title'] },
    title: { $id: 'title', componentId: 'muiTypography', parentId: 'hero' },
  }

  /** The same tree as the besigner holds and saves it. */
  const CANVAS = {
    [CANVAS_ROOT_ELEMENT_ID]: {
      $id: CANVAS_ROOT_ELEMENT_ID,
      componentId: 'box',
      parentId: null,
      nodes: ['hero'],
    },
    hero: { ...DEFINITION.hero, parentId: CANVAS_ROOT_ELEMENT_ID },
    title: DEFINITION.title,
  }

  it('publishes a canvas-shaped tree without the synthetic root', () => {
    const resolved = resolveComponentDefinition({ nodes: CANVAS, props: PROPS })

    expect(resolved).toEqual({
      nodes: DEFINITION,
      rootId: 'hero',
      props: PROPS,
    })
  })

  it('publishes a version the besigner saved compressed', () => {
    const resolved = resolveComponentDefinition({ nodes: compress(CANVAS) })

    expect(resolved).toMatchObject({ nodes: DEFINITION, rootId: 'hero' })
  })

  it('publishes a version minted from a promotion, which was never wrapped', () => {
    const resolved = resolveComponentDefinition({
      nodes: DEFINITION,
      rootId: 'hero',
    })

    expect(resolved).toMatchObject({ nodes: DEFINITION, rootId: 'hero' })
  })

  it('names the root from the tree, not from a stale recorded one', () => {
    // A version saved after its top element was replaced still carries the
    // rootId it was minted with.
    const resolved = resolveComponentDefinition({ nodes: CANVAS, rootId: 'gone' })

    expect(resolved).toMatchObject({ rootId: 'hero' })
  })

  it('clears declared props rather than leaving earlier ones behind', () => {
    const resolved = resolveComponentDefinition({ nodes: CANVAS })

    expect(resolved).toMatchObject({ props: [] })
  })

  it('refuses a tree with more than one top-level element', () => {
    const resolved = resolveComponentDefinition({
      nodes: {
        ...CANVAS,
        [CANVAS_ROOT_ELEMENT_ID]: {
          ...CANVAS[CANVAS_ROOT_ELEMENT_ID],
          nodes: ['hero', 'title'],
        },
      },
    })

    expect(isComponentDefinitionRefusal(resolved)).toBe(true)
    expect(resolved).toEqual({
      refusal: expect.stringMatching(/single top-level element/),
    })
  })

  it('refuses a version with no tree at all', () => {
    expect(
      isComponentDefinitionRefusal(resolveComponentDefinition({ nodes: undefined })),
    ).toBe(true)
    expect(
      isComponentDefinitionRefusal(resolveComponentDefinition({ nodes: {} })),
    ).toBe(true)
  })

  it('does not mistake a definition for a refusal', () => {
    expect(
      isComponentDefinitionRefusal(resolveComponentDefinition({ nodes: CANVAS })),
    ).toBe(false)
  })
})
