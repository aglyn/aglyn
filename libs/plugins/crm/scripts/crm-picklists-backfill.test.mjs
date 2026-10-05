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

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  backfilledDefinitions,
  describePlan,
  heldLabels,
  leadSourceGroupFor,
  mintValueId,
  planPicklist,
  readPicklistDefinitions,
} from './crm-picklists-backfill.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO = join(here, '..', '..', '..', '..')
const CRM_SOURCE = readFileSync(join(REPO, 'libs/aglyn/src/lib/app-utils/crm.ts'), 'utf8')

const registry = readPicklistDefinitions(CRM_SOURCE)
const LEAD_SOURCE = registry.find((definition) => definition.id === 'leadSource')

describe('the registry, read from crm.ts (AGL-3511)', () => {
  it('reads the Lead source definition as crm.ts spells it', () => {
    assert.ok(LEAD_SOURCE, 'crm.ts registers leadSource')
    assert.deepEqual(
      LEAD_SOURCE.standardValues.map((value) => [value.id, value.label, value.group ?? null]),
      [
        ['web', 'Web', 'inbound'],
        ['phone-inquiry', 'Phone inquiry', 'inbound'],
        ['email-inquiry', 'Email inquiry', 'inbound'],
        ['partner-referral', 'Partner referral', 'inbound'],
        ['employee-referral', 'Employee referral', 'inbound'],
        ['external-referral', 'External referral', 'inbound'],
        ['advertisement', 'Advertisement', 'inbound'],
        ['trade-show', 'Trade show', 'inbound'],
        ['webinar', 'Webinar', 'inbound'],
        ['word-of-mouth', 'Word of mouth', 'inbound'],
        ['purchased-list', 'Purchased list', 'outbound'],
        ['other', 'Other', null],
      ],
    )
    assert.deepEqual(LEAD_SOURCE.groups, ['inbound', 'outbound'])
    assert.deepEqual(LEAD_SOURCE.targets, [
      { object: 'lead', field: 'leadSource' },
      { object: 'contact', field: 'leadSource', facet: true },
    ])
  })

  it('reads a definition it has never heard of, with meanings and quoted labels', () => {
    const [definition] = readPicklistDefinitions(`
const X = {
  id: 'industry',
  label: 'Industry',
  meanings: ['open', 'won'],
  standardValues: [
    { id: 'food', label: 'Food & Beverage' },
    { id: 'np', label: "Not For Profit's", meaning: 'open' },
  ],
  targets: [{ object: 'company', field: 'industry' }],
} as const satisfies CrmPicklistDefinition`)
    assert.equal(definition.id, 'industry')
    assert.deepEqual(definition.standardValues, [
      { id: 'food', label: 'Food & Beverage' },
      { id: 'np', label: "Not For Profit's", meaning: 'open' },
    ])
    assert.deepEqual(definition.meanings, ['open', 'won'])
    assert.deepEqual(definition.targets, [{ object: 'company', field: 'industry' }])
  })

  it('backfills Lead source, and Industry only when it is registered', () => {
    assert.deepEqual(backfilledDefinitions(registry).chosen.map((entry) => entry.id).filter((id) => id !== 'industry'), ['leadSource'])
    const industry = { id: 'industry', standardValues: [{ id: 'other', label: 'Other' }], groups: [], meanings: [], targets: [{ object: 'company', field: 'industry' }] }
    assert.deepEqual(backfilledDefinitions([LEAD_SOURCE, industry]).chosen.map((entry) => entry.id), ['leadSource', 'industry'])
    assert.deepEqual(backfilledDefinitions([LEAD_SOURCE]).chosen.map((entry) => entry.id), ['leadSource'])
  })

  it('refuses a definition whose standard values it could not read', () => {
    const unread = { id: 'industry', standardValues: [], groups: [], meanings: [], targets: [{ object: 'company', field: 'industry' }] }
    assert.deepEqual(backfilledDefinitions([unread]), { chosen: [], refused: ['industry'] })
  })
})

describe('a lead source’s direction by its label', () => {
  it('files Outbound labels as outbound and a website form as inbound', () => {
    assert.equal(leadSourceGroupFor('Outbound · Apollo'), 'outbound')
    assert.equal(leadSourceGroupFor('outbound - cold email'), 'outbound')
    assert.equal(leadSourceGroupFor('Website form'), 'inbound')
    assert.equal(leadSourceGroupFor('Internal test'), null)
    assert.equal(leadSourceGroupFor('Outboundish'), null)
  })
})

