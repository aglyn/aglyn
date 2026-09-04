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
 * A PLACED FORM RENDERS ITS ENTITY, ON THE PUBLISHED PAGE
 * (`docs/specs/reusable-forms.md`).
 *
 * Two properties are pinned here, and they pull in opposite directions:
 *
 * 1. A form bound to an entity with a published design renders THAT design,
 *    so editing the form once reaches every page placing it.
 * 2. Everything else renders exactly what it renders today. Every form on the
 *    live site predates the entity and holds its fields inline; a graft that
 *    fired on an unbound form, a missing entity or an unpublished one would
 *    empty a contact page in production.
 *
 * The cost gate is tested with the same weight as the output, because it is
 * the half nothing else would notice: this is the hot path of every published
 * page, and a forms read on pages that place no form is a collection query per
 * render bought for nothing.
 */

const mockGetPublishedLayoutVersion = jest.fn()
const mockGetComponents = jest.fn()
const mockGetVariables = jest.fn()
const mockGetFunctions = jest.fn()
const mockGetDatasets = jest.fn()
const mockGetWorkflows = jest.fn()
const mockGetPluginInstalls = jest.fn()
const mockGetForms = jest.fn()

jest.mock('./get-layout-version', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetPublishedLayoutVersion(...a),
}))
jest.mock('./get-components', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetComponents(...a),
}))
jest.mock('./get-forms', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetForms(...a),
}))
jest.mock('./get-datasets', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetDatasets(...a),
}))
jest.mock('./get-plugin-installs', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetPluginInstalls(...a),
}))
jest.mock('./get-variables', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetVariables(...a),
  getFunctions: (...a: unknown[]) => mockGetFunctions(...a),
  getWorkflows: (...a: unknown[]) => mockGetWorkflows(...a),
}))
jest.mock('./get-collection-content', () => ({
  __esModule: true,
  getPublishedCollectionSource: jest.fn(),
}))
jest.mock('./apply-publish-schedule', () => ({
  __esModule: true,
  default: jest.fn(),
}))
jest.mock('./get-screen-version', () => ({
  __esModule: true,
  default: jest.fn(),
}))

import { composeNodesWithChrome } from './compose-screen-nodes'

const ROOT = '_@_'

/** The published design: the fields the ENTITY owns. */
const CONTACT_DESIGN = {
  rootId: 'f-root',
  nodes: {
    'f-root': { $id: 'f-root', componentId: 'muiStack', nodes: ['f-email'] },
    'f-email': {
      $id: 'f-email',
      componentId: 'formField',
      parentId: 'f-root',
      props: { fieldName: 'email', label: 'Work email' },
    },
  },
}

/** A page with a form node holding the fields the PAGE drew (the live shape). */
const screenPlacingForm = (props: Record<string, unknown>) => ({
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['contact'] },
  contact: {
    $id: 'contact',
    componentId: 'form',
    parentId: ROOT,
    props,
    nodes: ['inline-name'],
  },
  'inline-name': {
    $id: 'inline-name',
    componentId: 'formField',
    parentId: 'contact',
    props: { fieldName: 'name', label: 'Your name' },
  },
})

const compose = (screenNodes: Record<string, unknown>) =>
  composeNodesWithChrome({ hostId: 'h1', screenNodes: screenNodes as never })

describe('placed forms on the published page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetPublishedLayoutVersion.mockResolvedValue({
      version: { nodes: {} },
      layout: {},
    })
    mockGetComponents.mockResolvedValue({ definitions: {} })
    mockGetVariables.mockResolvedValue([])
    mockGetFunctions.mockResolvedValue([])
    mockGetDatasets.mockResolvedValue([])
    mockGetWorkflows.mockResolvedValue([])
    mockGetPluginInstalls.mockResolvedValue([])
    mockGetForms.mockResolvedValue({ forms: { contact: CONTACT_DESIGN } })
  })

  it("renders the entity's fields, dropping the page's own copy", async () => {
    const nodes = await compose(screenPlacingForm({ formId: 'contact' }))

    // The entity's root takes the placement's place — no wrapper (AGL-2521).
    expect(nodes['cmp__contact__f-root']).toBeUndefined()
    expect(nodes['contact'].nodes).toEqual(['cmp__contact__f-email'])
    expect(nodes['cmp__contact__f-email']).toMatchObject({
      componentId: 'formField',
      props: { fieldName: 'email' },
    })
    expect(nodes['inline-name']).toBeUndefined()
  })

  it('leaves a form the entity cannot answer for exactly as published', async () => {
    // An unbound form, and one bound to an entity with no published design:
    // both are the live site today, and both must render what the page holds.
    mockGetForms.mockResolvedValue({ forms: {} })
    for (const props of [{ formName: 'Contact' }, { formId: 'contact' }]) {
      const nodes = await compose(screenPlacingForm(props))
      expect(nodes['contact'].nodes).toEqual(['inline-name'])
      expect(nodes['inline-name']).toMatchObject({
        props: { fieldName: 'name' },
      })
    }
  })

  it('does not read forms for a page that places none', async () => {
    await compose({
      [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['copy'] },
      copy: {
        $id: 'copy',
        componentId: 'muiTypography',
        parentId: ROOT,
        props: { children: 'No form here' },
      },
    })

    expect(mockGetForms).not.toHaveBeenCalled()
  })

  it('does not read forms for a form nobody bound to an entity', async () => {
    // The gate is the BINDING, not the component id: an inline form has no
    // entity to resolve, so the query would answer a question nobody asked.
    await compose(screenPlacingForm({ formName: 'Contact' }))

    expect(mockGetForms).not.toHaveBeenCalled()
  })

  it('resolves a form placed inside a reusable component', async () => {
    // The gate is re-asked against the COMPONENT-grafted tree: this form does
    // not exist in the screen's own nodes, so a gate that only looked there
    // would render a shared footer's signup form empty.
    mockGetComponents.mockResolvedValue({
      definitions: {
        footer: {
          rootId: 'd-root',
          nodes: {
            'd-root': {
              $id: 'd-root',
              componentId: 'muiStack',
              nodes: ['signup'],
            },
            signup: {
              $id: 'signup',
              parentId: 'd-root',
              componentId: 'form',
              props: { formId: 'contact' },
              nodes: [],
            },
          },
        },
      },
    })

    const nodes = await compose({
      [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['inst'] },
      inst: {
        $id: 'inst',
        componentId: 'reusableInstance',
        parentId: ROOT,
        props: { refId: 'footer' },
        nodes: [],
      },
    })

    expect(mockGetForms).toHaveBeenCalledTimes(1)
    const formNodeId = 'cmp__inst__signup'
    expect(nodes[`cmp__${formNodeId}__f-root`]).toBeUndefined()
    expect(nodes[formNodeId].nodes).toEqual([`cmp__${formNodeId}__f-email`])
    expect(nodes[`cmp__${formNodeId}__f-email`]).toMatchObject({
      props: { fieldName: 'email' },
    })
  })

  it('reads forms once for a page that places one on the screen itself', async () => {
    await compose(screenPlacingForm({ formId: 'contact' }))

    expect(mockGetForms).toHaveBeenCalledTimes(1)
  })
})
