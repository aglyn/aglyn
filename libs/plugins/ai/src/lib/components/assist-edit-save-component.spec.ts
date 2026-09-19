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
 * Saving a section as a reusable component (AGL-2908), client half, against
 * the REAL canvas singleton and the real editor-session seam — so "what the
 * document holds afterwards" is measured on the document the besigner would
 * save, not on a double that counts calls.
 *
 *  - ONE DOCUMENT CREATED, and it is the component. Everything else is an
 *    unsaved edit on the open canvas, which undo takes back.
 *  - DEFAULTS ARE TODAY'S VALUES, read off the fields the tokens replace, so
 *    the instance renders what was there. A `Hide …` starts at no.
 *  - NOTHING PUBLISHED. The live version is refused before the component is
 *    created, so a refusal leaves no orphan.
 *  - A CLOSED WORLD, checked again on the client: a binding outside the
 *    selection, or an element that changed since, refuses the whole apply.
 */

import { canvas, CANVAS_ROOT_ELEMENT_ID, REUSABLE_INSTANCE_COMPONENT_ID } from '@aglyn/aglyn'
import {
  registerEditorSession,
  resetEditorSessionsForTests,
  openEditorSession,
} from '@aglyn/aglyn/plugin-manager/editor-sessions'
import {
  applyAssistEdit,
  applyAssistEditSavingComponent,
  checkAssistEdit,
  type AssistEditCanvas,
  type AssistEditComponentWriter,
} from './assist-edit-canvas'
import {
  ASSIST_EDIT_ACTION_ID,
  summarizeAssistEditOps,
  type AssistEditProposal,
  type AssistEditSaveAsComponentOp,
} from '../model/assist-edit'

const ROOT = CANVAS_ROOT_ELEMENT_ID

/** The page the section sits on, as the canvas holds it. */
const PAGE = {
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['hero', 'feature'] },
  hero: { $id: 'hero', parentId: ROOT, componentId: 'muiStack', nodes: [] },
  feature: {
    $id: 'feature',
    parentId: ROOT,
    componentId: 'muiStack',
    nodes: ['heading', 'primary', 'secondary'],
    props: { direction: 'column' },
  },
  heading: {
    $id: 'heading',
    parentId: 'feature',
    componentId: 'muiTypography',
    nodes: [],
    props: { children: 'Ship faster, every week', variant: 'h2' },
  },
  primary: {
    $id: 'primary',
    parentId: 'feature',
    componentId: 'muiButton',
    nodes: [],
    props: { children: 'Start free', href: '/signup' },
  },
  secondary: {
    $id: 'secondary',
    parentId: 'feature',
    componentId: 'muiButton',
    nodes: [],
    props: { children: 'Talk to us', href: '/contact' },
  },
}

const SAVE: AssistEditSaveAsComponentOp = {
  op: 'saveAsComponent',
  nodeId: 'feature',
  componentId: 'muiStack',
  name: 'Feature section',
  props: [
    { name: 'headline', type: 'text', label: 'Headline' },
    { name: 'primaryLabel', type: 'text', label: 'Button label' },
    { name: 'primaryHref', type: 'href', label: 'Button link' },
    { name: 'hideSecondary', type: 'boolean', label: 'Hide the second button' },
  ],
  bindings: [
    { nodeId: 'heading', componentId: 'muiTypography', field: 'children', prop: 'headline' },
    { nodeId: 'primary', componentId: 'muiButton', field: 'children', prop: 'primaryLabel' },
    { nodeId: 'primary', componentId: 'muiButton', field: 'href', prop: 'primaryHref' },
    { nodeId: 'secondary', componentId: 'muiButton', field: 'hideIf', prop: 'hideSecondary' },
  ],
}

const proposalOf = (op: AssistEditSaveAsComponentOp = SAVE): AssistEditProposal => ({
  id: ASSIST_EDIT_ACTION_ID,
  summary: 'Each page sets the heading and the button, and can hide the second.',
  ops: [op],
  diff: summarizeAssistEditOps([op]),
  dropped: [],
  target: { kind: 'screen', documentId: 'screen-1', versionId: 'v-2', hostId: 'host-1' },
})

/** Every component the apply asked the resources route to create. */
let created: Array<Parameters<AssistEditComponentWriter['createComponent']>[0]> = []

