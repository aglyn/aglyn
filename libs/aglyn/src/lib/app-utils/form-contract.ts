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
 * What a form's DESIGN must still satisfy for its submissions to arrive.
 *
 * A reusable component is only ever drawn: the worst an author can do to one
 * is make it ugly, and the page still renders. A form is drawn AND it is a
 * contract — `/api/forms/submit` keys submissions on its id, reads consent out
 * of a field it names, and creates a lead from an address it expects to find.
 * Every one of those couplings is resolved by NAME at submit time, so the
 * design can break them, and breaking them is silent in every case: the form
 * still renders, the visitor still submits, the row still lands, and the thing
 * the merchant believed they were collecting is simply not there.
 *
 * That asymmetry is the whole reason this module exists. Publishing a form is
 * not "save the drawing"; it is "promise the server can still read this".
 *
 * ## The six silent failures, and why each one is checked here
 *
 * Every check below corresponds to something a design can do that produces NO
 * error at submit time. A design that fails loudly needs no guard — the author
 * finds out. These are the ones where nobody finds out.
 *
 *  1. **The form node stops naming this form.** Submissions carry `formId` and
 *     the route stamps it only after verifying it against this host's forms;
 *     the Inbox's per-form list is an equality on it. Clear or rebind it and
 *     every later submission is unattributable — while still landing in the
 *     Inbox, so nothing looks broken and the form's own list just stops
 *     growing.
 *  2. **A field with no name.** `formFieldDeclsFromNodes` drops it, and the
 *     runtime falls back to `name = fieldName || 'field'`, so several unnamed
 *     inputs collapse onto ONE submission key. The visitor types, the value is
 *     posted, and it is not retrievable under any name the author knows.
 *  3. **Two fields sharing a name.** `FormData` joins entries under one key,
 *     so the second input contributes no separate value and the declaration
 *     keeps only the first. Two questions, one answer.
 *  4. **Lead routing with nothing to extract an address from.**
 *     `routing.lead` only ever fires when `extractEmailFromFields` finds one,
 *     and that prefers a key matching `/email/i` before falling back to any
 *     email-shaped value. A form with no such field can still route to leads
 *     on paper and never create one.
 *  5. **Lead routing with nothing that records consent.** The route files
 *     the lead either way, and stamps an opt-in on it only from the field the
 *     form declares or from an undeclared field on the closed name list it
 *     falls back to. A form with neither files leads nobody may email — the
 *     send-time consent join refuses every one — so the sales team works a
 *     list the campaigns cannot reach, and nothing at submit time says so.
 *  6. **A consent field that no longer exists.** `readFormDeclaredConsent`
 *     looks up exactly `consentFieldName`. Rename or delete that field and it
 *     returns `false` forever — the form keeps collecting the tick and the
 *     opt-in stops being recorded. This is the one with consequences outside
 *     the product, since an advertising basis that quietly stops is
 *     indistinguishable downstream from one that was never given.
 *
 * ## What is NOT checked
 *
 * Anything the author can see. A missing label, an empty select, a field in
 * the wrong order — those are visible on the canvas and are the author's to
 * judge. This module is only for couplings that are invisible at design time
 * and asymptomatic at run time.
 *
 * Pure and dependency-free, like `forms.ts` beside it: it reaches client
 * bundles through `app-utils/index`, so nothing here may import a Node
 * builtin.
 */

import type {
  AglynNodeSchema,
  NodeId,
} from '../foundation/definitions/components.types'
import {
  collectFormFieldNodeIds,
  type FormDocument,
  isMarketingConsentFieldName,
} from './forms'

/**
 * Which coupling a violation is about.
 *
 * A code rather than a message so a caller can decide presentation — the
 * besigner shows these beside the offending node, the API route puts them in
 * a 422 body — without either one parsing prose.
 */
export type FormContractViolationCode =
  | 'form-node-missing'
  | 'form-id-unbound'
  | 'field-unnamed'
  | 'field-name-duplicated'
  | 'lead-routing-has-no-email-field'
  | 'lead-routing-has-no-consent-field'
  | 'consent-field-missing'

