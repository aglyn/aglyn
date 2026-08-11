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
import {
  canMoveNodeIn,
  canMoveNodeOut,
  moveNodeIn,
  moveNodeOut,
} from './node-move'

const CONTAINER = 'testMoveContainer'
const MARKDOWN = 'testMoveMarkdown'
const IMAGE = 'testMoveImage'

const noopFactory = (() => null) as any

function registerSchemas() {
  Aglyn.components.registerComponent(noopFactory, {
    $id: CONTAINER,
    displayName: 'Stack',
  })
  // The AGL-1388 shape: a block whose content IS an attribute, so it renders
  // its own `content` and never its children.
  Aglyn.components.registerComponent(noopFactory, {
    $id: MARKDOWN,
    displayName: 'Markdown',
    flags: { dropping: Aglyn.FEATURE_FLAG.DISABLED },
  })
  Aglyn.components.registerComponent(noopFactory, {
    $id: IMAGE,
    displayName: 'Image',
    flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  })
}

/**
 * The /press gallery, reduced to its bones:
 *
 *   root
 *     section
 *       markdown          <- rejects children (AGL-1388)
 *         stack
 *           img1, img2
 *       tail
 */
function seedCanvas() {
  Aglyn.canvas.reset()
  Aglyn.canvas.setNodes({
    [Aglyn.NODE_ROOT_ID]: {
      $id: Aglyn.NODE_ROOT_ID,
      componentId: 'div',
      nodes: ['section'],
    },
    section: {
      $id: 'section',
      componentId: CONTAINER,
      parentId: Aglyn.NODE_ROOT_ID,
      nodes: ['markdown', 'tail'],
    },
    markdown: {
      $id: 'markdown',
      componentId: MARKDOWN,
      parentId: 'section',
      nodes: ['stack'],
    },
    stack: {
      $id: 'stack',
      componentId: CONTAINER,
      parentId: 'markdown',
      nodes: ['img1', 'img2'],
    },
    img1: { $id: 'img1', componentId: IMAGE, parentId: 'stack', nodes: [] },
    img2: { $id: 'img2', componentId: IMAGE, parentId: 'stack', nodes: [] },
    tail: { $id: 'tail', componentId: CONTAINER, parentId: 'section', nodes: [] },
  } as any)
}

