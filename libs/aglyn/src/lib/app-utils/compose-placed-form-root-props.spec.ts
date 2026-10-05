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
  placementPropsOverRoot,
  REUSABLE_INSTANCE_COMPONENT_ID,
  STYLE_OVERRIDES_ROOT_KEY,
} from './compose-reusable-components'
import {
  FORM_COMPONENT_ID,
  FORM_ENTITY_OWNED_PROPS,
  FORM_ID_PROP,
  formPropsOnBind,
  placedFormPlacement,
} from './forms'

/**
 * A placed form renders the saved form's OWN root settings — its submit label,
 * success message and styling — with the placement's explicitly set props on
 * top, one prop at a time (AGL-3494).
 */

/**
 * A published form design: its root IS a form naming the same form, which is
 * the shape a form's publish writes (`canvasTreeToDefinition` unwraps the
 * canvas root) and `checkFormContract` requires.
 */
const savedForm = (rootExtras: Record<string, unknown> = {}) =>
  ({
    rootId: 'formRoot',
    nodes: {
      formRoot: {
        $id: 'formRoot',
        componentId: FORM_COMPONENT_ID,
        props: {
          [FORM_ID_PROP]: 'quote',
          formName: 'Quote request',
          submitLabel: 'Request a quote',
          successMessage: 'Thanks, we will call you within a day.',
        },
        sx: { gap: 2, '&:hover': { opacity: 0.9, outline: 'none' } },
        nodes: ['email', 'thanks'],
        ...rootExtras,
      },
      email: {
        $id: 'email',
        componentId: 'formField',
        parentId: 'formRoot',
        props: { fieldName: 'email', label: 'Email' },
      },
      thanks: {
        $id: 'thanks',
        componentId: 'muiTypography',
        parentId: 'formRoot',
        props: { children: 'See you soon' },
      },
    },
  }) as any

/** A page holding one placement of the saved form. */
const page = (placement: Record<string, unknown> = {}) =>
  ({
    _root_: { $id: '_root_', componentId: 'div', nodes: ['placed'] },
    placed: {
      $id: 'placed',
      componentId: FORM_COMPONENT_ID,
      parentId: '_root_',
      nodes: [],
      ...placement,
      props: {
        [FORM_ID_PROP]: 'quote',
        ...((placement['props'] as object | undefined) ?? {}),
      },
    },
  }) as any

const compose = (nodes: any, design: any = savedForm()) =>
  composeReusableComponentNodes(nodes, undefined, [
    placedFormPlacement({ quote: design }),
  ]) as Record<string, any>

describe('a placed form renders the saved form root settings (AGL-3494)', () => {
  it("shows the form's submit label, success message and styling", () => {
    const placed = compose(page())['placed']

    expect(placed.componentId).toBe(FORM_COMPONENT_ID)
    expect(placed.props).toEqual({
      [FORM_ID_PROP]: 'quote',
      formName: 'Quote request',
      submitLabel: 'Request a quote',
      successMessage: 'Thanks, we will call you within a day.',
    })
    expect(placed.sx).toEqual({
      gap: 2,
      '&:hover': { opacity: 0.9, outline: 'none' },
    })
  })

  it('follows an edit to the saved form on every page placing it', () => {
    const edited = savedForm()
    edited.nodes.formRoot.props.submitLabel = 'Get my free estimate'

    expect(compose(page(), edited)['placed'].props.submitLabel).toBe(
      'Get my free estimate',
    )
  })

  it('keeps the placement id, parent and the design fields', () => {
    const composed = compose(page())

    expect(composed['placed'].$id).toBe('placed')
    expect(composed['placed'].parentId).toBe('_root_')
    expect(composed['placed'].nodes).toEqual([
      'cmp__placed__email',
      'cmp__placed__thanks',
    ])
    expect(composed['cmp__placed__formRoot']).toBeUndefined()
  })
})

