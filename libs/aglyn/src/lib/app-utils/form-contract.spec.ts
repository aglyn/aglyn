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
 * A form edited in the besigner cannot drop what the submission path needs.
 *
 * Each block below stages a design an author could plausibly draw and asserts
 * that the ONE thing which would then silently fail is reported. The negative
 * assertion in each is the load-bearing half: a checker that refused every
 * design would satisfy the positive one and make the besigner unusable.
 *
 * `extractEmailFromFields` is exercised against the real function rather than
 * a restatement, because the lead check is only correct if this module's idea
 * of "a field an address can come out of" is the same as the extractor's.
 */

import { extractEmailFromFields } from './contacts'
import {
  formFieldDeclsFromNodes,
  isMarketingConsentFieldName,
  readFormDeclaredConsent,
} from './forms'
import {
  checkFormContract,
  formContractIsSatisfied,
  formFieldsCaptureConsent,
  type FormContractViolation,
} from './form-contract'
import type { AglynNodeSchema, NodeId } from '../foundation/definitions/components.types'

const FORM_ID = 'form-abc'

/** Builds the flat node map the canvas and the published document both use. */
function design(
  fields: Array<{ id: string; fieldName?: string; fieldType?: string }>,
  formProps: Record<string, unknown> = { formId: FORM_ID },
): Record<NodeId, AglynNodeSchema> {
  const nodes: Record<string, AglynNodeSchema> = {
    root: {
      $id: 'root',
      componentId: 'div',
      nodes: ['theForm'],
    } as AglynNodeSchema,
    theForm: {
      $id: 'theForm',
      componentId: 'form',
      props: formProps,
      nodes: fields.map((one) => one.id),
    } as AglynNodeSchema,
  }
  for (const field of fields) {
    nodes[field.id] = {
      $id: field.id,
      componentId: 'formField',
      parentId: 'theForm',
      props: {
        ...(field.fieldName === undefined ? {} : { fieldName: field.fieldName }),
        fieldType: field.fieldType ?? 'text',
      },
    } as AglynNodeSchema
  }
  return nodes as Record<NodeId, AglynNodeSchema>
}

const check = (
  nodes: Record<NodeId, AglynNodeSchema>,
  form: Parameters<typeof checkFormContract>[0]['form'] = {},
  formNodeId: string | null = 'theForm',
) =>
  checkFormContract({
    form,
    formId: FORM_ID,
    nodes,
    formNodeId: formNodeId as NodeId | null,
  })

const codes = (violations: FormContractViolation[]) =>
  violations.map((one) => one.code)

describe('a design that keeps its side of the bargain', () => {
  it('reports nothing for an ordinary contact form', () => {
    const nodes = design([
      { id: 'f1', fieldName: 'name' },
      { id: 'f2', fieldName: 'email', fieldType: 'email' },
      { id: 'f3', fieldName: 'message', fieldType: 'textarea' },
      { id: 'f4', fieldName: 'optIn', fieldType: 'checkbox' },
    ])
    const violations = check(nodes, {
      routing: { lead: true },
      consentFieldName: 'optIn',
    })
    expect(violations).toEqual([])
    expect(formContractIsSatisfied(violations)).toBe(true)
  })

  it('does not object to a form with no fields at all', () => {
    // An empty form is a work in progress, not a broken contract: nothing
    // silently fails, because nothing is collected.
    expect(check(design([]))).toEqual([])
  })
})

describe('the form node itself', () => {
  it('refuses a design with no form in it', () => {
    const nodes = design([{ id: 'f1', fieldName: 'email' }])
    delete (nodes as Record<string, unknown>)['theForm']
    expect(codes(check(nodes))).toEqual(['form-node-missing'])
  })

  it('reports only that, so the author is given one thing to do', () => {
    // Every other check is downstream of the form node existing. Listing the
    // consequences too would bury the cause.
    const nodes = design([{ id: 'f1', fieldName: '' }])
    delete (nodes as Record<string, unknown>)['theForm']
    expect(check(nodes, { consentFieldName: 'subscribe' })).toHaveLength(1)
  })

  it('catches a design that lost its binding', () => {
    const nodes = design([{ id: 'f1', fieldName: 'email' }], {})
    expect(codes(check(nodes))).toEqual(['form-id-unbound'])
  })

  it('catches a design bound to somebody else, and names them', () => {
    const nodes = design([{ id: 'f1', fieldName: 'email' }], {
      formId: 'form-xyz',
    })
    const [violation] = check(nodes)
    expect(violation?.code).toBe('form-id-unbound')
    // The other form's id is the fact that makes this diagnosable.
    expect(violation?.message).toContain('form-xyz')
  })
})

