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
  canvasTreeToDefinition,
  carryContactFieldMappings,
  checkFormContract,
  decodeStoredNodes,
  formContractIsSatisfied,
  formFieldDeclsFromNodes,
  type FormContractViolation,
  type FormFieldDecl,
  type NodeId,
} from '@aglyn/aglyn/server'

/** The canvas id a form's own node carries, matching the besigner's. */
const FORM_COMPONENT_ID = 'form'

/** A promotion that must not happen, and what to tell the author. */
export interface FormPromotionRefusal {
  status: number
  body: {
    error: string
    /**
     * The contract violations, when that is what refused it.
     *
     * The pure module's own shape, so a caller renders the same sentences the
     * besigner does without either side parsing prose. Absent on the two
     * refusals that are about the CANVAS rather than the contract.
     */
    violations?: FormContractViolation[]
  }
}

/** Exactly the fields a promotion writes onto the form document. */
export interface FormPromotionWrite {
  rootId?: string
  nodes: Record<string, any>
  fields: FormFieldDecl[]
}

/** Whether this answer is the refusal. */
export function isFormPromotionRefusal(
  result: FormPromotionWrite | FormPromotionRefusal,
): result is FormPromotionRefusal {
  return (result as FormPromotionRefusal).status !== undefined
}

/**
 * WHAT A PROMOTION WOULD WRITE, OR WHY IT MUST NOT HAPPEN.
 *
 * Promoting a form is not "copy the drawing onto the parent". A reusable
 * component's promotion is exactly that, because a component is only ever
 * DRAWN — the worst a bad one does is make a page ugly, and the page still
 * renders. A form is drawn AND it is a contract: `/api/forms/submit` keys
 * submissions on the id the form node carries, reads marketing consent out of
 * a field the document NAMES, and creates a lead from an address it expects to
 * find. Every one of those couplings is resolved by NAME at submit time, so
 * the design can break them, and every break is silent — the form renders, the
 * visitor submits, the row lands, and the thing the merchant believed they
 * were collecting is not there.
 *
 * So this decides, before any write exists to undo, and it decides in one
 * place because there are two ways to reach a promotion: the besigner's Save &
 * publish, and the version history on the form's own page. A second answer
 * would be a second chance to promote a design the check never saw.
 *
 * Pure, and separate from the route, so the refusal can be exercised on real
 * node maps rather than through a mocked Admin SDK — the property under test
 * is which trees it says no to, not how a 422 is serialized.
 *
 * @param options.form  the STORED form document. `routing` and
 *                      `consentFieldName` are what the check reads; the
 *                      stored `fields` are the previous design's output, not
 *                      a contract the new one owes anything to — except the
 *                      contact-field mappings drawn on them, which are
 *                      carried across by field name (AGL-2601).
 * @param options.storedNodes the version document's `nodes` in any stored
 *                      form — a besigner save writes them compressed.
 */
export function resolveFormPromotion(options: {
  formId: string
  form: Record<string, unknown> | null | undefined
  storedNodes: unknown
}): FormPromotionWrite | FormPromotionRefusal {
  const { formId, form, storedNodes } = options
  const decoded = decodeStoredNodes<Record<string, any>>(storedNodes)
  if (!decoded || !Object.keys(decoded).length) {
    return {
      status: 422,
      body: {
        error:
          'That version holds no design. Open it in the besigner and save ' +
          'once before publishing it.',
      },
    }
  }
  // Unwrap the synthetic canvas root: a placed form grafts from `rootId`, so
  // publishing the wrapper would put an always-empty container around every
  // instance (AGL-680).
  const definition = canvasTreeToDefinition(decoded)
  if (definition.ambiguousRoot) {
    return {
      status: 422,
      body: {
        error:
          'A form needs a single top-level element. Wrap what you have in ' +
          'one container, save, then publish.',
      },
    }
  }
  const nodes = definition.nodes as Record<string, any>
  const formNodeId = Object.keys(nodes).find(
    (nodeId) => nodes[nodeId]?.componentId === FORM_COMPONENT_ID,
  )
  const violations = checkFormContract({
    form: form as never,
    formId,
    nodes: nodes as never,
    formNodeId: formNodeId as NodeId | undefined,
  })
  if (!formContractIsSatisfied(violations)) {
    return {
      status: 422,
      body: {
        // The headline names the CONSEQUENCE; the violations name what to fix.
        error: 'This version would stop the submissions arriving',
        violations,
      },
    }
  }
  return {
    rootId: definition.rootId,
    nodes,
    /*
     * The DECLARATION publishes with the DESIGN.
     *
     * `fields` is what the submit route validates against and what the form's
     * consent-field picker offers; `nodes` is what the author drew. Writing
     * one without the other is how they drift, and the drift is exactly what
     * the check above just refused to ship — so the two go out in a single
     * write, derived from the same tree.
     *
     * `checkFormContract` reports `form-node-missing` when there is no form
     * node, so reaching here means this id resolved.
     *
     * Where each field SAVES TO is not drawn on the canvas — it is edited on
     * the form's page — so it is carried from the stored declaration by
     * field name, or every publish would unmap every field (AGL-2601).
     */
    fields: carryContactFieldMappings(
      form?.['fields'] as FormFieldDecl[] | undefined,
      formFieldDeclsFromNodes(nodes as never, formNodeId as NodeId),
    ),
  }
}

export default resolveFormPromotion
