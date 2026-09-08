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
  CRM_MERGE_FIELDS,
  crmEmailTemplateIsListed,
  crmMergeFieldsIn,
  crmMergeFieldToken,
  crmMergeUnresolvedMessage,
  formatCrmMergeAmount,
  hasCrmMergeFields,
  normalizeCrmEmailTemplate,
  renderCrmMergeFields,
  resolveCrmMergeFields,
  splitPersonName,
} from './crm-email-templates'

/**
 * The merge-field resolver (AGL-2658): what each field reads, what a field
 * with nothing to say does, and that nothing it is handed can make it throw.
 */

const CONTEXT = {
  contact: {
    name: 'Ada Lovelace',
    email: 'Ada@Example.com',
    facets: {
      'site-1': { name: 'Countess Ada Lovelace', jobTitle: 'Analyst', companyName: 'Analytical Engines' },
      'site-2': { jobTitle: 'Advisor' },
    },
  },
  contactGroupId: 'site-1',
  lead: { name: 'Charles Babbage', email: 'charles@example.com' },
  deal: { title: 'Difference Engine No. 2', amountCents: 1_250_000, currency: 'gbp' },
  sender: { name: 'Rep Person', email: 'Rep@Acme.com' },
  site: { name: 'Acme Site' },
}

describe('renderCrmMergeFields', () => {
  it('fills every field the picker offers, from the documents as stored', () => {
    const rendered = renderCrmMergeFields(
      CRM_MERGE_FIELDS.map((field) => `${field.key}=${crmMergeFieldToken(field.key)}`).join('\n'),
      CONTEXT,
    )
    expect(rendered.split('\n')).toEqual([
      // The sending site's own facet names the person; the canonical name
      // is the fallback, not the answer, when the holder has an override.
      'contact.firstName=Countess',
      'contact.lastName=Ada Lovelace',
      'contact.name=Countess Ada Lovelace',
      'contact.email=ada@example.com',
      'contact.company=Analytical Engines',
      'contact.title=Analyst',
      'lead.firstName=Charles',
      'lead.lastName=Babbage',
      'lead.name=Charles Babbage',
      'lead.email=charles@example.com',
      'deal.name=Difference Engine No. 2',
      'deal.amount=£12,500.00',
      'sender.firstName=Rep',
      'sender.name=Rep Person',
      'sender.email=rep@acme.com',
      'site.name=Acme Site',
    ])
  })

  it('falls back to the canonical name when no group is named or the facet has none', () => {
    expect(renderCrmMergeFields('{{contact.name}}', { contact: CONTEXT.contact })).toBe('Ada Lovelace')
    expect(
      renderCrmMergeFields('{{contact.firstName}} / {{contact.title}}', {
        contact: CONTEXT.contact,
        contactGroupId: 'site-2',
      }),
    ).toBe('Ada / Advisor')
  })

  it('renders a missing record, an unknown field and a malformed context as nothing, without throwing', () => {
    expect(renderCrmMergeFields('Hi {{contact.firstName}},', {})).toBe('Hi ,')
    expect(renderCrmMergeFields('{{deal.amount}}|{{lead.name}}', { deal: null, lead: undefined })).toBe('|')
    expect(renderCrmMergeFields('{{contact.shoeSize}}{{nothing.here}}', CONTEXT)).toBe('')
    expect(renderCrmMergeFields('{{contact.name}}', null)).toBe('')
    expect(renderCrmMergeFields('{{contact.name}}', { contact: 'garbage' as never })).toBe('')
    expect(renderCrmMergeFields('{{deal.amount}}', { deal: { amountCents: 'lots' } })).toBe('')
  })

  it('leaves a lone brace, a bare word and prose alone, and escapes nothing', () => {
    const text = 'Use {braces} freely, {{not a field}}, and <b>&</b> stays as typed.'
    expect(renderCrmMergeFields(text, CONTEXT)).toBe(text)
    expect(renderCrmMergeFields('{{ contact.email }} and {{contact.email}}', CONTEXT)).toBe(
      'ada@example.com and ada@example.com',
    )
  })

  it('names each empty field once, in order, and words the count', () => {
    const { text, unresolved } = resolveCrmMergeFields(
      'Hi {{contact.firstName}}, about {{deal.name}} ({{deal.amount}}) — {{contact.firstName}}',
      { contact: { email: 'x@y.z' }, deal: { title: 'Engine' } },
    )
    expect(text).toBe('Hi , about Engine () — ')
    expect(unresolved).toEqual(['contact.firstName', 'deal.amount'])
    expect(crmMergeUnresolvedMessage(unresolved)).toBe(
      '2 fields have no value: {{contact.firstName}}, {{deal.amount}}',
    )
    expect(crmMergeUnresolvedMessage(['site.name'])).toBe('1 field has no value: {{site.name}}')
    expect(crmMergeUnresolvedMessage([])).toBe('')
  })
})

