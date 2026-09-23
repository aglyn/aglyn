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

import {
  composeReusableComponentNodes,
  getInstanceAttrOverrides,
  getInstanceStyleOverrides,
  isAttrOverrideRefused,
  isDefinitionPlacement,
  isPlacedFormNode,
  PLACED_FORM_REFUSED_ATTR_PROPS,
  placementDefinitionFor,
  REUSABLE_INSTANCE_COMPONENT_ID,
  STYLE_OVERRIDES_ROOT_KEY,
} from './compose-reusable-components'
import { FORM_COMPONENT_ID, FORM_ID_PROP, placedFormPlacement } from './forms'

/**
 * A placed form carries the same two per-placement override layers a
 * reusable-component instance does (AGL-3285): one page may restyle or relabel
 * its copy of a form, and never change what the form submits.
 */

/** A design whose root is a container holding the fields. */
const containerDesign = {
  rootId: 'f-root',
  nodes: {
    'f-root': {
      $id: 'f-root',
      componentId: 'muiStack',
      nodes: ['f-email'],
      sx: { gap: 2 },
    },
    'f-email': {
      $id: 'f-email',
      componentId: 'formField',
      parentId: 'f-root',
      props: {
        fieldName: 'email',
        fieldType: 'email',
        label: 'Work email',
        required: true,
      },
      sx: { color: 'text.primary' },
    },
  },
} as any

/**
 * A design whose root IS a form naming the same form, the shape
 * `checkFormContract` requires — the graft unwraps it onto the placement.
 */
const selfNamingDesign = {
  rootId: 'root',
  nodes: {
    root: {
      $id: 'root',
      componentId: FORM_COMPONENT_ID,
      props: { [FORM_ID_PROP]: 'contact' },
      nodes: ['f-email'],
    },
    'f-email': {
      $id: 'f-email',
      componentId: 'formField',
      parentId: 'root',
      props: { fieldName: 'email', label: 'Work email' },
    },
  },
} as any

const placedForm = (overrides: Record<string, unknown> = {}) =>
  ({
    _root_: { $id: '_root_', componentId: 'div', nodes: ['form-node'] },
    'form-node': {
      $id: 'form-node',
      componentId: FORM_COMPONENT_ID,
      parentId: '_root_',
      props: { [FORM_ID_PROP]: 'contact' },
      nodes: [],
      ...overrides,
    },
  }) as any

const compose = (nodes: any, design: any) =>
  composeReusableComponentNodes(nodes, undefined, [
    placedFormPlacement({ contact: design }),
  ]) as Record<string, any>

describe('a placed form is a definition placement (AGL-3285)', () => {
  it('names a form bound to an entity, and nothing else', () => {
    expect(
      isPlacedFormNode({ componentId: 'form', props: { formId: 'f1' } }),
    ).toBe(true)
    expect(isPlacedFormNode({ componentId: 'form', props: {} })).toBe(false)
    expect(isPlacedFormNode({ componentId: 'form', props: { formId: '' } })).toBe(
      false,
    )
    expect(
      isDefinitionPlacement({ componentId: 'form', props: { formId: 'f1' } }),
    ).toBe(true)
    expect(
      isDefinitionPlacement({ componentId: REUSABLE_INSTANCE_COMPONENT_ID }),
    ).toBe(true)
    expect(isDefinitionPlacement({ componentId: 'muiBox' })).toBe(false)
  })

  it('reads an unbound form as carrying no overrides', () => {
    const unbound = {
      componentId: 'form',
      props: { formName: 'Contact' },
      styleOverrides: { root: { color: 'red' } },
      attrOverrides: { root: { submitLabel: 'Go' } },
    }
    expect(getInstanceStyleOverrides(unbound)).toEqual({})
    expect(getInstanceAttrOverrides(unbound)).toEqual({})
  })

  it('resolves its tree from the form designs, not the component map', () => {
    const node = { componentId: 'form', props: { formId: 'contact' } }
    expect(
      placementDefinitionFor(node, {
        definitions: { contact: containerDesign },
      }),
    ).toBeUndefined()
    expect(
      placementDefinitionFor(node, { formDesigns: { contact: containerDesign } }),
    ).toBe(containerDesign)
    // A design with no root among its nodes grafts nothing, so offers nothing.
    expect(
      placementDefinitionFor(node, {
        formDesigns: { contact: { rootId: 'gone', nodes: {} } as any },
      }),
    ).toBeUndefined()
  })
})