describe('the plan for one list', () => {
  it('keeps a stored standard id as an override and rewrites nothing for it', () => {
    const raw = {
      values: [
        { id: 'web', label: 'Website', active: true, group: 'inbound' },
        { id: 'trade-show', label: 'Trade show', active: false },
      ],
      defaultValueId: 'web',
    }
    const plan = planPicklist({ definition: LEAD_SOURCE, raw, held: ['Website', 'trade  SHOW'], groupFor: leadSourceGroupFor })
    assert.equal(plan.write, false)
    assert.deepEqual(plan.kept, ['Website', 'Trade show'])
    assert.deepEqual(plan.added, [])
  })

  it('groups an org-added Outbound value and leaves an admin’s group alone', () => {
    const raw = {
      values: [
        { id: 'outbound-apollo', label: 'Outbound · Apollo', active: true, group: null },
        { id: 'outbound-x', label: 'Outbound · X', active: true, group: 'inbound' },
        { id: 'referral', label: 'Referral', active: true },
      ],
      defaultValueId: null,
    }
    const plan = planPicklist({ definition: LEAD_SOURCE, raw, held: [], groupFor: leadSourceGroupFor })
    assert.equal(plan.write, true)
    assert.deepEqual(plan.regrouped, [{ label: 'Outbound · Apollo', group: 'outbound' }])
    assert.equal(plan.values.find((value) => value.id === 'outbound-x').group, 'inbound')
    assert.equal(plan.values.find((value) => value.id === 'referral').group, undefined)
  })

  it('adds every held label the list does not answer to, once, with an id no standard value has', () => {
    const plan = planPicklist({
      definition: LEAD_SOURCE,
      raw: { values: [{ id: 'web', label: 'Web', active: true }], defaultValueId: 'web' },
      held: ['Outbound · Instantly', 'outbound ·  instantly', 'Web', 'Other', ' ', 'Webinar'],
      groupFor: leadSourceGroupFor,
    })
    assert.deepEqual(plan.added, [{ label: 'Outbound · Instantly', group: 'outbound' }])
    assert.equal(plan.defaultValueId, 'web')
    // Stored values first, as stored; the standard values stay built in.
    assert.deepEqual(plan.values.map((value) => value.id), ['web', 'outbound-instantly'])
    assert.equal(mintValueId('Web', ['web']), 'web-2')
  })

  it('writes an org with no list the effective list, the added values after the standard ones', () => {
    const plan = planPicklist({ definition: LEAD_SOURCE, raw: undefined, held: ['Referral', 'Web'], groupFor: leadSourceGroupFor })
    assert.equal(plan.created, true)
    assert.equal(plan.write, true)
    assert.deepEqual(plan.values.slice(0, 12).map((value) => value.id), LEAD_SOURCE.standardValues.map((value) => value.id))
    assert.deepEqual(plan.values[12], { id: 'referral', label: 'Referral', active: true, group: null })
    assert.equal(plan.defaultValueId, null)
  })

  it('writes nothing for an org with no list whose records hold only standard labels', () => {
    const plan = planPicklist({ definition: LEAD_SOURCE, raw: undefined, held: ['web', 'Purchased list'], groupFor: leadSourceGroupFor })
    assert.equal(plan.write, false)
  })

  it('never adds to a semantic list, whose added values must name a meaning', () => {
    const semantic = { ...LEAD_SOURCE, groups: [], meanings: ['new'], standardValues: [{ id: 'new', label: 'New', meaning: 'new' }] }
    const plan = planPicklist({ definition: semantic, raw: undefined, held: ['Hot'] })
    assert.equal(plan.write, false)
    assert.deepEqual(plan.skipped, ['Hot'])
  })

  it('plans the Aglyn org as the issue expects', () => {
    const raw = { values: [{ id: 'web', label: 'Web', active: true }], defaultValueId: null }
    const leads = [
      { data: { leadSource: 'Outbound · Apollo' } },
      { data: { leadSource: 'Outbound · Instantly' } },
      { data: { leadSource: 'Outbound · self-published address' } },
      { data: { leadSource: 'Website form' } },
      { data: { leadSource: 'Internal test' } },
      { data: { leadSource: 'Outbound · Apollo' } },
    ]
    const contacts = [{ data: { facets: { g1: { leadSource: 'Website form' }, g2: { leadSource: 3 } } } }]
    const held = [...heldLabels(leads, 'leadSource'), ...heldLabels(contacts, 'leadSource', { facet: true })]
    const plan = planPicklist({ definition: LEAD_SOURCE, raw, held, groupFor: leadSourceGroupFor })
    assert.deepEqual(describePlan('leadSource', plan), [
      'leadSource:',
      '    Outbound · Apollo → added, outbound',
      '    Outbound · Instantly → added, outbound',
      '    Outbound · self-published address → added, outbound',
      '    Website form → added, inbound',
      '    Internal test → added, no group',
    ])
  })

  it('backfills an Industry list from company free text, no group and no meaning', () => {
    const industry = {
      id: 'industry',
      standardValues: [{ id: 'technology', label: 'Technology' }, { id: 'other', label: 'Other' }],
      groups: [],
      meanings: [],
      targets: [{ object: 'company', field: 'industry' }],
    }
    const companies = [{ data: { industry: 'technology' } }, { data: { industry: 'Coffee roasting' } }, { data: {} }]
    const plan = planPicklist({ definition: industry, raw: undefined, held: heldLabels(companies, 'industry') })
    assert.deepEqual(plan.added, [{ label: 'Coffee roasting', group: null }])
    assert.deepEqual(plan.values.at(-1), { id: 'coffee-roasting', label: 'Coffee roasting', active: true })
  })
})
