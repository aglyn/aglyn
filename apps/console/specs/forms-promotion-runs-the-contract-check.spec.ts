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
 * PROMOTION IS WHERE THE FORM CONTRACT IS ENFORCED.
 *
 * `form-contract.spec.ts` proves the rule is right. This proves it stands
 * between an author and the write — on the SECOND promotion path, the one that
 * does not go through the besigner at all. A form's version history now offers
 * Publish on any version, and a promotion that skipped the check would make
 * the besigner's refusal a formality anyone could route around by opening the
 * form's own page instead.
 *
 * The resolver is exercised on real node maps rather than through a mocked
 * Admin SDK, because the property under test is WHICH trees it refuses, not
 * how a 422 is serialized. The route's own ordering — check, then write — is
 * asserted against the source, because that failure is a rearrangement rather
 * than a wrong answer, and a rearrangement renders perfectly.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/server'
import {
  isFormPromotionRefusal,
  resolveFormPromotion,
  type FormPromotionRefusal,
  type FormPromotionWrite,
} from '../utils/promote-form-version'

const FORM_ID = 'form-abc'
const ROUTE = 'apps/console/app/api/hosts/forms/promote/route.ts'
// Jest's cwd is the repo root here, not apps/console.
const readRepo = (rel: string) =>
  readFileSync(join(process.cwd(), rel), 'utf8')

/**
 * A stored CANVAS tree — the shape a besigner save actually leaves behind.
 *
 * Rooted at the synthetic canvas root, because that is what the resolver has
 * to unwrap: publishing the wrapper would put an always-empty container around
 * every placed instance. A fixture rooted at the form itself would pass
 * whether or not the unwrap happened.
 */
function canvas(
  fields: Array<{ id: string; fieldName?: string; fieldType?: string }>,
  formProps: Record<string, unknown> = { formId: FORM_ID },
  extraRootChildren: string[] = [],
): Record<string, any> {
  const nodes: Record<string, any> = {
    [CANVAS_ROOT_ELEMENT_ID]: {
      $id: CANVAS_ROOT_ELEMENT_ID,
      componentId: 'div',
      parentId: null,
      nodes: ['theForm', ...extraRootChildren],
    },
    theForm: {
      $id: 'theForm',
      componentId: 'form',
      parentId: CANVAS_ROOT_ELEMENT_ID,
      props: formProps,
      nodes: fields.map((one) => one.id),
    },
  }
  for (const sibling of extraRootChildren) {
    nodes[sibling] = {
      $id: sibling,
      componentId: 'div',
      parentId: CANVAS_ROOT_ELEMENT_ID,
      nodes: [],
    }
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
    }
  }
  return nodes
}

const promote = (
  storedNodes: unknown,
  form: Record<string, unknown> = {},
): FormPromotionWrite | FormPromotionRefusal =>
  resolveFormPromotion({ formId: FORM_ID, form, storedNodes })

const refusal = (result: FormPromotionWrite | FormPromotionRefusal) => {
  if (!isFormPromotionRefusal(result)) {
    throw new Error('expected a refusal, got a write')
  }
  return result
}

const written = (result: FormPromotionWrite | FormPromotionRefusal) => {
  if (isFormPromotionRefusal(result)) {
    throw new Error(`expected a write, got: ${result.body.error}`)
  }
  return result
}

