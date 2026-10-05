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

import { crmLeadListFields, effectiveCrmLeadSourcePicklist } from '@aglyn/aglyn'
import { LIST_QUERY_DISJUNCTIONS } from '@aglyn/shared-ui-jsx/const/list-query-plan'
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
import { leadSourceDirectionOf } from './lead-source-direction'

/**
 * A lead source's direction (AGL-3511) is its value's group in the org's
 * list. A sharing rule and the Lead sources report read it when they are
 * asked; a lead also carries it as `leadSourceDirection` (AGL-3577), which
 * the Leads filter asks and the picklist route rewrites on a regroup — so
 * every place follows a value an admin moves between groups.
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
})

describe('the Leads filter by direction (AGL-3577)', () => {
  it('asks the direction stamped on the lead — one equality, however many values the group holds', () => {
    expect(leadQueryClause({ field: 'leadSourceDirection', op: 'equals', value: 'inbound' })).toEqual({
      field: 'leadSourceDirection',
      op: 'equals',
      value: 'inbound',
    })
    // An org whose Inbound holds more values than one `in` may: still one equality, stamped per lead.
    const crowded = effectiveCrmLeadSourcePicklist({
      values: Array.from({ length: LIST_QUERY_DISJUNCTIONS }, (_, at) => ({
        id: `src-${at}`,
        label: `Source ${at}`,
        active: true,
        group: 'inbound',
      })),
      defaultValueId: null,
    })
    expect(crowded.values.filter((value) => value.group === 'inbound').length).toBeGreaterThan(
      LIST_QUERY_DISJUNCTIONS,
    )
    expect(crmLeadListFields({ leadSource: 'Source 29' }, { leadSources: crowded }).leadSourceDirection).toBe(
      'inbound',
    )
  })

  it('asks both directions as one `in` of two', () => {
    expect(
      leadQueryClause({ field: 'leadSourceDirection', op: 'isAnyOf', value: 'inbound,outbound' }),
    ).toEqual({ field: 'leadSourceDirection', op: 'isAnyOf', value: 'inbound,outbound' })
  })

  it('refuses an unknown direction', () => {
    expect(leadQueryClause({ field: 'leadSourceDirection', op: 'equals', value: 'sideways' })).toEqual({
      refused: 'sideways is not a lead source direction',
    })
  })

  it('finds the leads the writers stamped, from the org’s own groups', () => {
    const stamped = crmLeadListFields(
      { leadSource: 'Outbound · Apollo' },
      { leadSources: ORG_LIST },
    ).leadSourceDirection
    expect(stamped).toBe('outbound')
    expect(crmLeadListFields({ leadSource: 'Webinar' }, { leadSources: ORG_LIST }).leadSourceDirection).toBe(
      'outbound',
    )
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