describe('field names, which are the submission keys', () => {
  it('catches an unnamed field and points at the node', () => {
    const nodes = design([
      { id: 'f1', fieldName: 'email' },
      { id: 'f2', fieldName: '' },
    ])
    const [violation] = check(nodes)
    expect(violation?.code).toBe('field-unnamed')
    expect(violation?.nodeId).toBe('f2')
  })

  it('treats a field with whitespace for a name as unnamed', () => {
    const nodes = design([{ id: 'f1', fieldName: '   ' }])
    expect(codes(check(nodes))).toEqual(['field-unnamed'])
  })

  it('catches two fields sharing a name, and blames the SECOND', () => {
    // The runtime keeps the first occurrence, so the first one works and the
    // second is the one whose value disappears.
    const nodes = design([
      { id: 'f1', fieldName: 'email' },
      { id: 'f2', fieldName: 'email' },
    ])
    const [violation] = check(nodes)
    expect(violation?.code).toBe('field-name-duplicated')
    expect(violation?.nodeId).toBe('f2')
    expect(violation?.fieldName).toBe('email')
  })

  it('sees what the declaration walk cannot', () => {
    // THE point of not asking `formFieldDeclsFromNodes`. It drops the unnamed
    // and duplicate fields, so its answer is a form that looks fine — the
    // evidence is removed from the thing being asked.
    const nodes = design([
      { id: 'f1', fieldName: 'email' },
      { id: 'f2', fieldName: 'email' },
      { id: 'f3', fieldName: '' },
    ])
    expect(formFieldDeclsFromNodes(nodes, 'theForm' as NodeId)).toHaveLength(1)
    expect(codes(check(nodes))).toEqual([
      'field-name-duplicated',
      'field-unnamed',
    ])
  })
})

describe('lead routing needs an address, and an opt-in to go with it', () => {
  it('refuses lead routing on a design with no email field', () => {
    // This design records no consent either. The field is the gate that
    // decides first — no address, no lead at all — so it is the one thing
    // reported; a consent refusal beside it would be about a lead that
    // could never have existed.
    const nodes = design([
      { id: 'f1', fieldName: 'name' },
      { id: 'f2', fieldName: 'message', fieldType: 'textarea' },
    ])
    expect(codes(check(nodes, { routing: { lead: true } }))).toEqual([
      'lead-routing-has-no-email-field',
    ])
  })

  it('refuses lead routing on a design that records no consent, for consent', () => {
    // The route would file the lead; nobody could email it. The refusal has
    // to name consent, because "add an email field" — the advice the old
    // message gave — is advice this form has already taken.
    const nodes = design([
      { id: 'f1', fieldName: 'name' },
      { id: 'f2', fieldName: 'email', fieldType: 'email' },
    ])
    const [violation] = check(nodes, { routing: { lead: true } })
    expect(violation?.code).toBe('lead-routing-has-no-consent-field')
    expect(violation?.message).toContain('consent')
    expect(check(nodes, { routing: { lead: true } })).toHaveLength(1)
  })

  it('accepts an undeclared opt-in the submit route reads by name', () => {
    // A form that never declared a consent field but draws a "subscribe to
    // newsletter" box is one the route records consent from; refusing it
    // would refuse a form that works.
    const nodes = design([
      { id: 'f1', fieldName: 'email', fieldType: 'email' },
      { id: 'f2', fieldName: 'Subscribe to newsletter', fieldType: 'checkbox' },
    ])
    expect(check(nodes, { routing: { lead: true } })).toEqual([])
  })

  it('reports a declared consent field the design lost once, as the loss', () => {
    // The declaration IS a consent capture on paper; the field missing from
    // the design is the fact, and `consent-field-missing` already names it.
    const nodes = design([{ id: 'f1', fieldName: 'email', fieldType: 'email' }])
    expect(
      codes(check(nodes, { routing: { lead: true }, consentFieldName: 'optIn' })),
    ).toEqual(['consent-field-missing'])
  })

  it('says nothing about consent on a form that does not route', () => {
    // Consent is a precondition of ROUTING. A contact form with no opt-in
    // still updates the contact, and the contract has nothing to say.
    const nodes = design([
      { id: 'f1', fieldName: 'name' },
      { id: 'f2', fieldName: 'email', fieldType: 'email' },
    ])
    expect(check(nodes, {})).toEqual([])
    expect(check(nodes, { routing: { lead: false } })).toEqual([])
  })

  it('says nothing about the same design when it does NOT route to leads', () => {
    // The negative half. A survey with no address is a perfectly good form.
    const nodes = design([
      { id: 'f1', fieldName: 'name' },
      { id: 'f2', fieldName: 'message', fieldType: 'textarea' },
    ])
    expect(check(nodes, { routing: { lead: false } })).toEqual([])
    expect(check(nodes, {})).toEqual([])
  })

  /** A routed form with its opt-in declared, so only the address is in question. */
  const routed = { routing: { lead: true }, consentFieldName: 'optIn' }
  const optIn = { id: 'consent', fieldName: 'optIn', fieldType: 'checkbox' }

  it('accepts a field typed as an email even when its name is not', () => {
    const nodes = design([
      { id: 'f1', fieldName: 'contactAddress', fieldType: 'email' },
      optIn,
    ])
    expect(check(nodes, routed)).toEqual([])
  })

  it('accepts a field NAMED for email even when its type is plain text', () => {
    const nodes = design([{ id: 'f1', fieldName: 'workEmail' }, optIn])
    expect(check(nodes, routed)).toEqual([])
  })

  it('agrees with the extractor it is standing in for', () => {
    // The rule is only right if a payload from an accepted design actually
    // yields an address to the function the route calls. A checker that
    // accepted a design the extractor then found nothing in would be a
    // guard that guarded the wrong thing.
    expect(extractEmailFromFields({ workEmail: 'a@b.com' })).toBe('a@b.com')
    expect(extractEmailFromFields({ contactAddress: 'a@b.com' })).toBe(
      'a@b.com',
    )
    // …and one it rejects: no key matching /email/i and no email-shaped value.
    expect(extractEmailFromFields({ name: 'Ada', message: 'hello' })).toBeNull()
  })

  it('agrees with the route about which undeclared field is an opt-in', () => {
    // The consent precondition stands in for the route's fallback read the
    // way the email one stands in for the extractor: a design accepted for
    // an undeclared opt-in must be one the route finds consent in.
    const fields = [{ fieldName: 'Subscribe to newsletter' }]
    expect(formFieldsCaptureConsent(fields, '')).toBe(true)
    expect(isMarketingConsentFieldName('Subscribe to newsletter')).toBe(true)
    // A declared name counts whatever it is called; a medical consent does not.
    expect(formFieldsCaptureConsent([], 'agreeToTerms')).toBe(true)
    expect(formFieldsCaptureConsent([{ fieldName: 'consentToTreatment' }], '')).toBe(
      false,
    )
    expect(isMarketingConsentFieldName('consentToTreatment')).toBe(false)
  })
})

