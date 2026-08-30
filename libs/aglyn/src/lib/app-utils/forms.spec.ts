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

import { PLAN_ENTITLEMENTS } from './plan-entitlements'
import {
  collectFormFieldNodeIds,
  FORMS_MAX_PER_HOST,
  formFieldDeclsFromNodes,
  discoverFormNodes,
  matchSubmissionToForm,
  normalizeFormSlug,
  normalizeSubmissionFormName,
  readFormDeclaredConsent,
} from './forms'

/** A node map in the stored shape: flat, children as ordered id arrays. */
const tree = (
  entries: Array<[string, Record<string, any>]>,
): Record<string, any> =>
  Object.fromEntries(entries.map(([id, node]) => [id, { $id: id, ...node }]))

describe('a form declares the fields an author already drew', () => {
  const nodes = tree([
    ['form-1', { componentId: 'form', nodes: ['group', 'consent'] }],
    ['group', { componentId: 'stack', nodes: ['name', 'email'] }],
    [
      'name',
      { componentId: 'formField', props: { fieldName: 'name', label: 'Your name', required: true } },
    ],
    [
      'email',
      { componentId: 'formField', props: { fieldName: 'email', fieldType: 'email' } },
    ],
    [
      'consent',
      {
        componentId: 'formField',
        props: { fieldName: 'subscribe', fieldType: 'checkbox', options: 'Email me' },
      },
    ],
  ])

  it('finds fields nested arbitrarily deep under the form', () => {
    // The runtime rides the DOM precisely so nesting between Form and field
    // needs no React context, so the reader may not assume direct children.
    expect(collectFormFieldNodeIds(nodes, 'form-1')).toEqual([
      'name',
      'email',
      'consent',
    ])
  })

  it('keeps the author\'s reading order, not the map\'s insertion order', () => {
    // Depth-first pre-order. A breadth-first walk would emit the top-level
    // `consent` before the nested `name`/`email`, which is not the order the
    // form renders in and not the order a submission list wants its columns.
    expect(
      formFieldDeclsFromNodes(nodes, 'form-1').map((field) => field.fieldName),
    ).toEqual(['name', 'email', 'subscribe'])
  })

  it('reads type, label, required and options off the nodes', () => {
    const declarations = formFieldDeclsFromNodes(nodes, 'form-1')
    expect(declarations[0]).toEqual({
      fieldName: 'name',
      fieldType: 'text',
      label: 'Your name',
      required: true,
    })
    expect(declarations[1]).toEqual({ fieldName: 'email', fieldType: 'email' })
    expect(declarations[2]).toEqual({
      fieldName: 'subscribe',
      fieldType: 'checkbox',
      options: ['Email me'],
    })
  })

  it('splits a choice list on the same separators the runtime does', () => {
    // `parseFieldOptions` splits on `[\n,]`, trims, and drops blanks. The two
    // derivations must agree or an adopted form declares options the rendered
    // control does not offer. The plugin cannot be imported here — a
    // foundation lib may not depend on one — so the parity is asserted from
    // the plugin's side in `form.spec.tsx` and the behavior is pinned here.
    const declared = formFieldDeclsFromNodes(
      tree([
        ['f', { componentId: 'form', nodes: ['size'] }],
        [
          'size',
          {
            componentId: 'formField',
            props: {
              fieldName: 'size',
              fieldType: 'select',
              options: 'Small, Medium\nLarge, ,',
            },
          },
        ],
      ]),
      'f',
    )
    expect(declared[0]?.options).toEqual(['Small', 'Medium', 'Large'])
  })

  it('DROPS an unnamed field rather than declaring a key that names no value', () => {
    // The runtime falls back to `name = fieldName || 'field'`, so several
    // unnamed fields collapse onto ONE submission key. Declaring them would
    // put a key in the schema that does not identify a value.
    const declared = formFieldDeclsFromNodes(
      tree([
        ['f', { componentId: 'form', nodes: ['a', 'b'] }],
        ['a', { componentId: 'formField', props: {} }],
        ['b', { componentId: 'formField', props: { fieldName: 'real' } }],
      ]),
      'f',
    )
    expect(declared.map((field) => field.fieldName)).toEqual(['real'])
  })

  it('keeps the first of a duplicated field name', () => {
    // `FormData` joins repeated keys into one value, so the second node
    // contributes no separate value and must not become a second column.
    const declared = formFieldDeclsFromNodes(
      tree([
        ['f', { componentId: 'form', nodes: ['a', 'b'] }],
        ['a', { componentId: 'formField', props: { fieldName: 'q', label: 'First' } }],
        ['b', { componentId: 'formField', props: { fieldName: 'q', label: 'Second' } }],
      ]),
      'f',
    )
    expect(declared).toHaveLength(1)
    expect(declared[0]?.label).toBe('First')
  })

  it('terminates on a cyclic document instead of hanging', () => {
    const cyclic = tree([
      ['f', { componentId: 'form', nodes: ['a'] }],
      ['a', { componentId: 'stack', nodes: ['b'] }],
      ['b', { componentId: 'stack', nodes: ['a'] }],
    ])
    expect(collectFormFieldNodeIds(cyclic, 'f')).toEqual([])
  })
})