/** One way this design would fail to keep the server's side of the bargain. */
export interface FormContractViolation {
  code: FormContractViolationCode
  /** The node the author has to fix, when a single node is at fault. */
  nodeId?: NodeId
  /** The name at issue, for the two checks that are about names. */
  fieldName?: string
  /** Author-facing, and stated as the CONSEQUENCE rather than the rule. */
  message: string
}

/** A field as the design declares it, before any de-duplication. */
interface DrawnField {
  nodeId: NodeId
  fieldName: string
  fieldType: string
}

/**
 * `extractEmailFromFields` prefers a key matching this before falling back to
 * any email-shaped value. Restated rather than imported so this module stays
 * free of `contacts.ts`; {@link EMAIL_KEY_PATTERN} and that function agreeing
 * is asserted in the spec rather than assumed.
 */
const EMAIL_KEY_PATTERN = /email/i

/**
 * Reads the fields a design draws, keeping every one of them.
 *
 * Deliberately NOT `formFieldDeclsFromNodes`. That function drops an unnamed
 * field and the second of a duplicate pair, which is right for adoption — it
 * describes what a page already submits — and useless here, because the
 * dropped ones are precisely what this module has to report. Asking it would
 * be asking a question whose answer has the evidence removed from it.
 */
function drawnFields(
  nodes: Record<NodeId, AglynNodeSchema | undefined> | undefined | null,
  formNodeId: NodeId,
  formFieldComponentId: string,
): DrawnField[] {
  return collectFormFieldNodeIds(nodes, formNodeId, formFieldComponentId).map(
    (nodeId) => {
      const props = (nodes?.[nodeId]?.props ?? {}) as Record<string, unknown>
      return {
        nodeId,
        fieldName: String(props['fieldName'] ?? '').trim(),
        fieldType: String(props['fieldType'] ?? 'text'),
      }
    },
  )
}

/**
 * Whether a submission carrying these fields could yield an address to key
 * a lead on — the one precondition of lead routing (AGL-2612).
 *
 * Exported because the check is asked in two places that never see a node
 * tree: the form's own page decides whether to offer the routing switch, and
 * the CRM's Leads section offers to turn routing on for a form from the
 * declared field list alone. Both must agree with the publish check here or
 * a switch flipped on one surface is refused on the next.
 */
export function formFieldsCanYieldAnEmail(
  fields: ReadonlyArray<{ fieldName: string; fieldType: string }>,
): boolean {
  return fields.some(
    (field) =>
      field.fieldType === 'email' || EMAIL_KEY_PATTERN.test(field.fieldName),
  )
}

/** The same question, of the fields a design DRAWS. */
function canYieldAnEmail(fields: DrawnField[]): boolean {
  return formFieldsCanYieldAnEmail(fields)
}

/**
 * Whether a submission carrying these fields could record an opt-in — the
 * other precondition of lead routing, and the one that decides whether a
 * lead is worth filing: a lead nobody consented with is one the campaigns
 * refuse at send time.
 *
 * Consent is recorded from the field the form DECLARES, or, when it declares
 * none, from an undeclared field the route recognizes by name. Whether a
 * declared field still exists is `consent-field-missing`'s question, asked
 * separately so a lost field is reported once, as the loss it is.
 *
 * Exported for the same two surfaces as {@link formFieldsCanYieldAnEmail}:
 * the switch on the form's page and the Leads section's offer must refuse
 * what the publish check would refuse.
 */
export function formFieldsCaptureConsent(
  fields: ReadonlyArray<{ fieldName: string }>,
  consentFieldName: string | null | undefined,
): boolean {
  if (String(consentFieldName ?? '').trim()) return true
  return fields.some((field) => isMarketingConsentFieldName(field.fieldName))
}

/**
 * Everything this design would break, or an empty array.
 *
 * @param options.form      the stored document, for what it ROUTES and what it
 *                          names as its consent field. `routing` and
 *                          `consentFieldName` are the only two parts read: the
 *                          stored `fields` are the previous design's output,
 *                          not a contract the new one owes anything to.
 * @param options.formId    the id this design is the design OF.
 * @param options.nodes     the flat node map, canvas or published.
 * @param options.formNodeId the `form` node inside it.
 */