describe('the consent field is named, so it can go missing', () => {
  it('catches a consent field the design no longer has', () => {
    const nodes = design([{ id: 'f1', fieldName: 'email' }])
    const [violation] = check(nodes, { consentFieldName: 'subscribe' })
    expect(violation?.code).toBe('consent-field-missing')
    expect(violation?.fieldName).toBe('subscribe')
  })

  it('catches the RENAME, which is the way this actually happens', () => {
    // Nobody deletes their opt-in checkbox. They rename the field and the
    // form keeps rendering a tick box that records nothing.
    const nodes = design([
      { id: 'f1', fieldName: 'email' },
      { id: 'f2', fieldName: 'subscribeToNewsletter', fieldType: 'checkbox' },
    ])
    expect(codes(check(nodes, { consentFieldName: 'subscribe' }))).toEqual([
      'consent-field-missing',
    ])
  })

  it('is satisfied when the named field is still there', () => {
    const nodes = design([
      { id: 'f1', fieldName: 'email' },
      { id: 'f2', fieldName: 'subscribe', fieldType: 'checkbox' },
    ])
    expect(check(nodes, { consentFieldName: 'subscribe' })).toEqual([])
  })

  it('does not count a DUPLICATE as the surviving consent field', () => {
    // The duplicate is dropped by the runtime, so if the only node carrying
    // the consent name is a losing duplicate the opt-in is not readable.
    const nodes = design([
      { id: 'f1', fieldName: 'subscribe', fieldType: 'checkbox' },
      { id: 'f2', fieldName: 'subscribe', fieldType: 'checkbox' },
    ])
    // The first occurrence IS readable, so consent survives — only the
    // duplicate is reported.
    expect(codes(check(nodes, { consentFieldName: 'subscribe' }))).toEqual([
      'field-name-duplicated',
    ])
  })

  it('agrees with the consent reader it is standing in for', () => {
    // Same argument as the extractor above: an accepted design must be one
    // the route can actually read an opt-in out of.
    expect(
      readFormDeclaredConsent({ consentFieldName: 'subscribe' }, {
        subscribe: 'on',
      }),
    ).toBe(true)
    expect(
      readFormDeclaredConsent({ consentFieldName: 'subscribe' }, {
        subscribeToNewsletter: 'on',
      }),
    ).toBe(false)
  })
})

describe('several failures at once', () => {
  it('reports every one, because fixing one at a time is a queue of surprises', () => {
    const nodes = design(
      [
        { id: 'f1', fieldName: 'name' },
        { id: 'f2', fieldName: 'name' },
        { id: 'f3', fieldName: '' },
      ],
      {},
    )
    expect(codes(check(nodes, {
      routing: { lead: true },
      consentFieldName: 'subscribe',
    }))).toEqual([
      'form-id-unbound',
      'field-name-duplicated',
      'field-unnamed',
      'lead-routing-has-no-email-field',
      'consent-field-missing',
    ])
    expect(formContractIsSatisfied(check(nodes))).toBe(false)
  })
})