const writer = (id = 'cmp-new', fail?: string): AssistEditComponentWriter => ({
  createComponent: async (input) => {
    created.push(input)
    if (fail) throw new Error(fail)
    return id
  },
})

function openEditor(options: { live?: boolean } = {}): () => void {
  return registerEditorSession({
    documentKind: 'screen',
    documentId: 'screen-1',
    versionId: 'v-2',
    isLiveVersion: () => options.live ?? false,
    selectedNodeId: () => 'feature',
  })
}

let unregister: () => void = () => undefined

beforeEach(() => {
  created = []
  resetEditorSessionsForTests()
  canvas.reset()
  canvas.setNodes(PAGE as never)
  unregister = openEditor()
})

afterEach(() => {
  unregister()
  resetEditorSessionsForTests()
  canvas.reset()
})

const surface = () => canvas as unknown as AssistEditCanvas

describe('the component the apply creates', () => {
  it('holds the promoted subtree with each bound field replaced by its token', async () => {
    const result = await applyAssistEditSavingComponent(
      surface(),
      proposalOf(),
      openEditorSession(),
      writer(),
    )
    expect(result.ok).toBe(true)
    expect(created).toHaveLength(1)
    const definition = created[0]
    expect(definition.name).toBe('Feature section')
    expect(definition.rootId).toBe('feature')
    expect(Object.keys(definition.nodes).sort()).toEqual(
      ['feature', 'heading', 'primary', 'secondary'].sort(),
    )
    // The root is cut loose from the page it was promoted out of.
    expect((definition.nodes['feature'] as any).parentId).toBeNull()
    expect((definition.nodes['heading'] as any).props).toMatchObject({
      children: '{{prop.headline}}',
      // What was not bound is untouched.
      variant: 'h2',
    })
    expect((definition.nodes['primary'] as any).props).toMatchObject({
      children: '{{prop.primaryLabel}}',
      href: '{{prop.primaryHref}}',
    })
    expect((definition.nodes['secondary'] as any).props).toMatchObject({
      hideIf: '{{prop.hideSecondary}}',
    })
  })

  it('takes each default off the page, so the instance renders what was there', async () => {
    await applyAssistEditSavingComponent(surface(), proposalOf(), openEditorSession(), writer())
    expect(created[0].props).toEqual([
      { name: 'headline', type: 'text', label: 'Headline', defaultValue: 'Ship faster, every week' },
      { name: 'primaryLabel', type: 'text', label: 'Button label', defaultValue: 'Start free' },
      { name: 'primaryHref', type: 'href', label: 'Button link', defaultValue: '/signup' },
      {
        name: 'hideSecondary',
        type: 'boolean',
        label: 'Hide the second button',
        // The part is on the page, so the property that hides it starts at no.
        defaultValue: false,
      },
    ])
  })

  it('refuses when a Choice’s current value is no longer one of its answers', async () => {
    const stale = {
      ...SAVE,
      props: [
        ...SAVE.props,
        {
          name: 'tone',
          type: 'choice' as const,
          label: 'Tone',
          options: [{ value: 'text' }, { value: 'outlined' }],
        },
      ],
      bindings: [
        ...SAVE.bindings,
        { nodeId: 'heading', componentId: 'muiTypography', field: 'variant', prop: 'tone' },
      ],
    }
    const result = await applyAssistEditSavingComponent(
      surface(),
      proposalOf(stale),
      openEditorSession(),
      writer(),
    )
    // `heading` is an h2, which the Choice does not offer.
    expect(result).toMatchObject({ ok: false, reason: 'stale' })
    expect(created).toEqual([])
  })
})

