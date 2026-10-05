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

import { crmLeadSourceKey, effectiveCrmLeadSourcePicklist } from '@aglyn/aglyn'
import { contactQueryClause } from '../constants/contact-filters'
import { leadsByLeadSource } from './crm-reports'
import {
  type CrmSharingRule,
  crmSharingRuleMatches,
  describeSharingRuleScope,
  readCrmSharingRule,
  sharingRulesAskLeadSourceDirection,
} from './crm-sharing'
import { leadQueryClause } from './lead-filters'
import {
  leadSourceDirectionOf,
  leadSourceLabelsOfDirection,
  STANDARD_LEAD_SOURCES,
} from './lead-source-direction'

/**
 * A lead source's direction (AGL-3511) is its value's group in the org's
 * list, read when it is asked — never stored on a record. So every place
 * that asks it — the Leads filter, a sharing rule, the Lead sources report
 * — follows a value an admin moves between groups.
 */

/** An org that added two values of its own and filed one as Outbound. */
const ORG_LIST = effectiveCrmLeadSourcePicklist({
  values: [
    { id: 'outbound-apollo', label: 'Outbound · Apollo', active: true, group: 'outbound' },
    { id: 'internal-test', label: 'Internal test', active: true },
    { id: 'webinar', label: 'Webinar', active: false, group: 'outbound' },
  ],
  defaultValueId: null,
})

describe('a lead source’s direction', () => {
  it('is the value’s group in the list, in any spelling, and none for an unlisted or ungrouped one', () => {
    expect(leadSourceDirectionOf(ORG_LIST, 'outbound ·  APOLLO')).toBe('outbound')
    expect(leadSourceDirectionOf(ORG_LIST, 'Web')).toBe('inbound')
    expect(leadSourceDirectionOf(ORG_LIST, 'Internal test')).toBeNull()
    expect(leadSourceDirectionOf(ORG_LIST, 'Other')).toBeNull()
    expect(leadSourceDirectionOf(ORG_LIST, 'Carrier pigeon')).toBeNull()
    expect(leadSourceDirectionOf(ORG_LIST, '')).toBeNull()
  })

  it('lists every label of a group, the inactive and the regrouped ones too', () => {
    expect(leadSourceLabelsOfDirection(ORG_LIST, 'outbound')).toEqual([
      'Outbound · Apollo',
      'Webinar',
      'Purchased list',
      'Sequence',
      'Email campaign',
    ])
    expect(leadSourceLabelsOfDirection(STANDARD_LEAD_SOURCES, 'outbound')).toEqual([
      'Purchased list',
      'Sequence',
      'Email campaign',
    ])
  })
})

describe('the Leads filter by direction', () => {
  it('asks leadSourceKey in the keys of every value of that group', () => {
    expect(
      leadQueryClause(
        { field: 'leadSourceDirection', op: 'equals', value: 'outbound' },
        { scopeTokens: null, foldsScope: true, leadSources: ORG_LIST },
      ),
    ).toEqual({
      field: 'leadSourceKey',
      op: 'isAnyOf',
      value: ['Outbound · Apollo', 'Webinar', 'Purchased list', 'Sequence', 'Email campaign']
        .map(crmLeadSourceKey)
        .join(','),
    })
  })

  it('reads the standard values before the org’s list has been read', () => {
    expect(leadQueryClause({ field: 'leadSourceDirection', op: 'equals', value: 'outbound' })).toEqual({
      field: 'leadSourceKey',
      op: 'isAnyOf',
      value: ['Purchased list', 'Sequence', 'Email campaign'].map(crmLeadSourceKey).join(','),
    })
  })

  it('refuses an unknown direction, and a group the query cannot hold in one `in`', () => {
    expect(leadQueryClause({ field: 'leadSourceDirection', op: 'equals', value: 'sideways' })).toEqual({
      refused: 'sideways is not a lead source direction',
    })
    const crowded = effectiveCrmLeadSourcePicklist({
      values: Array.from({ length: 25 }, (_, at) => ({
        id: `src-${at}`,
        label: `Source ${at}`,
        active: true,
        group: 'inbound',
      })),
      defaultValueId: null,
    })
    const asked = leadQueryClause(
      { field: 'leadSourceDirection', op: 'equals', value: 'inbound' },
      { scopeTokens: null, foldsScope: true, leadSources: crowded },
    )
    expect(asked).toEqual({ refused: expect.stringMatching(/^more than 30 lead sources/) })
  })
})