describe('a promotion that may proceed', () => {
  it('THE CONTROL: an ordinary contact form promotes', () => {
    // Otherwise every refusal below could be a resolver that refuses
    // everything, and the suite would pass by never allowing anything.
    const result = written(
      promote(
        canvas([
          { id: 'f1', fieldName: 'name' },
          { id: 'f2', fieldName: 'email', fieldType: 'email' },
        ]),
        { routing: { lead: true } },
      ),
    )
    expect(result.fields.map((field) => field.fieldName)).toEqual([
      'name',
      'email',
    ])
  })

  it('unwraps the synthetic canvas root rather than publishing it', () => {
    const result = written(promote(canvas([{ id: 'f1', fieldName: 'email' }])))
    expect(result.rootId).toBe('theForm')
    expect(Object.keys(result.nodes)).not.toContain(CANVAS_ROOT_ELEMENT_ID)
  })

  it('derives the declaration from the SAME tree it checked', () => {
    // `fields` is what `/api/forms/submit` validates against. Writing the
    // design without it is how the two drift straight back apart after the
    // check passed.
    const result = written(
      promote(
        canvas([
          { id: 'f1', fieldName: 'email', fieldType: 'email' },
          { id: 'f2', fieldName: 'note', fieldType: 'textarea' },
        ]),
      ),
    )
    expect(result.fields).toEqual([
      { fieldName: 'email', fieldType: 'email' },
      { fieldName: 'note', fieldType: 'textarea' },
    ])
  })
})

describe('a promotion the contract refuses', () => {
  it('refuses a field with no name, and says what would be lost', () => {
    const result = refusal(
      promote(canvas([{ id: 'f1' }, { id: 'f2', fieldName: 'email' }])),
    )
    expect(result.status).toBe(422)
    expect(result.body.violations?.map((one) => one.code)).toEqual([
      'field-unnamed',
    ])
    // The message names the CONSEQUENCE, not the rule — a refusal an author
    // cannot act on is a refusal they will click past.
    expect(result.body.violations?.[0]?.message).toContain('cannot be told apart')
  })

  it('refuses two fields sharing one name, and names the name', () => {
    const result = refusal(
      promote(
        canvas([
          { id: 'f1', fieldName: 'email' },
          { id: 'f2', fieldName: 'email' },
        ]),
      ),
    )
    expect(result.body.violations?.map((one) => one.code)).toEqual([
      'field-name-duplicated',
    ])
    expect(result.body.violations?.[0]?.fieldName).toBe('email')
    expect(result.body.violations?.[0]?.message).toContain('email')
  })

  it('refuses lead routing with nothing to take an address from', () => {
    const result = refusal(
      promote(canvas([{ id: 'f1', fieldName: 'message' }]), {
        routing: { lead: true },
      }),
    )
    expect(result.body.violations?.map((one) => one.code)).toEqual([
      'lead-routing-has-no-email-field',
    ])
    expect(result.body.violations?.[0]?.message).toContain('never create a lead')
  })

  it('refuses a consent field the design no longer has, and names it', () => {
    const result = refusal(
      promote(canvas([{ id: 'f1', fieldName: 'email', fieldType: 'email' }]), {
        consentFieldName: 'marketingOptIn',
      }),
    )
    expect(result.body.violations?.map((one) => one.code)).toEqual([
      'consent-field-missing',
    ])
    expect(result.body.violations?.[0]?.message).toContain('marketingOptIn')
  })

  it('refuses a design bound to a different form', () => {
    const result = refusal(
      promote(canvas([{ id: 'f1', fieldName: 'email' }], { formId: 'other' })),
    )
    expect(result.body.violations?.map((one) => one.code)).toEqual([
      'form-id-unbound',
    ])
    expect(result.body.violations?.[0]?.message).toContain('other')
  })

  it('refuses a design with no form node at all', () => {
    const result = refusal(
      promote({
        [CANVAS_ROOT_ELEMENT_ID]: {
          $id: CANVAS_ROOT_ELEMENT_ID,
          componentId: 'div',
          parentId: null,
          nodes: ['justAText'],
        },
        justAText: {
          $id: 'justAText',
          componentId: 'text',
          parentId: CANVAS_ROOT_ELEMENT_ID,
        },
      }),
    )
    expect(result.body.violations?.map((one) => one.code)).toEqual([
      'form-node-missing',
    ])
  })

  it('reports EVERY violation, not the first one it hits', () => {
    // An author fixing one thing at a time, told about one thing at a time,
    // publishes three times to discover three problems.
    const result = refusal(
      promote(
        canvas([
          { id: 'f1' },
          { id: 'f2', fieldName: 'note' },
          { id: 'f3', fieldName: 'note' },
        ]),
        { routing: { lead: true }, consentFieldName: 'optIn' },
      ),
    )
    expect(result.body.violations?.map((one) => one.code)).toEqual([
      'field-unnamed',
      'field-name-duplicated',
      'lead-routing-has-no-email-field',
      'consent-field-missing',
    ])
  })
})