describe('the grammar helpers', () => {
  it('lists the fields a text names, once each, and knows when there are none', () => {
    expect(crmMergeFieldsIn('{{a.b}} {{ c.d }} {{a.b}} {{e}} {{f.g.h}}')).toEqual(['a.b', 'c.d'])
    expect(hasCrmMergeFields('plain')).toBe(false)
    expect(hasCrmMergeFields('{{site.name}}')).toBe(true)
    // The global pattern's cursor must not leak between calls.
    expect(hasCrmMergeFields('{{site.name}}')).toBe(true)
  })

  it('splits a name on its first word and prints an amount in a fixed locale', () => {
    expect(splitPersonName('  Ada   Byron Lovelace ')).toEqual({ firstName: 'Ada', lastName: 'Byron Lovelace' })
    expect(splitPersonName('Ada')).toEqual({ firstName: 'Ada', lastName: '' })
    expect(splitPersonName(undefined)).toEqual({ firstName: '', lastName: '' })
    expect(formatCrmMergeAmount(123456, undefined)).toBe('$1,234.56')
    expect(formatCrmMergeAmount(500, 'EUR')).toBe('€5.00')
    expect(formatCrmMergeAmount(500, 'not-a-code')).toBe('5.00 NOT-A-CODE')
    expect(formatCrmMergeAmount(null, 'usd')).toBe('')
  })
})

describe('a stored template', () => {
  it('is held to shape, with a personal owner kept and a shared one dropped', () => {
    expect(
      normalizeCrmEmailTemplate({
        name: '  Follow-up  ',
        subject: 'Hi {{contact.firstName}}',
        body: 'Still keen?',
        kind: 'snippet',
        visibility: 'personal',
        ownerUid: 'u-1',
        createdByUid: 'u-1',
        createdAtMs: 5,
        updatedAtMs: 6,
        hostId: 'site-1',
        visibleTo: ['host:site-1'],
      }),
    ).toEqual({
      name: 'Follow-up',
      subject: 'Hi {{contact.firstName}}',
      body: 'Still keen?',
      kind: 'snippet',
      visibility: 'personal',
      ownerUid: 'u-1',
      createdByUid: 'u-1',
      createdAtMs: 5,
      updatedAtMs: 6,
      hostId: 'site-1',
      visibleTo: ['host:site-1'],
      createdAt: undefined,
      updatedAt: undefined,
    })
    const loose = normalizeCrmEmailTemplate({ kind: 'letter', visibility: 'secret', ownerUid: 'u-2' })
    expect(loose).toMatchObject({ kind: 'template', visibility: 'shared', hostId: null, visibleTo: [] })
    expect('ownerUid' in loose).toBe(false)
    expect(normalizeCrmEmailTemplate(null).name).toBe('')
  })

  it('is listed for everybody when shared, and for its owner alone when personal', () => {
    expect(crmEmailTemplateIsListed({ visibility: 'shared' }, 'u-2')).toBe(true)
    expect(crmEmailTemplateIsListed({ visibility: 'shared' }, null)).toBe(true)
    expect(crmEmailTemplateIsListed({ visibility: 'personal', ownerUid: 'u-1' }, 'u-1')).toBe(true)
    expect(crmEmailTemplateIsListed({ visibility: 'personal', ownerUid: 'u-1' }, 'u-2')).toBe(false)
    expect(crmEmailTemplateIsListed({ visibility: 'personal' }, undefined)).toBe(false)
  })
})