describe('a sharing rule by direction', () => {
  const rule = (overrides: Partial<CrmSharingRule> = {}): CrmSharingRule => ({
    id: 'r1',
    name: 'Outbound leads',
    object: 'leads',
    enabled: true,
    sourceHostIds: [],
    criteria: { leadSourceGroups: ['outbound'] },
    targets: ['org'],
    access: 'read',
    createdAtMs: 1,
    updatedAtMs: 1,
    ...overrides,
  })
  const lead = (leadSource: string) => ({ email: 'p@acme.test', visibleTo: ['org'], status: 'new', leadSource })

  it('matches a record whose lead source is in the group, through the org’s list', () => {
    const context = { leadSources: ORG_LIST }
    expect(crmSharingRuleMatches(rule(), 'leads', lead('Outbound · Apollo'), context)).toBe(true)
    expect(crmSharingRuleMatches(rule(), 'leads', lead('Webinar'), context)).toBe(true)
    expect(crmSharingRuleMatches(rule(), 'leads', lead('Web'), context)).toBe(false)
    expect(crmSharingRuleMatches(rule(), 'leads', lead('Internal test'), context)).toBe(false)
    // Without the org's list, only the standard groups answer.
    expect(crmSharingRuleMatches(rule(), 'leads', lead('Outbound · Apollo'))).toBe(false)
    expect(crmSharingRuleMatches(rule(), 'leads', lead('Purchased list'))).toBe(true)
  })

  it('reads a contact through every holder’s facet', () => {
    const contact = {
      email: 'p@acme.test',
      visibleTo: ['org'],
      facets: { g1: { leadSource: 'Web' }, g2: { leadSource: 'Outbound · Apollo' } },
    }
    expect(
      crmSharingRuleMatches(rule({ object: 'contacts' }), 'contacts', contact, { leadSources: ORG_LIST }),
    ).toBe(true)
  })

  it('keeps only a known direction from a stored rule, and says the list must be read', () => {
    const read = readCrmSharingRule({
      ...rule(),
      criteria: { leadSourceGroups: ['outbound', 'sideways'] },
    })
    expect(read?.criteria.leadSourceGroups).toEqual(['outbound'])
    expect(sharingRulesAskLeadSourceDirection([read as CrmSharingRule], 'leads')).toBe(true)
    expect(sharingRulesAskLeadSourceDirection([rule({ criteria: {} })], 'leads')).toBe(false)
    expect(describeSharingRuleScope(rule(), (id) => id)).toBe('Leads, Outbound by lead source')
  })
})

describe('the Lead sources report', () => {
  it('counts the leads and the qualified ones by value and by direction, in the list’s order', () => {
    const breakdown = leadsByLeadSource(
      [
        { leadSource: 'web', status: 'qualified' },
        { leadSource: 'Web', status: 'new' },
        { leadSource: 'Outbound · Apollo', status: 'qualified' },
        { leadSource: 'Carrier pigeon', status: 'working' },
        { status: 'new' },
      ],
      ORG_LIST,
    )
    expect(breakdown.total).toBe(5)
    expect(breakdown.qualified).toBe(2)
    expect(breakdown.rows.map((row) => [row.label, row.direction, row.listed, row.leads, row.qualified])).toEqual([
      ['Outbound · Apollo', 'outbound', true, 1, 1],
      ['Web', 'inbound', true, 2, 1],
      ['Carrier pigeon', null, false, 1, 0],
      ['', null, false, 1, 0],
    ])
    expect(breakdown.directions).toEqual([
      { direction: 'inbound', leads: 2, qualified: 1, rate: 0.5 },
      { direction: 'outbound', leads: 1, qualified: 1, rate: 1 },
      { direction: null, leads: 2, qualified: 0, rate: 0 },
    ])
  })
})

describe('the Contacts filter by lead source', () => {
  it('asks the holder’s leadSource facet key, as the label compares', () => {
    expect(
      contactQueryClause(
        { field: 'leadSource', op: 'equals', value: 'Outbound ·  Apollo' },
        { groupId: 'g1', foldsScope: true },
      ),
    ).toEqual({ field: 'facetKeys', op: 'contains', value: 'g1:leadSource=outbound · apollo' })
    expect(
      contactQueryClause({ field: 'leadSource', op: 'isNotEmpty', value: '' }, { groupId: null, foldsScope: true }),
    ).toEqual({ field: 'facetKeys', op: 'contains', value: '*:leadSource' })
  })
})