describe('a prop set on the placement overrides only that prop (AGL-3494)', () => {
  it('replaces the label and leaves the message to the form', () => {
    const placed = compose(page({ props: { submitLabel: 'Send it' } }))[
      'placed'
    ]

    expect(placed.props.submitLabel).toBe('Send it')
    expect(placed.props.successMessage).toBe(
      'Thanks, we will call you within a day.',
    )
  })

  it('keeps every copy an existing placement carries, as it rendered before', () => {
    const own = {
      formName: 'Contact',
      submitLabel: 'Send message',
      successMessage: 'Thanks — we will get back to you soon.',
      afterSubmit: 'message',
    }
    const placed = compose(page({ props: own }))['placed']

    expect(placed.props).toEqual({ [FORM_ID_PROP]: 'quote', ...own })
  })

  it('does not let an empty or null value mask the form', () => {
    const placed = compose(
      page({ props: { submitLabel: '', successMessage: null } }),
    )['placed']

    expect(placed.props.submitLabel).toBe('Request a quote')
    expect(placed.props.successMessage).toBe(
      'Thanks, we will call you within a day.',
    )
  })

  it('keeps false and 0 as real settings', () => {
    expect(
      placementPropsOverRoot({ noValidate: true, max: 5 }, {
        noValidate: false,
        max: 0,
      }),
    ).toEqual({ noValidate: false, max: 0 })
  })

  it('deep-merges sx: the form first, the placement over it', () => {
    const placed = compose(
      page({ sx: { gap: 4, '&:hover': { opacity: 1 }, maxWidth: 560 } }),
    )['placed']

    expect(placed.sx).toEqual({
      gap: 4,
      maxWidth: 560,
      '&:hover': { opacity: 1, outline: 'none' },
    })
  })

  it('lays a "this page only" root slice over both', () => {
    const placed = compose(
      page({
        props: { submitLabel: 'Send it' },
        sx: { gap: 4 },
        attrOverrides: {
          [STYLE_OVERRIDES_ROOT_KEY]: { submitLabel: 'Book now' },
        },
        styleOverrides: {
          [STYLE_OVERRIDES_ROOT_KEY]: { gap: 3, padding: 2 },
        },
      }),
    )['placed']

    expect(placed.props.submitLabel).toBe('Book now')
    expect(placed.props.successMessage).toBe(
      'Thanks, we will call you within a day.',
    )
    // The slice merges over the form's sx in the graft, and the placement's
    // own sx goes over that — the order the instance merge uses.
    expect(placed.sx).toMatchObject({ gap: 4, padding: 2 })
  })

  it('joins the classes of both, the form root first', () => {
    const placed = compose(
      page({ props: { className: 'aglyn-hidden quote' } }),
      savedForm({
        props: {
          [FORM_ID_PROP]: 'quote',
          className: 'quote card',
        },
      }),
    )['placed']

    expect(placed.props.className).toBe('quote card aglyn-hidden')
  })

  it('points a reveal target inside the form at its grafted id', () => {
    const design = savedForm()
    design.nodes.formRoot.props.afterSubmit = 'reveal'
    design.nodes.formRoot.props.revealNodeId = 'thanks'

    const placed = compose(page(), design)['placed']

    expect(placed.props.afterSubmit).toBe('reveal')
    expect(placed.props.revealNodeId).toBe('cmp__placed__thanks')
  })

  it("leaves the placement's own reveal target as the page wrote it", () => {
    const design = savedForm()
    design.nodes.formRoot.props.revealNodeId = 'thanks'

    const placed = compose(
      page({ props: { afterSubmit: 'reveal', revealNodeId: 'pageNote' } }),
      design,
    )['placed']

    expect(placed.props.revealNodeId).toBe('pageNote')
  })

  it('does not mutate the saved form', () => {
    const design = savedForm()
    compose(page({ props: { submitLabel: 'Send it' }, sx: { gap: 9 } }), design)

    expect(design.nodes.formRoot.props.submitLabel).toBe('Request a quote')
    expect(design.nodes.formRoot.sx.gap).toBe(2)
  })
})

describe('a component instance keeps its documented merge (AGL-3494)', () => {
  it("draws the component root's props, with the placement's sx over its own", () => {
    const composed = composeReusableComponentNodes(
      {
        hero: {
          $id: 'hero',
          componentId: REUSABLE_INSTANCE_COMPONENT_ID,
          props: { refId: 'banner', name: 'Banner' },
          sx: { padding: 4 },
          nodes: [],
        },
      } as any,
      {
        banner: {
          rootId: 'root',
          nodes: {
            root: {
              $id: 'root',
              componentId: 'muiStack',
              props: { direction: 'row' },
              sx: { padding: 2, gap: 1 },
              nodes: [],
            },
          },
        },
      } as any,
    ) as Record<string, any>

    expect(composed['hero'].componentId).toBe('muiStack')
    expect(composed['hero'].props).toEqual({ direction: 'row' })
    expect(composed['hero'].sx).toEqual({ padding: 4, gap: 1 })
  })
})

describe('picking a saved form drops what the node started with (AGL-3494)', () => {
  const preset = {
    formName: 'Contact',
    submitLabel: 'Send message',
    successMessage: 'Thanks — we will get back to you soon.',
    className: 'contact',
  }

  it("clears the form's own settings when a form is first picked", () => {
    expect(formPropsOnBind(preset, { ...preset, formId: 'quote' })).toEqual({
      formId: 'quote',
      className: 'contact',
    })
  })

  it('clears them again when the node switches to another form', () => {
    expect(
      formPropsOnBind(
        { formId: 'quote', submitLabel: 'Go' },
        { formId: 'other', submitLabel: 'Go' },
      ),
    ).toEqual({ formId: 'other' })
  })

  it('keeps a label set on an existing placement of the same form', () => {
    const props = { formId: 'quote', submitLabel: 'Send it' }
    expect(formPropsOnBind({ formId: 'quote' }, props)).toBe(props)
  })

  it('touches nothing when no form is picked or the form is unpicked', () => {
    expect(formPropsOnBind({}, preset)).toBe(preset)
    const unpicked = { ...preset, formId: '' }
    expect(formPropsOnBind({ formId: 'quote' }, unpicked)).toBe(unpicked)
  })

  it('names exactly the settings a Form root owns', () => {
    expect([...FORM_ENTITY_OWNED_PROPS].sort()).toEqual(
      [
        'afterSubmit',
        'datasetId',
        'datasetName',
        'formName',
        'redirectScreenId',
        'redirectUrl',
        'revealNodeId',
        'submitLabel',
        'successMessage',
      ].sort(),
    )
    expect(FORM_ENTITY_OWNED_PROPS).not.toContain(FORM_ID_PROP)
  })
})