describe('discovery finds the forms that already exist', () => {
  it('reports every form node in a document with its caption and fields', () => {
    const found = discoverFormNodes(
      tree([
        ['contact', { componentId: 'form', props: { formName: 'Contact' }, nodes: ['e'] }],
        ['e', { componentId: 'formField', props: { fieldName: 'email' } }],
        ['signup', { componentId: 'form', props: { formName: 'Newsletter' } }],
        ['text', { componentId: 'typography' }],
      ]),
      { kind: 'screen', id: 'screen-1', name: 'Contact page' },
    )
    expect(found).toHaveLength(2)
    expect(found[0]).toMatchObject({
      sourceKind: 'screen',
      sourceId: 'screen-1',
      sourceName: 'Contact page',
      nodeId: 'contact',
      formName: 'Contact',
    })
    expect(found[0]?.fields.map((field) => field.fieldName)).toEqual(['email'])
  })

  it('files an unnamed form under the caption its submissions carry', () => {
    // The client sends `formName || 'Form'` and the route stores
    // `String(formName ?? 'Form')`. Discovery must claim the SAME string or
    // every legacy match misses — silently, and in the safe direction, which
    // is the failure that looks like success.
    const [found] = discoverFormNodes(
      tree([['f', { componentId: 'form' }]]),
      { kind: 'screen', id: 's' },
    )
    expect(found?.formName).toBe('Form')
    expect(normalizeSubmissionFormName(undefined)).toBe('Form')
    expect(normalizeSubmissionFormName('   ')).toBe('Form')
  })

  it('reports a form that is already bound', () => {
    const [found] = discoverFormNodes(
      tree([['f', { componentId: 'form', props: { formId: 'form-abc' } }]]),
      { kind: 'component', id: 'def-1' },
    )
    expect(found?.formId).toBe('form-abc')
  })
})

describe('an ambiguous submission is left UNSTAMPED', () => {
  const contact = {
    formId: 'form-contact',
    legacyMatch: { formName: 'Contact', paths: ['/contact'] },
  }
  const support = {
    formId: 'form-support',
    legacyMatch: { formName: 'Contact', paths: ['/support'] },
  }

  it('stamps when the caption AND the path both name one form', () => {
    expect(
      matchSubmissionToForm({ formName: 'Contact', path: '/contact' }, [
        contact,
        support,
      ]),
    ).toBe('form-contact')
  })

  it('refuses when the caption matches but the path matches no adopted form', () => {
    // Two pages sharing a label is the DEFECT the entity exists to fix.
    // Matching on the caption alone would carry that defect into the
    // migration and file the row under whichever form was adopted first.
    expect(
      matchSubmissionToForm({ formName: 'Contact', path: '/old-contact' }, [
        contact,
        support,
      ]),
    ).toBeNull()
  })

  it('refuses a lone caption match — the shape a caption-keyed backfill stamps', () => {
    // The dangerous case, and the one the assertion above does NOT cover: with
    // only ONE form carrying the caption, a `formName`-keyed match finds
    // exactly one candidate and stamps it. The submission came from a page
    // this form never rendered on — a retired page, or a second form since
    // deleted — and stamping files it under a form it was never sent to.
    //
    // Unstamped, it stays in the Inbox and the Forms page counts it. Wrongly
    // stamped, it is invisible, and invisible is not recoverable.
    expect(
      matchSubmissionToForm({ formName: 'Contact', path: '/retired-page' }, [
        contact,
      ]),
    ).toBeNull()
  })

  it('refuses when two forms both claim the same caption and path', () => {
    expect(
      matchSubmissionToForm({ formName: 'Contact', path: '/contact' }, [
        contact,
        { ...support, legacyMatch: { formName: 'Contact', paths: ['/contact'] } },
      ]),
    ).toBeNull()
  })

  it('refuses a submission that recorded no path', () => {
    // Older rows genuinely predate the field. They stay unstamped rather
    // than falling back to the caption, which is the guess this refuses.
    expect(matchSubmissionToForm({ formName: 'Contact' }, [contact])).toBeNull()
    expect(
      matchSubmissionToForm({ formName: 'Contact', path: '' }, [contact]),
    ).toBeNull()
  })

  it('refuses a form that claims no history', () => {
    expect(
      matchSubmissionToForm({ formName: 'Contact', path: '/contact' }, [
        { formId: 'form-new' },
      ]),
    ).toBeNull()
  })
})

