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

import { composeReusableComponentNodes } from './compose-reusable-components'
import { FORM_COMPONENT_ID, FORM_ID_PROP, placedFormPlacement } from './forms'

/**
 * A placed form node, as a screen carries one.
 */
const placedForm = (id: string, formId: string, children: string[] = []) => ({
  $id: id,
  componentId: FORM_COMPONENT_ID,
  props: { [FORM_ID_PROP]: formId },
  nodes: children,
})

/**
 * A form entity's published design.
 *
 * Its root IS a form node naming the same form, because `checkFormContract`
 * requires exactly that — which is what makes self-reference the normal case
 * here rather than an authoring mistake.
 */
const selfNamingDesign = (formId: string) => ({
  rootId: 'root',
  nodes: {
    root: placedForm('root', formId, ['field']),
    field: {
      $id: 'field',
      componentId: 'muiTextField',
      props: { name: 'email' },
      nodes: [] as string[],
    },
  },
})

/** Every node in the composed tree that renders as a `<form>`. */
const formNodes = (composed: Record<string, any>) =>
  Object.entries(composed).filter(
    ([, node]) => node?.componentId === FORM_COMPONENT_ID,
  )

describe('a placed form does not graft into its own subtree', () => {
  it('produces exactly one form node, not one per expansion pass', () => {
    const composed = composeReusableComponentNodes(
      { page: placedForm('page', 'f1') } as any,
      undefined,
      [placedFormPlacement({ f1: selfNamingDesign('f1') } as any)],
    ) as Record<string, any>

    // Before the guard this was 6 — the authored node plus one per pass up to
    // MAX_COMPONENT_DEPTH. Nested `<form>` is invalid HTML, so the SSR parser
    // dropped the inner ones and hydration failed against the client tree.
    expect(formNodes(composed)).toHaveLength(1)
  })

  it('still grafts the design once, so the fields do render', () => {
    const composed = composeReusableComponentNodes(
      { page: placedForm('page', 'f1') } as any,
      undefined,
      [placedFormPlacement({ f1: selfNamingDesign('f1') } as any)],
    ) as Record<string, any>

    const fields = Object.values(composed).filter(
      (node: any) => node?.componentId === 'muiTextField',
    )
    // Exactly one: bounding the recursion must not cost the graft itself, and
    // a duplicated field would carry a duplicate `name` into the submission.
    expect(fields).toHaveLength(1)
  })

  it('leaves the self-naming node in place rather than pruning it', () => {
    const composed = composeReusableComponentNodes(
      { page: placedForm('page', 'f1') } as any,
      undefined,
      [placedFormPlacement({ f1: selfNamingDesign('f1') } as any)],
    ) as Record<string, any>

    // An unexpanded ref renders its own children, the same as an unresolvable
    // one. Dropping it would take the fields off a published page.
    expect(composed['page']).toBeDefined()
  })

  it('a DIFFERENT form placed inside a form still expands', () => {
    const outer = {
      rootId: 'root',
      nodes: {
        root: placedForm('root', 'f1', ['inner']),
        inner: placedForm('inner', 'f2'),
      },
    }
    const inner = {
      rootId: 'root',
      nodes: {
        root: placedForm('root', 'f2', ['deep']),
        deep: {
          $id: 'deep',
          componentId: 'muiTextField',
          props: { name: 'note' },
          nodes: [] as string[],
        },
      },
    }

    const composed = composeReusableComponentNodes(
      { page: placedForm('page', 'f1') } as any,
      undefined,
      [placedFormPlacement({ f1: outer, f2: inner } as any)],
    ) as Record<string, any>

    // The guard is keyed on the definition, not on "a form inside a form" —
    // narrowing it to the latter would switch off a legitimate composition.
    const deep = Object.values(composed).filter(
      (node: any) => node?.props?.name === 'note',
    )
    expect(deep).toHaveLength(1)
  })
})