export function checkFormContract(options: {
  form: Pick<FormDocument, 'routing' | 'consentFieldName'> | null | undefined
  formId: string
  nodes: Record<NodeId, AglynNodeSchema | undefined> | undefined | null
  formNodeId: NodeId | undefined | null
  /** Overridable for a host whose plugin registers these under other ids. */
  componentIds?: { form?: string; formField?: string }
}): FormContractViolation[] {
  const { form, formId, nodes, formNodeId } = options
  const formComponentId = options.componentIds?.form ?? 'form'
  const formFieldComponentId = options.componentIds?.formField ?? 'formField'
  const violations: FormContractViolation[] = []

  const formNode = formNodeId ? nodes?.[formNodeId] : undefined
  if (!formNode || formNode.componentId !== formComponentId) {
    // Nothing else is answerable without it, and reporting a cascade of
    // consequences would bury the one thing the author has to do.
    return [
      {
        code: 'form-node-missing',
        message:
          'This design no longer contains a form. Submissions have nowhere ' +
          'to come from, so nothing would reach the Inbox.',
      },
    ]
  }

  const boundId = String(
    (formNode.props as Record<string, unknown> | undefined)?.['formId'] ?? '',
  ).trim()
  if (boundId !== formId) {
    violations.push({
      code: 'form-id-unbound',
      nodeId: formNodeId as NodeId,
      message: boundId
        ? `This form's design is bound to a different form (${boundId}). ` +
          'Submissions would be filed under that one instead of this one.'
        : 'This form lost its binding. Submissions would still arrive in the ' +
          'Inbox but would not appear in this form’s own list.',
    })
  }

  const fields = drawnFields(nodes, formNodeId as NodeId, formFieldComponentId)

  const seen = new Map<string, NodeId>()
  for (const field of fields) {
    if (!field.fieldName) {
      violations.push({
        code: 'field-unnamed',
        nodeId: field.nodeId,
        message:
          'This field has no name, so whatever a visitor types into it ' +
          'arrives under a shared key and cannot be told apart from any ' +
          'other unnamed field.',
      })
      continue
    }
    const first = seen.get(field.fieldName)
    if (first !== undefined) {
      violations.push({
        code: 'field-name-duplicated',
        nodeId: field.nodeId,
        fieldName: field.fieldName,
        message:
          `Another field is already called “${field.fieldName}”. ` +
          'Two fields sharing a name arrive as one answer, and this one’s ' +
          'value would be lost.',
      })
      continue
    }
    seen.set(field.fieldName, field.nodeId)
  }

  const consentFieldName = String(form?.consentFieldName ?? '').trim()

  /*
   * The two gates on a lead, reported one at a time in the order the route
   * decides them: no address means no lead at all, which makes consent moot
   * until a field exists to key one on.
   */
  if (form?.routing?.lead === true) {
    if (!canYieldAnEmail(fields)) {
      violations.push({
        code: 'lead-routing-has-no-email-field',
        nodeId: formNodeId as NodeId,
        message:
          'This form creates a lead from the address someone gives it, and the ' +
          'design has no email field. It would collect submissions and never ' +
          'create a lead.',
      })
    } else if (!formFieldsCaptureConsent(fields, consentFieldName)) {
      violations.push({
        code: 'lead-routing-has-no-consent-field',
        nodeId: formNodeId as NodeId,
        message:
          'This form creates a lead from the address someone gives it, and ' +
          'nothing on it records their consent. Every lead it filed would be ' +
          'one the team cannot email — name a marketing consent field on the ' +
          'form’s page.',
      })
    }
  }

  if (consentFieldName && !seen.has(consentFieldName)) {
    violations.push({
      code: 'consent-field-missing',
      fieldName: consentFieldName,
      message:
        `This form records marketing consent from a field called ` +
        `“${consentFieldName}”, which the design no longer has. ` +
        'Opt-ins would stop being recorded without any other sign.',
    })
  }

  return violations
}

/**
 * Whether this design may be published.
 *
 * Every violation is blocking. There is no advisory tier because there is no
 * violation here an author would be right to ship: each one names data that
 * silently fails to arrive, and a warning that can be clicked past is how a
 * silent failure ships anyway.
 */
export function formContractIsSatisfied(
  violations: FormContractViolation[],
): boolean {
  return violations.length === 0
}