describe('style overrides on a placed form (AGL-3285)', () => {
  it('merges a root and a field override into the composed nodes', () => {
    const composed = compose(
      placedForm({
        styleOverrides: {
          [STYLE_OVERRIDES_ROOT_KEY]: { backgroundColor: '#eee' },
          'f-email': { color: 'primary.main' },
        },
      }),
      containerDesign,
    )

    // The design's root takes the placement's place and carries the root
    // slice over its own sx.
    expect(composed['form-node'].sx).toMatchObject({
      gap: 2,
      backgroundColor: '#eee',
    })
    // The field keeps its own sx and takes this page's slice over it.
    const field = composed['cmp__form-node__f-email']
    expect(field.sx).toMatchObject({ color: 'primary.main' })
    // The root slice does not leak onto a leaf.
    expect(field.sx.backgroundColor).toBeUndefined()
  })

  it('applies the root slice when the design root names the form itself', () => {
    const composed = compose(
      placedForm({
        styleOverrides: {
          [STYLE_OVERRIDES_ROOT_KEY]: { padding: 3 },
          'f-email': { color: 'primary.main' },
        },
      }),
      selfNamingDesign,
    )

    expect(composed['form-node'].componentId).toBe(FORM_COMPONENT_ID)
    // The design's root is unwrapped onto the placement, so the root slice
    // must land on the placement itself or it would never render.
    expect(composed['form-node'].sx).toEqual({ padding: 3 })
    expect(composed['cmp__form-node__f-email'].sx).toMatchObject({
      color: 'primary.main',
    })
  })

  it('leaves the form itself untouched for every other page', () => {
    compose(
      placedForm({ styleOverrides: { 'f-email': { color: 'red' } } }),
      containerDesign,
    )
    expect(containerDesign.nodes['f-email'].sx).toEqual({
      color: 'text.primary',
    })
  })
})

describe('attribute overrides on a placed form (AGL-3285)', () => {
  it("changes a field's label on this page", () => {
    const composed = compose(
      placedForm({ attrOverrides: { 'f-email': { label: 'Your email' } } }),
      containerDesign,
    )
    expect(composed['cmp__form-node__f-email'].props).toMatchObject({
      label: 'Your email',
      fieldName: 'email',
    })
  })

  it('refuses to rename, retype or un-require a field', () => {
    const composed = compose(
      placedForm({
        attrOverrides: {
          'f-email': {
            fieldName: 'contact_email',
            fieldType: 'text',
            required: false,
            label: 'Email',
          },
        },
      }),
      containerDesign,
    )
    expect(composed['cmp__form-node__f-email'].props).toEqual({
      fieldName: 'email',
      fieldType: 'email',
      label: 'Email',
      required: true,
    })
  })

  it('refuses the submission config on the form root', () => {
    const composed = compose(
      placedForm({
        attrOverrides: {
          [STYLE_OVERRIDES_ROOT_KEY]: {
            formId: 'other',
            datasetId: 'ds',
            redirectUrl: 'https://example.com',
            submitLabel: 'Send it',
          },
        },
      }),
      selfNamingDesign,
    )
    expect(composed['form-node'].props).toEqual({
      [FORM_ID_PROP]: 'contact',
      submitLabel: 'Send it',
    })
  })

  it('keeps the refusals to a placed form — an instance may still set them', () => {
    const form = { componentId: 'form', props: { formId: 'contact' } }
    const instance = { componentId: REUSABLE_INSTANCE_COMPONENT_ID }
    for (const prop of PLACED_FORM_REFUSED_ATTR_PROPS) {
      expect(isAttrOverrideRefused(form, prop)).toBe(true)
    }
    expect(isAttrOverrideRefused(instance, 'type')).toBe(false)
    expect(isAttrOverrideRefused(instance, 'sx')).toBe(true)
    expect(isAttrOverrideRefused(form, 'label')).toBe(false)
    expect(isAttrOverrideRefused(form, 'placeholder')).toBe(false)
  })
})

describe('a reusable instance is unchanged (AGL-3285 regression)', () => {
  const widget = {
    rootId: 'root',
    nodes: {
      root: { $id: 'root', componentId: 'muiStack', nodes: ['cta'] },
      cta: {
        $id: 'cta',
        componentId: 'muiButton',
        parentId: 'root',
        nodes: [],
        props: { variant: 'contained', type: 'button', name: 'go' },
        sx: { color: 'white' },
      },
    },
  } as any

  it('still takes style and attribute overrides, form refusals aside', () => {
    const composed = composeReusableComponentNodes(
      {
        a: {
          $id: 'a',
          componentId: REUSABLE_INSTANCE_COMPONENT_ID,
          props: { refId: 'widget' },
          styleOverrides: { cta: { color: 'black' } },
          attrOverrides: {
            cta: { variant: 'outlined', type: 'submit', name: 'send' },
          },
          nodes: [],
        },
      } as any,
      { widget },
      [placedFormPlacement({})],
    ) as Record<string, any>

    const cta = composed['cmp__a__cta']
    expect(cta.sx).toMatchObject({ color: 'black' })
    expect(cta.props).toEqual({
      variant: 'outlined',
      type: 'submit',
      name: 'send',
    })
  })
})
