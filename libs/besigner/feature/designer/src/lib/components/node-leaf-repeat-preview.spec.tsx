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
 * The canvas draws a repeat's copies, bounded exactly as the page is, and
 * badges the element (AGL-3111).
 *
 * The two halves are one spec on purpose: a preview that drew a row the page
 * would not render, or a count the page would not reach, is worse than no
 * preview at all — the author would design against data that never ships.
 */

import * as Aglyn from '@aglyn/aglyn'
import {
  REPEAT_MAX_RECORDS,
  type RepeatableDataset,
} from '@aglyn/aglyn/app-utils/expand-repeatables'
import { Leaf } from '@aglyn/aglyn-node-renderer'
import * as Besigner from '@aglyn/besigner'
import { fireEvent, render } from '@testing-library/react'

import NodeLeaf from './node-leaf'
import { repeatTemplateIdOf } from '../utils/repeat-copy'
import {
  attributeFocusRequest,
  clearAttributeFocusRequest,
} from '../utils/attribute-focus-request'
import {
  RepeatRowsContext,
  type RepeatRowsSource,
} from '../contexts/repeat-rows-context'
import {
  registerRepeatSource,
  type RepeatRowsAnswer,
  type RepeatSource,
} from '@aglyn/aglyn/app-utils/repeat-sources'

/**
 * Which prop holds a repeat's key belongs to the SOURCE, so the canvas knows
 * an element repeats only once something has registered one. Registered for
 * the whole file: without it every element here repeats over nothing, which
 * is itself the behavior the last case in the first block pins.
 */
const TEST_SOURCE: RepeatSource = {
  id: 'test-rows',
  label: 'Rows',
  keyProp: 'repeatDataset',
  keyAttribute: {
    component: Aglyn.FieldComponentType.TEXT_FIELD,
    label: 'Repeat over rows',
  },
  // The host app's reader calls this; these tests answer from the store
  // directly, so it is never reached.
  useRows: () => ({ status: 'loading' }),
}

const TEAM: RepeatableDataset = {
  records: [
    { $id: 'r1', name: 'Ada', role: 'Engineer' },
    { $id: 'r2', name: 'Grace', role: 'Admiral' },
    { $id: 'r3', name: 'Katherine', role: 'Mathematician' },
  ],
}

/** A store that has already answered, so no read is involved in the test. */
const answered = (
  answer: RepeatRowsAnswer,
): RepeatRowsSource & { held: string[] } => {
  const held: string[] = []
  return {
    held,
    get: () => answer,
    getVersion: () => 1,
    subscribe: () => () => undefined,
    retain: (request) => {
      held.push(`${request.sourceId} ${request.key}`)
      return () => undefined
    },
  }
}

const READY = (label = 'Team'): RepeatRowsAnswer => ({
  status: 'ready',
  label,
  rowsByKey: { Team: TEAM },
})

/** `muiStack`-shaped list whose one child is the item template. */
const listNodes = (props: Record<string, unknown>) =>
  ({
    list: {
      $id: 'list',
      type: 'node',
      componentId: 'div',
      parentId: '_@_',
      props,
      nodes: ['row'],
    },
    row: {
      $id: 'row',
      type: 'node',
      componentId: 'div',
      parentId: 'list',
      props: { children: '{{item.name}}' },
    },
  }) as any

/**
 * The canvas these nodes are on: its whole-page snapshot, and each node by id,
 * which is how the copies read what they repeat. Restored together.
 */
const withCanvas = (nodes: Record<string, any>) => {
  const json = jest
    .spyOn(Aglyn.canvas, 'toJSON')
    .mockReturnValue({ nodes } as never)
  const byId = jest
    .spyOn(Aglyn.canvas, 'getNode')
    .mockImplementation(((id: string) => nodes[id]) as never)
  return {
    mockRestore: () => {
      json.mockRestore()
      byId.mockRestore()
    },
  } as unknown as jest.SpyInstance
}

