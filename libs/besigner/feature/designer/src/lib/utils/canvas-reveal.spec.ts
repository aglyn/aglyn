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
import * as Besigner from '@aglyn/besigner'

import {
  isNodeHiddenOnSite,
  isNodeRevealedOnCanvas,
  nodePropsWithHiddenOnSite,
  toggleRevealedNodeId,
} from './canvas-reveal'

const HIDDEN = Aglyn.ELEMENT_HIDDEN_CLASS

/** wrapper > [trigger, panel > link], plus an unrelated hidden drawer. */
function seedCanvas() {
  Aglyn.canvas.reset()
  Aglyn.canvas.setNodes({
    [Aglyn.NODE_ROOT_ID]: {
      $id: Aglyn.NODE_ROOT_ID,
      componentId: 'div',
      nodes: ['wrapper', 'drawer'],
    },
    wrapper: {
      $id: 'wrapper',
      componentId: 'div',
      parentId: Aglyn.NODE_ROOT_ID,
      nodes: ['trigger', 'panel'],
    },
    trigger: {
      $id: 'trigger',
      componentId: 'div',
      parentId: 'wrapper',
      nodes: [],
    },
    panel: {
      $id: 'panel',
      componentId: 'div',
      parentId: 'wrapper',
      props: { className: HIDDEN },
      nodes: ['link'],
    },
    link: { $id: 'link', componentId: 'div', parentId: 'panel', nodes: [] },
    drawer: {
      $id: 'drawer',
      componentId: 'div',
      parentId: Aglyn.NODE_ROOT_ID,
      props: { className: `site-drawer ${HIDDEN}` },
      nodes: [],
    },
  } as never)
}

const node = ($id: string) => Aglyn.canvas.getNode($id)!
const select = ($id: string) => Besigner.focus.setSelectedNode(node($id))

describe('isNodeHiddenOnSite', () => {
  beforeEach(seedCanvas)

  it('reads the hidden class out of a multi-class list', () => {
    expect(isNodeHiddenOnSite(node('panel'))).toBe(true)
    expect(isNodeHiddenOnSite(node('drawer'))).toBe(true)
    expect(isNodeHiddenOnSite(node('wrapper'))).toBe(false)
    expect(isNodeHiddenOnSite(undefined)).toBe(false)
  })

  it('does not match a class that merely contains the name', () => {
    Aglyn.canvas.updateNodeProps(node('trigger'), {
      className: `${HIDDEN}-until-scroll`,
    })
    expect(isNodeHiddenOnSite(node('trigger'))).toBe(false)
  })
})

describe('isNodeRevealedOnCanvas (AGL-592)', () => {
  beforeEach(() => {
    seedCanvas()
    Besigner.focus.clearFocusStatus()
  })
  afterEach(() => Besigner.focus.clearFocusStatus())

  it('shows a node the author turned on, whatever the selection', () => {
    expect(isNodeRevealedOnCanvas(node('panel'), ['panel'])).toBe(true)
    expect(isNodeRevealedOnCanvas(node('drawer'), ['panel'])).toBe(false)
  })

  it('shows a panel while the selection sits anywhere in its parent', () => {
    for (const $id of ['wrapper', 'trigger', 'panel', 'link']) {
      Besigner.focus.clearSelection()
      select($id)
      expect(isNodeRevealedOnCanvas(node('panel'))).toBe(true)
    }
  })

  it('leaves every other hidden element alone', () => {
    select('panel')
    expect(isNodeRevealedOnCanvas(node('drawer'))).toBe(false)
  })

  // The stamp an ancestor carries reaches the root, so a check that walked
  // further up would open every hidden element on the page as soon as
  // anything at all was selected.
  it('does not treat a selection elsewhere on the page as a reveal', () => {
    select('trigger')
    expect(isNodeRevealedOnCanvas(node('drawer'))).toBe(false)
  })

  it('falls back to its own subtree when the parent is the root', () => {
    select('wrapper')
    expect(isNodeRevealedOnCanvas(node('drawer'))).toBe(false)
    Besigner.focus.clearSelection()
    select('drawer')
    expect(isNodeRevealedOnCanvas(node('drawer'))).toBe(true)
  })
})

describe('toggleRevealedNodeId', () => {
  it('adds, removes, and never mutates the list it is given', () => {
    const start: string[] = []
    const added = toggleRevealedNodeId(start, 'panel')
    expect(added).toEqual(['panel'])
    expect(start).toEqual([])

    const both = toggleRevealedNodeId(added, 'drawer')
    expect(both).toEqual(['panel', 'drawer'])

    const removed = toggleRevealedNodeId(both, 'panel')
    expect(removed).toEqual(['drawer'])
    expect(both).toEqual(['panel', 'drawer'])
  })

  it('starts from empty when nothing has been revealed yet', () => {
    expect(toggleRevealedNodeId(undefined, 'panel')).toEqual(['panel'])
  })
})

/**
 * The write behind "Hide on published site" — the control the
 * hidden class never had. Before this, the only way to author a panel that
 * starts hidden was to know the literal class name and type it in.
 */
describe('nodePropsWithHiddenOnSite', () => {
  const withClassName = (className?: string) =>
    ({ props: className === undefined ? {} : { className } }) as never

  it('adds the class, keeping the classes already there', () => {
    expect(nodePropsWithHiddenOnSite(withClassName('promo card'), true)).toEqual({
      className: `promo card ${HIDDEN}`,
    })
  })

  it('adds it to an element that carries no classes at all', () => {
    expect(nodePropsWithHiddenOnSite(withClassName(), true)).toEqual({
      className: HIDDEN,
    })
  })

  it('removes it and leaves the rest of the list intact', () => {
    expect(
      nodePropsWithHiddenOnSite(withClassName(`promo ${HIDDEN} card`), false),
    ).toEqual({ className: 'promo card' })
  })

  it('drops className entirely rather than storing an empty string', () => {
    // A cleared attribute persisted as `''` is its own class of bug across
    // this codebase; the key goes instead.
    expect(nodePropsWithHiddenOnSite(withClassName(HIDDEN), false)).toEqual({})
  })

  it('answers null when nothing would change, so no identical write is made', () => {
    expect(nodePropsWithHiddenOnSite(withClassName(HIDDEN), true)).toBeNull()
    expect(nodePropsWithHiddenOnSite(withClassName('promo'), false)).toBeNull()
    expect(nodePropsWithHiddenOnSite(null, true)).toBeNull()
  })

  it('never leaves a second copy of the class on the element', () => {
    const once = nodePropsWithHiddenOnSite(withClassName(), true)
    expect(nodePropsWithHiddenOnSite({ props: once } as never, true)).toBeNull()
  })

  it('carries the element other props through untouched', () => {
    const node = { props: { direction: 'row', spacing: 2 } } as never
    expect(nodePropsWithHiddenOnSite(node, true)).toEqual({
      direction: 'row',
      spacing: 2,
      className: HIDDEN,
    })
  })

  it('round-trips: what it writes is what isNodeHiddenOnSite reads', () => {
    const hidden = nodePropsWithHiddenOnSite(withClassName('promo'), true)
    expect(isNodeHiddenOnSite({ props: hidden } as never)).toBe(true)
    const shown = nodePropsWithHiddenOnSite({ props: hidden } as never, false)
    expect(isNodeHiddenOnSite({ props: shown } as never)).toBe(false)
  })
})