describe('moveNodeOut / moveNodeIn — reparent by clicking (AGL-1405)', () => {
  beforeEach(() => {
    registerSchemas()
    seedCanvas()
  })

  describe('moveNodeOut', () => {
    /**
     * The rescue AGL-1405 exists for: one click lifts the stack out of the
     * markdown block and lands it beside it, carrying the images with it.
     */
    it('lifts a node out of its container, landing it just after it', () => {
      const result = moveNodeOut(Aglyn.canvas.getNode('stack')!)

      expect(result.error).toBeUndefined()
      expect(Aglyn.canvas.getNode('section')!.nodes).toEqual([
        'markdown',
        'stack',
        'tail',
      ])
      expect(Aglyn.canvas.getNode('markdown')!.nodes).toEqual([])
      expect(Aglyn.canvas.getNode('stack')!.parentId).toBe('section')
    })

    it('moves the subtree intact, keeping every id', () => {
      moveNodeOut(Aglyn.canvas.getNode('stack')!)

      const stack = Aglyn.canvas.getNode('stack')!
      expect(stack.nodes).toEqual(['img1', 'img2'])
      expect(Aglyn.canvas.getNode('img1')!.parentId).toBe('stack')
      expect(Aglyn.canvas.getNode('img2')!.parentId).toBe('stack')
    })

    /**
     * The guard rail. An image inside the stack has `markdown` for a
     * grandparent, so lifting it one level would drop it straight back into
     * the container that cannot draw it — recreating AGL-1388 through the
     * very feature meant to undo it.
     */
    it('REFUSES to land a node in a container that rejects children', () => {
      const result = moveNodeOut(Aglyn.canvas.getNode('img1')!)

      expect(result.error).toMatch(/can't hold other elements/i)
      expect(result.node).toBeUndefined()
      // Nothing was written, and no undo step was spent on it.
      expect(Aglyn.canvas.getNode('stack')!.nodes).toEqual(['img1', 'img2'])
      expect(Aglyn.canvas.getNode('markdown')!.nodes).toEqual(['stack'])
      expect(Aglyn.canvas.canUndo).toBe(false)
      expect(canMoveNodeOut(Aglyn.canvas.getNode('img1')!)).toBe(false)
    })

    it('refuses a node that is already at the top level', () => {
      expect(canMoveNodeOut(Aglyn.canvas.getNode('section')!)).toBe(false)
      expect(moveNodeOut(Aglyn.canvas.getNode('section')!).error).toMatch(
        /already at the top level/i,
      )
      expect(Aglyn.canvas.canUndo).toBe(false)
    })

    it('refuses the root node', () => {
      expect(canMoveNodeOut(Aglyn.canvas.getNode(Aglyn.NODE_ROOT_ID)!)).toBe(
        false,
      )
      expect(Aglyn.canvas.canUndo).toBe(false)
    })

    it('undo puts the moved subtree back where it was', () => {
      moveNodeOut(Aglyn.canvas.getNode('stack')!)
      expect(Aglyn.canvas.canUndo).toBe(true)

      Aglyn.canvas.undo()
      expect(Aglyn.canvas.getNode('markdown')!.nodes).toEqual(['stack'])
      expect(Aglyn.canvas.getNode('stack')!.parentId).toBe('markdown')
      expect(Aglyn.canvas.getNode('stack')!.nodes).toEqual(['img1', 'img2'])
      expect(Aglyn.canvas.getNode('section')!.nodes).toEqual([
        'markdown',
        'tail',
      ])
    })
  })

  describe('moveNodeIn', () => {
    it('tucks a node into the sibling directly above it', () => {
      // After the rescue: section -> [markdown, stack, tail].
      moveNodeOut(Aglyn.canvas.getNode('stack')!)

      const result = moveNodeIn(Aglyn.canvas.getNode('tail')!)
      expect(result.error).toBeUndefined()
      expect(Aglyn.canvas.getNode('stack')!.nodes).toEqual([
        'img1',
        'img2',
        'tail',
      ])
      expect(Aglyn.canvas.getNode('tail')!.parentId).toBe('stack')
      expect(Aglyn.canvas.getNode('section')!.nodes).toEqual([
        'markdown',
        'stack',
      ])
    })

    /** The same guard from the other direction. */
    it('REFUSES to move into a sibling that rejects children', () => {
      // `tail` sits directly after the markdown block.
      const result = moveNodeIn(Aglyn.canvas.getNode('tail')!)

      expect(result.error).toMatch(/can't hold other elements/i)
      expect(Aglyn.canvas.getNode('markdown')!.nodes).toEqual(['stack'])
      expect(Aglyn.canvas.getNode('section')!.nodes).toEqual([
        'markdown',
        'tail',
      ])
      expect(Aglyn.canvas.canUndo).toBe(false)
      expect(canMoveNodeIn(Aglyn.canvas.getNode('tail')!)).toBe(false)
    })

    it('refuses a first child, which has nothing above it', () => {
      expect(canMoveNodeIn(Aglyn.canvas.getNode('img1')!)).toBe(false)
      expect(moveNodeIn(Aglyn.canvas.getNode('img1')!).error).toMatch(
        /no element above/i,
      )
      expect(Aglyn.canvas.canUndo).toBe(false)
    })

    it('refuses to move into a self-closing leaf', () => {
      expect(canMoveNodeIn(Aglyn.canvas.getNode('img2')!)).toBe(false)
      expect(moveNodeIn(Aglyn.canvas.getNode('img2')!).error).toMatch(
        /can't hold other elements/i,
      )
      expect(Aglyn.canvas.getNode('img1')!.nodes).toEqual([])
    })

    it('undo restores a completed move', () => {
      moveNodeOut(Aglyn.canvas.getNode('stack')!)
      moveNodeIn(Aglyn.canvas.getNode('tail')!)
      expect(Aglyn.canvas.getNode('tail')!.parentId).toBe('stack')

      Aglyn.canvas.undo()
      expect(Aglyn.canvas.getNode('tail')!.parentId).toBe('section')
      expect(Aglyn.canvas.getNode('section')!.nodes).toEqual([
        'markdown',
        'stack',
        'tail',
      ])
      expect(Aglyn.canvas.getNode('stack')!.nodes).toEqual(['img1', 'img2'])
    })
  })

  /**
   * Out, shift, in — the three actions together reach anywhere in the tree
   * by clicking, which is the claim AGL-1405 is really making.
   */
  it('reaches a different container by clicking alone', () => {
    moveNodeOut(Aglyn.canvas.getNode('img1')!.parent!)
    expect(Aglyn.canvas.getNode('section')!.nodes).toEqual([
      'markdown',
      'stack',
      'tail',
    ])

    // Shift the stack down past `tail`, then tuck it inside.
    Aglyn.canvas.reorderNode(Aglyn.canvas.getNode('stack')!, 2)
    expect(Aglyn.canvas.getNode('section')!.nodes).toEqual([
      'markdown',
      'tail',
      'stack',
    ])

    expect(moveNodeIn(Aglyn.canvas.getNode('stack')!).error).toBeUndefined()
    expect(Aglyn.canvas.getNode('tail')!.nodes).toEqual(['stack'])
    expect(Aglyn.canvas.getNode('stack')!.nodes).toEqual(['img1', 'img2'])
  })
})