/** Renders the canvas leaf for `list`, with its one real child inside. */
const renderList = (
  source: RepeatRowsSource | undefined,
  nodes: Record<string, any>,
) =>
  render(
    <RepeatRowsContext.Provider value={source}>
      <NodeLeaf node={nodes['list']}>
        <NodeLeaf node={nodes['row']} />
      </NodeLeaf>
    </RepeatRowsContext.Provider>,
  )

let unregister: () => void
beforeAll(() => {
  unregister = registerRepeatSource(TEST_SOURCE)
})
afterAll(() => unregister())

/**
 * The copies, drawn as siblings of the real children (no wrapper, so they sit
 * in the parent's own layout), each root marked as a copy.
 */
const copies = (root: HTMLElement) => {
  const roots = Array.from(root.querySelectorAll('[data-aglyn-repeat-copy]'))
  return roots.length
    ? { roots, textContent: roots.map((el) => el.textContent).join('') }
    : null
}
const badge = (root: HTMLElement) =>
  root.querySelector('[data-aglyn-repeat-badge]')

describe('the canvas preview is bounded exactly as the runtime is', () => {
  let canvasJson: jest.SpyInstance
  afterEach(() => canvasJson?.mockRestore())

  it('draws one copy per record — the template being the first', () => {
    const nodes = listNodes({ repeatDataset: 'Team' })
    canvasJson = withCanvas(nodes)
    const { baseElement } = renderList(answered(READY()), nodes)
    // Three records: the real child drawing the first, and two pictures.
    expect(copies(baseElement)?.textContent).toBe('GraceKatherine')
    // The template itself renders the FIRST record rather than its token, so
    // the element an author edits reads as the first copy.
    expect(baseElement.textContent?.startsWith('Ada')).toBe(true)
  })

  it('honors the limit the node stores', () => {
    const nodes = listNodes({ repeatDataset: 'Team', repeatLimit: 2 })
    canvasJson = withCanvas(nodes)
    const { baseElement } = renderList(answered(READY()), nodes)
    expect(copies(baseElement)?.textContent).toBe('Grace')
    expect(badge(baseElement)?.textContent).toContain('2 records')
  })

  it('honors the filter and the sort the node stores', () => {
    const nodes = listNodes({
      repeatDataset: 'Team',
      repeatSort: 'name desc',
      repeatFilter: 'role != Admiral',
    })
    canvasJson = withCanvas(nodes)
    const { baseElement } = renderList(answered(READY()), nodes)
    // Ada and Katherine, descending: Katherine is the template's record.
    expect(copies(baseElement)?.textContent).toBe('Ada')
    expect(baseElement.textContent?.startsWith('Katherine')).toBe(true)
  })

  it('never draws past REPEAT_MAX_RECORDS, whatever the limit asks for', () => {
    const many: RepeatableDataset = {
      records: Array.from({ length: REPEAT_MAX_RECORDS + 40 }, (_v, index) => ({
        $id: `r${index}`,
        name: `row ${index}`,
      })),
    }
    const nodes = listNodes({ repeatDataset: 'Team', repeatLimit: 500 })
    canvasJson = withCanvas(nodes)
    const { baseElement } = renderList(
      answered({ status: 'ready', label: 'Team', rowsByKey: { Team: many } }),
      nodes,
    )
    expect(badge(baseElement)?.textContent).toContain(
      `${REPEAT_MAX_RECORDS} records`,
    )
    expect(copies(baseElement)?.roots).toHaveLength(REPEAT_MAX_RECORDS - 1)
  })

  it('draws the template once when nothing has answered', () => {
    const nodes = listNodes({ repeatDataset: 'Team' })
    canvasJson = withCanvas(nodes)
    const { baseElement } = renderList(
      answered({ status: 'loading' }),
      nodes,
    )
    expect(copies(baseElement)).toBeNull()
    expect(badge(baseElement)).toBeNull()
    // The token stays a token: nothing is known to put in its place.
    expect(baseElement.textContent).toContain('{{item.name}}')
  })

  it('draws the template once when no host app reads rows at all', () => {
    const nodes = listNodes({ repeatDataset: 'Team' })
    canvasJson = withCanvas(nodes)
    const { baseElement } = renderList(undefined, nodes)
    expect(copies(baseElement)).toBeNull()
    expect(badge(baseElement)).toBeNull()
  })

  /**
   * AGL-3496: the published page renders a repeat with no rows ZERO times.
   * The canvas keeps the template — it is what the author edits — and says
   * on the badge that the live site shows none of it.
   */
  it('keeps the template and flags it when the filter matches nothing', () => {
    const nodes = listNodes({ repeatDataset: 'Team', repeatFilter: 'role == Pilot' })
    canvasJson = withCanvas(nodes)
    const { baseElement } = renderList(answered(READY()), nodes)
    expect(copies(baseElement)).toBeNull()
    // The template's token is drawn as a named chip, not raw braces.
    const token = baseElement.querySelector('[data-aglyn-token-chip]')
    expect(token?.getAttribute('title')).toBe('{{item.name}}')
    const chip = badge(baseElement)
    expect(chip?.textContent).toContain('no records match')
    expect(chip?.textContent).toContain('not shown on your site')
    expect(chip?.hasAttribute('data-aglyn-repeat-empty')).toBe(true)
  })

  it('keeps the template and flags it when the dataset is not found', () => {
    const nodes = listNodes({ repeatDataset: 'Team' })
    canvasJson = withCanvas(nodes)
    const { baseElement } = renderList(answered({ status: 'missing' }), nodes)
    expect(copies(baseElement)).toBeNull()
    expect(
      baseElement.querySelector('[data-aglyn-token-chip]')?.textContent,
    ).toBe('Name')
    // The source's own label: a missing answer carries none of its own.
    expect(badge(baseElement)?.textContent).toContain('Rows not available')
    expect(badge(baseElement)?.textContent).toContain('not shown on your site')
    // Hovering it says why, and where the fix is.
    expect(badge(baseElement)?.getAttribute('title')).toMatch(
      /Repeat over dataset/,
    )
  })

  it('draws no badge when the read failed — nothing is known', () => {
    const nodes = listNodes({ repeatDataset: 'Team' })
    canvasJson = withCanvas(nodes)
    const { baseElement } = renderList(answered({ status: 'error' }), nodes)
    expect(badge(baseElement)).toBeNull()
  })

  it('holds nothing for an element that repeats over nothing', () => {
    const nodes = listNodes({})
    canvasJson = withCanvas(nodes)
    const source = answered(READY())
    renderList(source, nodes)
    expect(source.held).toEqual([])
  })
})