describe('a promotion the CANVAS refuses', () => {
  it('refuses a version that holds no design', () => {
    const result = refusal(promote(undefined))
    expect(result.status).toBe(422)
    expect(result.body.error).toContain('no design')
    // Not a contract violation — there is no tree to have violated anything,
    // and a caller that rendered an empty list under a contract headline would
    // be reporting a refusal it cannot explain.
    expect(result.body.violations).toBeUndefined()
  })

  it('refuses a canvas with several top-level elements', () => {
    const result = refusal(
      promote(canvas([{ id: 'f1', fieldName: 'email' }], undefined, ['stray'])),
    )
    expect(result.body.error).toContain('single top-level element')
    expect(result.body.violations).toBeUndefined()
  })
})

/**
 * The route's ORDER, asserted against its source.
 *
 * A check that runs after the write, or whose result is computed and not acted
 * on, is indistinguishable from no check at all while looking exactly like one
 * in review. This is the same guard `form-is-a-besigner-document.spec.ts`
 * keeps over the besigner's publish, pointed at the second path.
 */
describe('the promote route is gated on the resolver', () => {
  const source = () => readRepo(ROUTE)

  it('resolves before the write that publishes', () => {
    const text = source()
    const resolvedAt = text.indexOf('resolveFormPromotion({')
    const wroteAt = text.indexOf('await formRef.update({')
    expect(resolvedAt).toBeGreaterThan(-1)
    expect(wroteAt).toBeGreaterThan(-1)
    expect(resolvedAt).toBeLessThan(wroteAt)
  })

  it('returns on a refusal rather than only reporting one', () => {
    const text = source()
    const refusedAt = text.indexOf('if (isFormPromotionRefusal(resolved)) {')
    const wroteAt = text.indexOf('await formRef.update({')
    expect(refusedAt).toBeGreaterThan(-1)
    expect(refusedAt).toBeLessThan(wroteAt)
    expect(text.slice(refusedAt, wroteAt)).toContain('return Response.json(')
  })

  it('publishes the declaration alongside the design', () => {
    const text = source()
    const wroteAt = text.indexOf('await formRef.update({')
    const write = text.slice(wroteAt, wroteAt + 600)
    // The tree the contract check RESOLVED is the tree that is written.
    // Matched on the identifier rather than on a whole expression: the
    // storage form is a separate decision — msgpack now (AGL-1151) — and
    // pinning the encoding here would fail this spec for a change it is not
    // about.
    expect(write).toContain('resolved.nodes')
    expect(write).toMatch(/nodes:\s*Buffer\.from\(encodeStoredNodes\(/)
    expect(write).toContain('fields: resolved.fields')
    expect(write).toContain('versionId,')
  })

  it('gates on the PUBLISH role, not merely on write access', () => {
    // An `author` may create a draft version and may not make one live. The
    // version-create route next door correctly asks `hostRoleCanWrite`; asking
    // the same question here would let an author move the pointer.
    const text = source()
    expect(text).toContain('hostRoleCanPublish(memberRole)')
    expect(text).not.toContain('hostRoleCanWrite(memberRole)')
  })

  it('reads the stored version rather than taking a tree from the caller', () => {
    // A client that could send its own `nodes` could send a tree that passes
    // the check and publish a different one.
    const text = source()
    expect(text).toContain("storedNodes: versionSnapshot.get('nodes')")
    expect(text).not.toMatch(/body\?\.\s*nodes/)
  })
})