describe('what the open page keeps', () => {
  it('swaps the section for an instance that follows the new component', async () => {
    await applyAssistEditSavingComponent(surface(), proposalOf(), openEditorSession(), writer())
    expect(canvas.getNode('feature')).toMatchObject({
      componentId: REUSABLE_INSTANCE_COMPONENT_ID,
      props: { refId: 'cmp-new', name: 'Feature section' },
    })
    // The section's own elements are gone from the page: they live in the
    // component now.
    for (const id of ['heading', 'primary', 'secondary']) {
      expect([id, canvas.getNode(id)]).toEqual([id, undefined])
    }
    // Everything beside it is untouched, and the instance keeps its place.
    expect(canvas.getNode(ROOT)?.nodes).toEqual(['hero', 'feature'])
    expect(canvas.getNode('hero')).toBeTruthy()
  })

  it('is one undo step, and undo puts the section back', async () => {
    const before = JSON.stringify(canvas.toJSON())
    await applyAssistEditSavingComponent(surface(), proposalOf(), openEditorSession(), writer())
    expect(canvas.canUndo).toBe(true)
    canvas.undo()
    expect(JSON.stringify(canvas.toJSON())).toBe(before)
  })

  it('changes nothing at all when the component could not be created', async () => {
    const before = JSON.stringify(canvas.toJSON())
    const result = await applyAssistEditSavingComponent(
      surface(),
      proposalOf(),
      openEditorSession(),
      writer('cmp-new', 'Reusable components require a Starter plan — see Billing'),
    )
    expect(result).toMatchObject({ ok: false, reason: 'refused' })
    expect((result as { message: string }).message).toContain('Starter plan')
    expect(JSON.stringify(canvas.toJSON())).toBe(before)
    expect(canvas.canUndo).toBe(false)
  })
})

describe('nothing published, and a closed world', () => {
  it('refuses the version the live site serves before the component is created', async () => {
    unregister()
    unregister = openEditor({ live: true })
    const before = JSON.stringify(canvas.toJSON())
    const result = await applyAssistEditSavingComponent(
      surface(),
      proposalOf(),
      openEditorSession(),
      writer(),
    )
    expect(result).toMatchObject({ ok: false, reason: 'live-version' })
    // No orphan: the component was never created either.
    expect(created).toEqual([])
    expect(JSON.stringify(canvas.toJSON())).toBe(before)
  })

  it('refuses a binding on an element outside the section', async () => {
    const outside = {
      ...SAVE,
      bindings: [
        { nodeId: 'hero', componentId: 'muiStack', field: 'children', prop: 'headline' },
      ],
      props: [SAVE.props[0]],
    }
    expect(
      checkAssistEdit(surface(), proposalOf(outside), openEditorSession()),
    ).toMatchObject({ ok: false, reason: 'stale' })
    expect(created).toEqual([])
  })

  it('refuses when the selected element has changed since the proposal', async () => {
    const changed = { ...SAVE, componentId: 'muiBox' }
    const result = await applyAssistEditSavingComponent(
      surface(),
      proposalOf(changed),
      openEditorSession(),
      writer(),
    )
    expect(result).toMatchObject({ ok: false, reason: 'stale' })
    expect(created).toEqual([])
  })

  it('refuses a proposal that would promote the document itself', () => {
    const wholeDocument = { ...SAVE, nodeId: ROOT, componentId: 'div', bindings: [], props: [] }
    expect(
      checkAssistEdit(surface(), proposalOf(wholeDocument), openEditorSession()),
    ).toMatchObject({ ok: false, reason: 'stale' })
  })
})

describe('the two apply paths', () => {
  it('the synchronous apply leaves a component save alone rather than half-doing it', () => {
    const before = JSON.stringify(canvas.toJSON())
    const result = applyAssistEdit(surface(), proposalOf(), openEditorSession())
    // It reports the op applied and touches the canvas not at all: a save
    // needs a writer, and the widget's own apply is the one that has one.
    expect(result.ok).toBe(true)
    expect(JSON.stringify(canvas.toJSON())).toBe(before)
    expect(created).toEqual([])
  })

  it('the async apply falls back to the synchronous one when nothing is saved', async () => {
    const rename = {
      op: 'rename' as const,
      nodeId: 'heading',
      componentId: 'muiTypography',
      name: 'Headline',
    }
    const result = await applyAssistEditSavingComponent(
      surface(),
      { ...proposalOf(), ops: [rename], diff: summarizeAssistEditOps([rename]) },
      openEditorSession(),
      writer(),
    )
    expect(result).toMatchObject({ ok: true, opCounts: { rename: 1 } })
    expect(created).toEqual([])
    expect((canvas.getNode('heading') as { name?: string }).name).toBe('Headline')
  })

  it('counts the save under the word the activity row reads', async () => {
    const result = await applyAssistEditSavingComponent(
      surface(),
      proposalOf(),
      openEditorSession(),
      writer(),
    )
    expect(result).toMatchObject({ ok: true, opCounts: { component: 1 } })
  })
})