describe('the repeat badge is editor-only (AGL-3111)', () => {
  let canvasJson: jest.SpyInstance
  afterEach(() => canvasJson?.mockRestore())

  it('names what is repeated and how many records', () => {
    const nodes = listNodes({ repeatDataset: 'Team' })
    canvasJson = withCanvas(nodes)
    const { baseElement } = renderList(answered(READY('Team roster')), nodes)
    expect(badge(baseElement)?.textContent).toContain('Team roster')
    expect(badge(baseElement)?.textContent).toContain('3 records')
  })

  it('is hidden from assistive technology, and a press on it opens the setting it names', () => {
    const nodes = listNodes({ repeatDataset: 'Team' })
    canvasJson = withCanvas(nodes)
    const { baseElement } = renderList(answered(READY()), nodes)
    const chip = badge(baseElement) as HTMLElement
    expect(chip.getAttribute('aria-hidden')).toBe('true')
    expect(chip.getAttribute('title')).toBeTruthy()
    // The press (not the click — the selection's overlay covers the badge
    // before the release) asks the Attributes panel for the repeat setting.
    clearAttributeFocusRequest()
    fireEvent.pointerDown(chip, { button: 0 })
    expect(attributeFocusRequest.get()).toEqual({
      nodeId: 'list',
      field: 'repeatDataset',
    })
    clearAttributeFocusRequest()
  })

  /**
   * The published page composes stored nodes and renders them through the
   * plain `Leaf`. Only `NodeLeaf` — the besigner's own leaf — draws the badge
   * or the copies, so neither can reach a visitor however the node is stored.
   */
  it('is drawn by no renderer a published page uses', () => {
    const nodes = listNodes({ repeatDataset: 'Team' })
    canvasJson = withCanvas(nodes)
    const { baseElement } = render(
      <RepeatRowsContext.Provider value={answered(READY())}>
        <Leaf node={nodes['list']}>
          <Leaf node={nodes['row']} />
        </Leaf>
      </RepeatRowsContext.Provider>,
    )
    expect(badge(baseElement)).toBeNull()
    expect(copies(baseElement)).toBeNull()
  })
})