describe('consent comes from a declared field, never from the submission', () => {
  const form = { consentFieldName: 'subscribe' }

  it('reads the field the form named', () => {
    expect(readFormDeclaredConsent(form, { subscribe: 'on' })).toBe(true)
    expect(readFormDeclaredConsent(form, { subscribe: 'true' })).toBe(true)
    expect(readFormDeclaredConsent(form, { subscribe: true })).toBe(true)
  })

  it('is FALSE when the visitor left the box unticked', () => {
    expect(readFormDeclaredConsent(form, { subscribe: '' })).toBe(false)
    expect(readFormDeclaredConsent(form, { subscribe: 'false' })).toBe(false)
  })

  it('is FALSE for a form that declares no consent field, whatever it collected', () => {
    // ⛔ The fact of submission is not an opt-in. A form with no consent
    // field produces no consent record, and a field that merely LOOKS like
    // one does not become the declaration.
    expect(readFormDeclaredConsent({}, { subscribe: 'on' })).toBe(false)
    expect(readFormDeclaredConsent(null, { marketingConsent: 'true' })).toBe(false)
  })

  it('is FALSE when the declared field was not submitted at all', () => {
    expect(readFormDeclaredConsent(form, { email: 'a@b.com' })).toBe(false)
  })
})

describe('a form slug is a handle, never an identity', () => {
  it('reduces a display name to a url-safe handle', () => {
    expect(normalizeFormSlug('  Contact Us! ')).toBe('contact-us')
    expect(normalizeFormSlug('Sign-up / Newsletter')).toBe('sign-up-newsletter')
  })

  it('answers empty for a name that reduces to nothing', () => {
    // The caller falls back to the document id. An empty slug stored as a
    // slug would be a second form's slug too.
    expect(normalizeFormSlug('!!!')).toBe('')
    expect(normalizeFormSlug(undefined)).toBe('')
  })

  it('never ends in a separator after truncation', () => {
    expect(normalizeFormSlug('a'.repeat(63) + ' tail')).not.toMatch(/-$/)
  })
})

describe('the listing bound is not the allowance', () => {
  /**
   * `FORMS_MAX_PER_HOST` pages a READ of `hosts/{hostId}/forms`; the plan's
   * `formsPerHost` is what a site may hold. Two numbers with one obvious
   * failure between them: a page size below the allowance drops forms the
   * customer made, silently, from a picker and a filter that show no sign of
   * having truncated anything.
   */
  const finiteAllowances = Object.entries(PLAN_ENTITLEMENTS)
    .map(([plan, value]) => [plan, value.formsPerHost] as const)
    .filter(([, allowance]) => Number.isFinite(allowance))

  it('pages at or above every finite per-plan allowance', () => {
    // Reported as pairs rather than a boolean so a failure names the plan.
    expect(
      finiteAllowances.filter(([, allowance]) => allowance > FORMS_MAX_PER_HOST),
    ).toEqual([])
  })

  it('has finite allowances to compare against at all', () => {
    // The control. `filter` over an empty list passes vacuously, so a rename
    // of the entitlement key would otherwise turn the guard above green while
    // it compared nothing.
    expect(finiteAllowances.length).toBeGreaterThan(0)
  })

  it('is NOT the number a surface should publish as the cap', () => {
    // It disagrees with most plans on purpose. A surface reading this instead
    // of the entitlement publishes one plan's terms to every plan.
    expect(
      finiteAllowances.filter(([, allowance]) => allowance !== FORMS_MAX_PER_HOST),
    ).not.toEqual([])
  })
})