/**
 * A click on one of the copies means the element that copy draws — the one an
 * author edits to change every copy. It used to pass straight through the
 * copies and select whatever lay beneath: the parent Stack.
 */
describe('a click on a copy', () => {
  let canvasJson: jest.SpyInstance
  let getNode: jest.SpyInstance
  afterEach(() => {
    canvasJson?.mockRestore()
    getNode?.mockRestore()
    Besigner.focus.clearSelection()
  })

  const graceIn = (root: HTMLElement) =>
    copies(root)?.roots.find((el) => el.textContent === 'Grace') as HTMLElement

  it('selects the element the copy draws, not the copy or what lies beneath', () => {
    const nodes = listNodes({ repeatDataset: 'Team' })
    canvasJson = withCanvas(nodes)
    getNode = jest
      .spyOn(Aglyn.canvas, 'getNode')
      .mockImplementation((id: any) => nodes[id])
    const { baseElement } = renderList(answered(READY()), nodes)
    fireEvent.pointerDown(graceIn(baseElement))
    expect(Besigner.focus.getLastSelected()?.$id).toBe('row')
  })
})

describe('the copies sit in the layout the live page gives them', () => {
  let canvasJson: jest.SpyInstance
  afterEach(() => canvasJson?.mockRestore())

  it('draws each copy as a sibling of the real child, hidden from assistive technology', () => {
    const nodes = listNodes({ repeatDataset: 'Team' })
    canvasJson = withCanvas(nodes)
    const { baseElement } = renderList(answered(READY()), nodes)
    const found = copies(baseElement)
    expect(found?.roots).toHaveLength(2)
    const real = Array.from(baseElement.querySelectorAll('[data-aglyn]')).find(
      (el) => el.getAttribute('data-aglyn') === 'leaf:row',
    )
    for (const copy of found?.roots ?? []) {
      // Same parent as the real child: one layout, the page's.
      expect(copy.parentElement).toBe(real?.parentElement)
      expect(copy.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('redraws the copies when what they copy is edited', () => {
    const nodes = listNodes({ repeatDataset: 'Team' })
    canvasJson = withCanvas(nodes)
    const source = answered(READY())
    const { baseElement, rerender } = renderList(source, nodes)
    expect(copies(baseElement)?.textContent).not.toContain('more')
    // The template's text is retyped; the copies are pictures of it.
    nodes['row'] = {
      ...nodes['row'],
      props: { ...nodes['row'].props, children: '{{item.name}} more' },
    }
    rerender(
      <RepeatRowsContext.Provider value={source}>
        <NodeLeaf node={nodes['list']}>
          <NodeLeaf node={nodes['row']} />
        </NodeLeaf>
      </RepeatRowsContext.Provider>,
    )
    for (const copy of copies(baseElement)?.roots ?? []) {
      expect(copy.textContent).toMatch(/ more$/)
    }
  })
})

describe('repeatTemplateIdOf', () => {
  it('names the original under any number of repeat prefixes', () => {
    expect(repeatTemplateIdOf('rep__list__1__row')).toBe('row')
    expect(repeatTemplateIdOf('rep__outer__2__rep__list__0__row')).toBe('row')
    expect(repeatTemplateIdOf('row')).toBe('row')
  })
})
