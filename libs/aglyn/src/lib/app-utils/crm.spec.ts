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

import { consentGroupForHost, soloConsentGroup } from './consent-groups'
import type { ContactInteraction } from './contacts'
import { ORG_CLIENT_WRITABLE_FIELDS } from '../foundation'
import {
  activityKindHasOutcome,
  activityTimeLabel,
  assignmentEmailDomain,
  assignmentRuleMatches,
  companyDomainForEmail,
  CRM_ASSIGNMENT_RULES_MAX,
  CRM_ASSIGNMENT_RULES_PATH,
  CRM_ROUND_ROBIN_LAST_ASSIGNED_PATH,
  CRM_ROUND_ROBIN_POOL_MAX,
  CRM_ROUND_ROBIN_POOL_PATH,
  crmHostDefaultOwner,
  crmHostDefaultOwnerSegments,
  describeAssignmentRule,
  newAssignmentRuleId,
  readCrmAssignmentRule,
  readCrmAssignmentSettings,
  roundRobinOrder,
  companyNameForDomain,
  findOrgMember,
  parseCrmMemberRef,
  CONTACT_LIFECYCLE_STAGES,
  CRM_AUTO_CREATE_COMPANIES_PATH,
  ORG_CRM_SETTINGS_FIELD,
  orgAutoCreatesCompanies,
  planContactCompanyLink,
  readContactCompanyLink,
  CONTACT_LIFECYCLE_STAGE_LABELS,
  advanceContactLifecycleStage,
  contactLifecycleStageAfterPurchase,
  crmMemberOption,
  CRM_ACTIVITY_KIND_LABELS,
  CRM_ACTIVITY_KINDS,
  CRM_COLLECTIONS,
  CRM_VIEW_MAX_FILTERS,
  crmContactCustomColumn,
  crmContactCustomKey,
  crmDefaultViewId,
  crmDefaultViewPatch,
  crmViewFiltersFromSegment,
  crmViewIsListed,
  crmViewSegmentFilters,
  crmViewStateEquals,
  EMPTY_CRM_VIEW_STATE,
  isCrmViewSection,
  normalizeCrmViewColumns,
  normalizeCrmViewFilters,
  normalizeCrmViewSort,
  normalizeCrmViewState,
  CRM_TASK_KIND_LABELS,
  CRM_TASK_KINDS,
  crmActivityRecordLink,
  type CrmActivityRow,
  crmReadTokens,
  crmScopeTokens,
  isCrmActivityKind,
  isCrmTaskKind,
  mergeContactTimeline,
  DEFAULT_DEAL_STAGES,
  dealStageById,
  isContactLifecycleStage,
  normalizeCompanyDomain,
  normalizeContactFieldKey,
  taskDueState,
  weightedDealAmountCents,
} from './crm'

describe('CRM collections', () => {
  it('names seven org subcollections, three of them prefixed', () => {
    expect(Object.values(CRM_COLLECTIONS)).toEqual([
      'companies',
      'pipelines',
      'deals',
      'crmTasks',
      'crmActivities',
      'contactFields',
      'crmViews',
    ])
  })
})

/**
 * A saved view (AGL-2617) is a list's filters, columns and sort under a
 * name. The helpers here are what hold a stored document to that shape,
 * decide what "unsaved changes" means, keep one person's private view out
 * of another's menu, and carry a segment across into the same grammar.
 */
describe('a saved view', () => {
  it('keeps only clauses that ask something', () => {
    expect(
      normalizeCrmViewFilters([
        { field: 'ownerUid', op: 'equals', value: 'uid-a', label: 'Dana' },
        // A valued operator with no value would match nothing.
        { field: 'name', op: 'startsWith', value: '  ' },
        // A valueless operator is a whole clause on its own.
        { field: 'ordersCount', op: 'isNotEmpty' },
        { field: '', op: 'equals', value: 'x' },
        { op: 'equals', value: 'x' },
        null,
        'garbage',
      ]),
    ).toEqual([
      { field: 'ownerUid', op: 'equals', value: 'uid-a', label: 'Dana' },
      { field: 'ordersCount', op: 'isNotEmpty', value: '' },
    ])
    expect(normalizeCrmViewFilters('not a list')).toEqual([])
    expect(
      normalizeCrmViewFilters(
        Array.from({ length: CRM_VIEW_MAX_FILTERS + 5 }, (_, index) => ({
          field: `f${index}`,
          op: 'equals',
          value: 'v',
        })),
      ),
    ).toHaveLength(CRM_VIEW_MAX_FILTERS)
  })

  it('reads columns as a de-duplicated list and the sort as one column', () => {
    expect(normalizeCrmViewColumns(['name', 'tags', 'name', '', 7])).toEqual([
      'name',
      'tags',
    ])
    expect(normalizeCrmViewSort({ field: 'name', direction: 'desc' })).toEqual({
      field: 'name',
      direction: 'desc',
    })
    // Anything but `desc` is ascending; no field is no sort.
    expect(normalizeCrmViewSort({ field: 'name', direction: 'sideways' })).toEqual({
      field: 'name',
      direction: 'asc',
    })
    expect(normalizeCrmViewSort({ direction: 'desc' })).toBeNull()
    expect(normalizeCrmViewState({ filters: null, columns: 'x', sort: 3 })).toEqual(
      EMPTY_CRM_VIEW_STATE,
    )
  })

  it('compares states on what is matched, not on the labels', () => {
    const state = normalizeCrmViewState({
      filters: [{ field: 'ownerUid', op: 'equals', value: 'uid-a', label: 'Dana' }],
      columns: ['name'],
      sort: { field: 'name', direction: 'asc' },
    })
    expect(
      crmViewStateEquals(state, {
        ...state,
        filters: [{ field: 'ownerUid', op: 'equals', value: 'uid-a' }],
      }),
    ).toBe(true)
    expect(crmViewStateEquals(state, { ...state, sort: null })).toBe(false)
    expect(
      crmViewStateEquals(state, { ...state, sort: { field: 'name', direction: 'desc' } }),
    ).toBe(false)
    expect(crmViewStateEquals(state, { ...state, columns: ['name', 'tags'] })).toBe(false)
    // Order is meaning: the first servable clause is the one the query runs.
    const two = {
      ...state,
      filters: [
        { field: 'tags', op: 'contains', value: 'vip' },
        { field: 'ownerUid', op: 'equals', value: 'uid-a' },
      ],
    }
    expect(
      crmViewStateEquals(two, { ...two, filters: [...two.filters].reverse() }),
    ).toBe(false)
  })

  it('lists a view for its owner, and for everybody once shared', () => {
    expect(crmViewIsListed({ shared: false, ownerUid: 'uid-a' }, 'uid-a')).toBe(true)
    expect(crmViewIsListed({ shared: false, ownerUid: 'uid-a' }, 'uid-b')).toBe(false)
    expect(crmViewIsListed({ shared: true, ownerUid: 'uid-a' }, 'uid-b')).toBe(true)
    expect(crmViewIsListed({ shared: false, ownerUid: 'uid-a' }, null)).toBe(false)
  })

  it('carries a segment into view clauses and back', () => {
    // One tag is the served `contains`; several are the OR the grammar calls `isAnyOf`.
    expect(crmViewFiltersFromSegment({ tags: ['vip'], sources: ['form'] })).toEqual([
      { field: 'tags', op: 'contains', value: 'vip' },
      { field: 'source', op: 'equals', value: 'form' },
    ])
    const filters = crmViewFiltersFromSegment({
      tags: ['vip', 'wholesale'],
      sources: ['form', 'order'],
    })
    expect(filters).toEqual([
      { field: 'tags', op: 'isAnyOf', value: 'vip,wholesale' },
      { field: 'source', op: 'isAnyOf', value: 'form,order' },
    ])
    expect(crmViewSegmentFilters(filters)).toEqual({
      tags: ['vip', 'wholesale'],
      sources: ['form', 'order'],
    })
    // Only the two dimensions a segment has are a segment's to keep.
    expect(
      crmViewSegmentFilters([
        { field: 'name', op: 'startsWith', value: 'a' },
        { field: 'ownerUid', op: 'equals', value: 'uid-a' },
      ]),
    ).toBeNull()
    expect(
      crmViewSegmentFilters([{ field: 'source', op: 'equals', value: 'carrier-pigeon' }]),
    ).toBeNull()
    expect(crmViewFiltersFromSegment({})).toEqual([])
  })

  it('reads and writes the default view on the profile, per org and section', () => {
    const profile = {
      notificationPrefs: { billing: false },
      crmDefaultViews: { 'org-1': { contacts: 'view-1', deals: '' } },
    }
    expect(crmDefaultViewId(profile, 'org-1', 'contacts')).toBe('view-1')
    expect(crmDefaultViewId(profile, 'org-1', 'deals')).toBeNull()
    expect(crmDefaultViewId(profile, 'org-2', 'contacts')).toBeNull()
    expect(crmDefaultViewId(null, 'org-1', 'contacts')).toBeNull()
    expect(crmDefaultViewPatch('org-1', 'tasks', 'view-9')).toEqual({
      crmDefaultViews: { 'org-1': { tasks: 'view-9' } },
    })
    expect(crmDefaultViewPatch('org-1', 'tasks', null)).toEqual({
      crmDefaultViews: { 'org-1': { tasks: null } },
    })
  })

  it('names a custom field column and reads the key back', () => {
    expect(crmContactCustomColumn('plan')).toBe('custom_plan')
    expect(crmContactCustomKey('custom_plan')).toBe('plan')
    expect(crmContactCustomKey('custom_')).toBeNull()
    expect(crmContactCustomKey('ownerUid')).toBeNull()
    expect(isCrmViewSection('contacts')).toBe(true)
    expect(isCrmViewSection('reports')).toBe(false)
  })
})

/**
 * The one planner every writer of the contact–company link asks
 * (AGL-2613): which id the facet takes, what the shared mirror becomes, and
 * which companies' counts move. The properties a second copy gets wrong are
 * the ones pinned here — an id another holder still names stays in the
 * mirror, and a count moves only when the mirror actually changes.
 */
describe('planContactCompanyLink', () => {
  const state = (
    companyId: string | null,
    companyIds: string[] = companyId ? [companyId] : [],
    heldElsewhere: string[] = [],
  ) => ({ companyId, companyIds, heldElsewhere })

  it('is a no-op when the facet already says what was asked', () => {
    expect(planContactCompanyLink(state('c-acme'), 'c-acme')).toBeNull()
    expect(planContactCompanyLink(state(null), null)).toBeNull()
  })

  it('links a first company by union, and counts it once', () => {
    expect(planContactCompanyLink(state(null), 'c-acme')).toEqual({
      companyId: 'c-acme',
      mirror: { op: 'union', companyId: 'c-acme' },
      counts: [{ companyId: 'c-acme', delta: 1 }],
    })
  })

  it('does not count a company another holder already put in the mirror', () => {
    // Site g-2 linked Jane to Acme; g-1 linking her too is one more facet,
    // not one more contact at Acme.
    expect(
      planContactCompanyLink(state(null, ['c-acme'], ['c-acme']), 'c-acme'),
    ).toEqual({
      companyId: 'c-acme',
      mirror: { op: 'union', companyId: 'c-acme' },
      counts: [],
    })
  })

  it('moves between companies by rewriting the mirror, and moves both counts', () => {
    expect(planContactCompanyLink(state('c-acme'), 'c-globex')).toEqual({
      companyId: 'c-globex',
      mirror: { op: 'set', companyIds: ['c-globex'] },
      counts: [
        { companyId: 'c-acme', delta: -1 },
        { companyId: 'c-globex', delta: 1 },
      ],
    })
  })

  it('keeps an old id in the mirror, uncounted, while another holder still names it', () => {
    expect(
      planContactCompanyLink(state('c-acme', ['c-acme'], ['c-acme']), 'c-globex'),
    ).toEqual({
      companyId: 'c-globex',
      mirror: { op: 'set', companyIds: ['c-acme', 'c-globex'] },
      counts: [{ companyId: 'c-globex', delta: 1 }],
    })
  })

  it('unlinks with a remove and a decrement, unless held elsewhere', () => {
    expect(planContactCompanyLink(state('c-acme'), null)).toEqual({
      companyId: null,
      mirror: { op: 'remove', companyId: 'c-acme' },
      counts: [{ companyId: 'c-acme', delta: -1 }],
    })
    expect(planContactCompanyLink(state('c-acme', ['c-acme'], ['c-acme']), null)).toEqual({
      companyId: null,
      mirror: null,
      counts: [],
    })
  })

  it('never decrements a company the mirror never carried', () => {
    // A facet linked before the mirror existed: the count never went up for
    // it, so letting go must not take it below what it is.
    expect(planContactCompanyLink(state('c-acme', []), null)).toEqual({
      companyId: null,
      mirror: { op: 'remove', companyId: 'c-acme' },
      counts: [],
    })
  })
})

describe('readContactCompanyLink', () => {
  it('reads this holder’s link, the mirror, and the ids other holders name', () => {
    const contact: Record<string, unknown> = {
      companyIds: ['c-acme', 'c-globex', 7],
      facets: {
        'g-1': { sources: {}, interactions: [], companyId: 'c-acme' },
        'g-2': { sources: {}, interactions: [], companyId: 'c-globex' },
        'g-3': { sources: {}, interactions: [] },
      },
    }
    expect(readContactCompanyLink(contact, 'g-1')).toEqual({
      companyId: 'c-acme',
      companyIds: ['c-acme', 'c-globex'],
      heldElsewhere: ['c-globex'],
    })
    expect(readContactCompanyLink({}, 'g-1')).toEqual({
      companyId: null,
      companyIds: [],
      heldElsewhere: [],
    })
  })
})

describe('companyNameForDomain', () => {
  it('capitalizes the first label — the starting name a minted company gets', () => {
    expect(companyNameForDomain('acme.com')).toBe('Acme')
    expect(companyNameForDomain('initech.co.uk')).toBe('Initech')
  })
})

/**
 * The CRM's org setting (AGL-2613): read off the raw document, off by
 * default, and declared client-writable so the coverage guard admits the
 * dotted-path write the settings section makes.
 */
describe('crm.autoCreateCompanies', () => {
  it('is off unless the org document says true', () => {
    expect(orgAutoCreatesCompanies(null)).toBe(false)
    expect(orgAutoCreatesCompanies({})).toBe(false)
    expect(orgAutoCreatesCompanies({ crm: {} })).toBe(false)
    expect(orgAutoCreatesCompanies({ crm: { autoCreateCompanies: 'yes' } })).toBe(false)
    expect(orgAutoCreatesCompanies({ crm: { autoCreateCompanies: true } })).toBe(true)
  })

  it('is written by the path the reader reads, on a key the client may write', () => {
    expect(CRM_AUTO_CREATE_COMPANIES_PATH).toBe(`${ORG_CRM_SETTINGS_FIELD}.autoCreateCompanies`)
    expect(Object.keys(ORG_CLIENT_WRITABLE_FIELDS)).toContain(ORG_CRM_SETTINGS_FIELD)
  })
})

describe('lifecycle stages', () => {
  it('labels every stage', () => {
    for (const stage of CONTACT_LIFECYCLE_STAGES) {
      expect(CONTACT_LIFECYCLE_STAGE_LABELS[stage]).toBeTruthy()
    }
  })

  it('recognizes a stage and refuses anything else', () => {
    expect(isContactLifecycleStage('lead')).toBe(true)
    expect(isContactLifecycleStage('sales-qualified')).toBe(true)
    expect(isContactLifecycleStage('Lead')).toBe(false)
    expect(isContactLifecycleStage('')).toBe(false)
    expect(isContactLifecycleStage(null)).toBe(false)
    expect(isContactLifecycleStage(3)).toBe(false)
  })
})

describe('task and activity kinds', () => {
  it('labels every kind, so a picker cannot show a bare identifier', () => {
    for (const kind of CRM_TASK_KINDS) {
      expect(CRM_TASK_KIND_LABELS[kind]).toBeTruthy()
    }
    for (const kind of CRM_ACTIVITY_KINDS) {
      expect(CRM_ACTIVITY_KIND_LABELS[kind]).toBeTruthy()
    }
  })

  it('recognizes a kind and refuses anything else', () => {
    expect(isCrmTaskKind('call')).toBe(true)
    expect(isCrmTaskKind('todo')).toBe(true)
    // `note` is an activity kind, not a task kind: the two lists overlap
    // and are not the same list.
    expect(isCrmTaskKind('note')).toBe(false)
    expect(isCrmTaskKind('')).toBe(false)
    expect(isCrmTaskKind(undefined)).toBe(false)
    expect(isCrmActivityKind('note')).toBe(true)
    expect(isCrmActivityKind('other')).toBe(true)
    expect(isCrmActivityKind('todo')).toBe(false)
    expect(isCrmActivityKind(4)).toBe(false)
  })
})

describe('advanceContactLifecycleStage', () => {
  it('fills an empty or unusable stage with the floor', () => {
    expect(advanceContactLifecycleStage(undefined, 'lead')).toBe('lead')
    expect(advanceContactLifecycleStage('', 'subscriber')).toBe('subscriber')
    expect(advanceContactLifecycleStage('vip', 'lead')).toBe('lead')
  })

  it('advances an earlier stage and keeps a later one', () => {
    expect(advanceContactLifecycleStage('subscriber', 'lead')).toBe('lead')
    expect(advanceContactLifecycleStage('lead', 'customer')).toBe('customer')
    expect(advanceContactLifecycleStage('customer', 'lead')).toBe('customer')
    expect(advanceContactLifecycleStage('sales-qualified', 'subscriber')).toBe(
      'sales-qualified',
    )
    expect(advanceContactLifecycleStage('evangelist', 'customer')).toBe('evangelist')
    // The deliberate escape hatch sits after every capture stage on purpose.
    expect(advanceContactLifecycleStage('other', 'customer')).toBe('other')
  })

  it('with no floor answers the stage as held, or nothing', () => {
    expect(advanceContactLifecycleStage('lead', undefined)).toBe('lead')
    expect(advanceContactLifecycleStage(undefined, undefined)).toBeUndefined()
    expect(advanceContactLifecycleStage('vip', undefined)).toBeUndefined()
  })
})

describe('contactLifecycleStageAfterPurchase', () => {
  it('makes a customer of somebody with no stage, or a stage before it', () => {
    expect(contactLifecycleStageAfterPurchase(undefined)).toBe('customer')
    expect(contactLifecycleStageAfterPurchase('')).toBe('customer')
    expect(contactLifecycleStageAfterPurchase('not-a-stage')).toBe('customer')
    expect(contactLifecycleStageAfterPurchase('subscriber')).toBe('customer')
    expect(contactLifecycleStageAfterPurchase('lead')).toBe('customer')
    expect(contactLifecycleStageAfterPurchase('opportunity')).toBe('customer')
  })

  it('never downgrades: a later stage survives a purchase', () => {
    expect(contactLifecycleStageAfterPurchase('customer')).toBe('customer')
    expect(contactLifecycleStageAfterPurchase('evangelist')).toBe('evangelist')
    // The deliberate escape hatch is a choice a sale must not undo.
    expect(contactLifecycleStageAfterPurchase('other')).toBe('other')
  })
})

describe('normalizeContactFieldKey', () => {
  it('turns a typed label into a stored key', () => {
    expect(normalizeContactFieldKey('Annual revenue')).toBe('annual_revenue')
    expect(normalizeContactFieldKey('  Lead Score (2026) ')).toBe('lead_score_2026')
    expect(normalizeContactFieldKey('first-name')).toBe('first_name')
    expect(normalizeContactFieldKey('already_ok')).toBe('already_ok')
  })

  it('makes the key start with a letter', () => {
    // A key that starts with a digit reads as a number in a filter and could
    // collide with an array index.
    expect(normalizeContactFieldKey('2024 budget')).toBe('budget')
    expect(normalizeContactFieldKey('__private')).toBe('private')
  })

  it('caps the key at forty characters', () => {
    const key = normalizeContactFieldKey('a'.repeat(60))
    expect(key).toHaveLength(40)
  })

  it('answers null when nothing usable survives', () => {
    expect(normalizeContactFieldKey('')).toBeNull()
    expect(normalizeContactFieldKey('   ')).toBeNull()
    expect(normalizeContactFieldKey('123')).toBeNull()
    expect(normalizeContactFieldKey('$$$')).toBeNull()
    expect(normalizeContactFieldKey(null)).toBeNull()
  })
})

describe('deal stages', () => {
  it('ships the default pipeline in order, one won and one lost', () => {
    expect(DEFAULT_DEAL_STAGES.map((stage) => stage.id)).toEqual([
      'qualified',
      'contact-made',
      'proposal-sent',
      'negotiation',
      'won',
      'lost',
    ])
    expect(DEFAULT_DEAL_STAGES.map((stage) => stage.probability)).toEqual([
      10, 20, 40, 60, 100, 0,
    ])
    expect(DEFAULT_DEAL_STAGES.filter((s) => s.kind === 'won')).toHaveLength(1)
    expect(DEFAULT_DEAL_STAGES.filter((s) => s.kind === 'lost')).toHaveLength(1)
    // Ascending and unique, so a sort on `order` is the pipeline's order.
    const orders = DEFAULT_DEAL_STAGES.map((stage) => stage.order)
    expect(orders).toEqual([...orders].sort((a, b) => a - b))
    expect(new Set(orders).size).toBe(orders.length)
  })

  it('finds a stage by id and answers null for one the pipeline lost', () => {
    const pipeline = { stages: [...DEFAULT_DEAL_STAGES] }
    expect(dealStageById(pipeline, 'negotiation')?.probability).toBe(60)
    expect(dealStageById(pipeline, 'gone')).toBeNull()
    expect(dealStageById(null, 'won')).toBeNull()
    expect(dealStageById({ stages: undefined as never }, 'won')).toBeNull()
  })
})

describe('weightedDealAmountCents', () => {
  const stage = { probability: 40 }

  it('weights an open deal by its stage probability', () => {
    expect(weightedDealAmountCents({ status: 'open', amountCents: 10_000 }, stage)).toBe(4_000)
    // Rounded to a whole cent.
    expect(weightedDealAmountCents({ status: 'open', amountCents: 1_001 }, stage)).toBe(400)
  })

  it('lets the status win over the stage', () => {
    expect(weightedDealAmountCents({ status: 'won', amountCents: 10_000 }, stage)).toBe(10_000)
    expect(weightedDealAmountCents({ status: 'lost', amountCents: 10_000 }, stage)).toBe(0)
  })

  it('answers zero for a missing amount or a stage the pipeline lost', () => {
    expect(weightedDealAmountCents({ status: 'open' }, stage)).toBe(0)
    expect(weightedDealAmountCents({ status: 'open', amountCents: 10_000 }, null)).toBe(0)
  })

  it('clamps a probability outside 0–100 and refuses a negative amount', () => {
    expect(weightedDealAmountCents({ status: 'open', amountCents: 100 }, { probability: 250 })).toBe(100)
    expect(weightedDealAmountCents({ status: 'open', amountCents: 100 }, { probability: -5 })).toBe(0)
    expect(weightedDealAmountCents({ status: 'open', amountCents: -100 }, stage)).toBe(0)
  })
})

describe('taskDueState', () => {
  // Local-time construction, because the calendar day is decided locally.
  const now = new Date(2026, 8, 5, 14, 30).getTime()

  it('reads a done task as done whatever its due date', () => {
    expect(taskDueState({ status: 'done', dueAtMs: now - 86_400_000 }, now)).toBe('done')
    expect(taskDueState({ status: 'done', dueAtMs: null }, now)).toBe('done')
  })

  it('reads no due date as none', () => {
    expect(taskDueState({ status: 'open' }, now)).toBe('none')
    expect(taskDueState({ status: 'open', dueAtMs: null }, now)).toBe('none')
    expect(taskDueState({ status: 'open', dueAtMs: Number.NaN }, now)).toBe('none')
  })

  it('reads the whole of today as today, even the part already past', () => {
    expect(taskDueState({ status: 'open', dueAtMs: new Date(2026, 8, 5, 9).getTime() }, now)).toBe('today')
    expect(taskDueState({ status: 'open', dueAtMs: new Date(2026, 8, 5, 23, 59).getTime() }, now)).toBe('today')
  })

  it('reads yesterday as overdue and tomorrow as upcoming', () => {
    expect(taskDueState({ status: 'open', dueAtMs: new Date(2026, 8, 4, 23, 59).getTime() }, now)).toBe('overdue')
    expect(taskDueState({ status: 'open', dueAtMs: new Date(2026, 8, 6, 0, 1).getTime() }, now)).toBe('upcoming')
  })
})

describe('normalizeCompanyDomain', () => {
  it('reduces a pasted URL to the bare hostname', () => {
    expect(normalizeCompanyDomain('https://www.Acme.com/about?x=1#top')).toBe('acme.com')
    expect(normalizeCompanyDomain('http://shop.acme.co.uk:8080/')).toBe('shop.acme.co.uk')
    expect(normalizeCompanyDomain('  ACME.COM.  ')).toBe('acme.com')
    expect(normalizeCompanyDomain('www.acme.com')).toBe('acme.com')
  })

  it('answers null for anything that is not a hostname', () => {
    expect(normalizeCompanyDomain('')).toBeNull()
    expect(normalizeCompanyDomain(null)).toBeNull()
    expect(normalizeCompanyDomain('acme')).toBeNull()
    expect(normalizeCompanyDomain('192.168.0.1')).toBeNull()
    expect(normalizeCompanyDomain('-acme.com')).toBeNull()
    expect(normalizeCompanyDomain('acme .com')).toBeNull()
    expect(normalizeCompanyDomain('acme.c')).toBeNull()
  })
})

describe('companyDomainForEmail', () => {
  it('reads the domain off a work address', () => {
    expect(companyDomainForEmail('Jo@Acme.com')).toBe('acme.com')
    expect(companyDomainForEmail(' jo@sales.acme.co.uk ')).toBe('sales.acme.co.uk')
  })

  it('answers null for a public mailbox — that domain names no company', () => {
    expect(companyDomainForEmail('jo@gmail.com')).toBeNull()
    expect(companyDomainForEmail('jo@Outlook.com')).toBeNull()
    expect(companyDomainForEmail('jo@icloud.com')).toBeNull()
  })

  it('answers null for anything that is not an address', () => {
    expect(companyDomainForEmail('')).toBeNull()
    expect(companyDomainForEmail('acme.com')).toBeNull()
    expect(companyDomainForEmail('@acme.com')).toBeNull()
    expect(companyDomainForEmail('jo@')).toBeNull()
    expect(companyDomainForEmail('jo smith@acme.com')).toBeNull()
    expect(companyDomainForEmail('jo@acme')).toBeNull()
  })
})

/**
 * The stamp every CRM creator writes, and the contact create path's own
 * expression — the assertions here are the three branches
 * `upsert-contact.ts` takes.
 */
describe('crmScopeTokens', () => {
  it('stamps this site alone when the site pools with nobody', () => {
    expect(crmScopeTokens({}, soloConsentGroup('host-a'))).toEqual(['host:host-a'])
    expect(crmScopeTokens(null, soloConsentGroup('host-a'))).toEqual(['host:host-a'])
  })

  it('stamps every site of a declared group', () => {
    const org = {
      consentGroups: { brand: { name: 'Brand', hostIds: ['host-b', 'host-a'] } },
    }
    expect(crmScopeTokens(org, consentGroupForHost(org, 'host-a'))).toEqual([
      'host:host-a',
      'host:host-b',
    ])
  })

  it("stamps the whole org only when the org has chosen that default", () => {
    expect(crmScopeTokens({ defaultResourceScope: 'org' }, soloConsentGroup('host-a'))).toEqual(['org'])
    // The other value of the same field is the narrow answer, not a third.
    expect(crmScopeTokens({ defaultResourceScope: 'host' }, soloConsentGroup('host-a'))).toEqual(['host:host-a'])
  })
})

/**
 * What a person logs (AGL-2600): the kinds, their labels, and which of them
 * carry an outcome — the dialog's picker and the list's chip both read from
 * here, so the two cannot disagree about what a `meeting` is called.
 */
describe('activity kinds', () => {
  it('labels every kind, in picker order', () => {
    expect(CRM_ACTIVITY_KINDS).toEqual(['call', 'email', 'meeting', 'note', 'other'])
    for (const kind of CRM_ACTIVITY_KINDS) {
      expect(CRM_ACTIVITY_KIND_LABELS[kind]).toBeTruthy()
    }
  })

  it('recognizes a kind and refuses anything else', () => {
    expect(isCrmActivityKind('call')).toBe(true)
    expect(isCrmActivityKind('note')).toBe(true)
    expect(isCrmActivityKind('Call')).toBe(false)
    expect(isCrmActivityKind('todo')).toBe(false)
    expect(isCrmActivityKind(null)).toBe(false)
  })

  it('gives a call and a meeting an outcome, and nothing else one', () => {
    expect(activityKindHasOutcome('call')).toBe(true)
    expect(activityKindHasOutcome('meeting')).toBe(true)
    expect(activityKindHasOutcome('email')).toBe(false)
    expect(activityKindHasOutcome('note')).toBe(false)
    expect(activityKindHasOutcome('other')).toBe(false)
  })
})

/**
 * The read set a CRM listener filters by: the org token, then the group's
 * sites — the contacts list's own expression, capped where
 * `array-contains-any` caps.
 */
describe('crmReadTokens', () => {
  it('leads with the org token and follows with every site of the group', () => {
    expect(crmReadTokens(soloConsentGroup('host-a'))).toEqual(['org', 'host:host-a'])
    const org = {
      consentGroups: { brand: { name: 'Brand', hostIds: ['host-b', 'host-a'] } },
    }
    expect(crmReadTokens(consentGroupForHost(org, 'host-a'))).toEqual([
      'org',
      'host:host-a',
      'host:host-b',
    ])
  })

  it('caps at what array-contains-any accepts', () => {
    // The widest group the resolver admits is exactly the operator's cap, so
    // the org token in front of it is the one token over — built directly,
    // because `consentGroupForHost` refuses a declaration any wider.
    const hostIds = Array.from({ length: 30 }, (_, index) => `host-${index}`)
    const group = { hostId: 'host-0', groupId: 'wide', name: 'Wide', hostIds, declared: true }
    const tokens = crmReadTokens(group)
    expect(tokens).toHaveLength(30)
    expect(tokens[0]).toBe('org')
  })
})

const activity = (overrides: Partial<CrmActivityRow> & { $id: string }): CrmActivityRow => ({
  kind: 'call',
  body: 'Called about the renewal',
  atMs: 0,
  byUid: 'u-1',
  hostId: 'host-a',
  visibleTo: ['host:host-a'],
  ...overrides,
})

/**
 * ONE stream from two histories (AGL-2600): what the platform captured on
 * the contact's facet, and what a person logged beside it.
 */
describe('mergeContactTimeline', () => {
  const captured: ContactInteraction[] = [
    { type: 'form', atMs: 3_000, summary: 'Submitted the contact form', path: '/pricing' },
    { type: 'order', atMs: 1_000, summary: 'Placed order #12', refId: 'ord-12' },
  ]

  it('interleaves both kinds newest-first and says which is which', () => {
    const merged = mergeContactTimeline(captured, [
      activity({ $id: 'a-1', atMs: 2_000 }),
      activity({ $id: 'a-2', atMs: 4_000, kind: 'note' }),
    ])
    expect(merged.map((entry) => [entry.kind, entry.atMs])).toEqual([
      ['logged', 4_000],
      ['captured', 3_000],
      ['logged', 2_000],
      ['captured', 1_000],
    ])
    const [first] = merged
    if (first.kind !== 'logged') throw new Error('expected the logged note first')
    expect(first.activity.$id).toBe('a-2')
    const second = merged[1]
    if (second.kind !== 'captured') throw new Error('expected the captured form second')
    expect(second.interaction.path).toBe('/pricing')
  })

  it('is stable: a tie keeps the captured entry before the logged one, and input order within a kind', () => {
    const merged = mergeContactTimeline(
      [
        { type: 'form', atMs: 5_000, summary: 'first' },
        { type: 'form', atMs: 5_000, summary: 'second' },
      ],
      [activity({ $id: 'a-1', atMs: 5_000 }), activity({ $id: 'a-2', atMs: 5_000 })],
    )
    expect(
      merged.map((entry) =>
        entry.kind === 'captured' ? entry.interaction.summary : entry.activity.$id,
      ),
    ).toEqual(['first', 'second', 'a-1', 'a-2'])
  })

  it('gives every entry a distinct key and copes with either side absent', () => {
    const merged = mergeContactTimeline(captured, [activity({ $id: 'a-1', atMs: 3_000 })])
    expect(new Set(merged.map((entry) => entry.key)).size).toBe(merged.length)
    expect(mergeContactTimeline(undefined, undefined)).toEqual([])
    expect(mergeContactTimeline(captured, null)).toHaveLength(2)
    expect(mergeContactTimeline(null, [activity({ $id: 'a-1' })])).toHaveLength(1)
  })

  it('sinks an entry with no usable time to the bottom rather than the top', () => {
    const merged = mergeContactTimeline(
      [{ type: 'form', atMs: Number.NaN, summary: 'undated' }],
      [activity({ $id: 'a-1', atMs: 1_000 })],
    )
    expect(merged.map((entry) => entry.kind)).toEqual(['logged', 'captured'])
  })
})

/**
 * Which record a logged activity is about, for the feed that links to it.
 * A contact outranks a deal outranks a company: an activity filed against
 * all three is a conversation with a person.
 */
describe('crmActivityRecordLink', () => {
  it('prefers the contact, then the deal, then the company', () => {
    expect(
      crmActivityRecordLink({ contactId: 'c', dealId: 'd', companyId: 'o' }),
    ).toEqual({ record: 'contact', id: 'c' })
    expect(crmActivityRecordLink({ dealId: 'd', companyId: 'o' })).toEqual({
      record: 'deal',
      id: 'd',
    })
    expect(crmActivityRecordLink({ companyId: 'o' })).toEqual({ record: 'company', id: 'o' })
  })

  it('answers null for an activity filed against nothing', () => {
    expect(crmActivityRecordLink({})).toBeNull()
    expect(crmActivityRecordLink({ contactId: '' })).toBeNull()
  })
})

/**
 * How long ago something happened, in the words a list row uses. The
 * thresholds are the assertions; the far past is a date, not "412 days ago".
 */
describe('activityTimeLabel', () => {
  const now = Date.UTC(2026, 8, 5, 12, 0, 0)
  const minutes = (count: number) => count * 60_000
  const hours = (count: number) => count * 3_600_000
  const days = (count: number) => count * 86_400_000

  it('reads the recent past in minutes, hours and days', () => {
    expect(activityTimeLabel(now - 10_000, now)).toBe('just now')
    expect(activityTimeLabel(now - minutes(1), now)).toBe('1 min ago')
    expect(activityTimeLabel(now - minutes(45), now)).toBe('45 min ago')
    expect(activityTimeLabel(now - hours(1), now)).toBe('1 h ago')
    expect(activityTimeLabel(now - hours(23), now)).toBe('23 h ago')
    expect(activityTimeLabel(now - hours(30), now)).toBe('yesterday')
    expect(activityTimeLabel(now - days(3), now)).toBe('3 days ago')
  })

  it('falls back to a date past a week, and for a time in the future', () => {
    const old = now - days(30)
    expect(activityTimeLabel(old, now)).toBe(new Date(old).toLocaleDateString())
    const ahead = now + hours(2)
    expect(activityTimeLabel(ahead, now)).toBe(new Date(ahead).toLocaleDateString())
  })

  it('says nothing for a time that is not one', () => {
    expect(activityTimeLabel(Number.NaN, now)).toBe('')
  })
})

/**
 * The team, as a record names them (AGL-2614): a reference is a uid or an
 * address, a member is listed whether or not the document carries an
 * address, and the roster is the only directory consulted.
 */
describe('parseCrmMemberRef', () => {
  it('reads an address as an address, normalized', () => {
    expect(parseCrmMemberRef(' Sam@Example.com ')).toEqual({
      kind: 'email',
      email: 'sam@example.com',
    })
  })

  it('reads anything else as a uid', () => {
    expect(parseCrmMemberRef('uid-sam')).toEqual({ kind: 'uid', uid: 'uid-sam' })
  })

  it('names nobody for a blank, and for an address that is not one', () => {
    expect(parseCrmMemberRef('')).toBeNull()
    expect(parseCrmMemberRef('   ')).toBeNull()
    expect(parseCrmMemberRef(null)).toBeNull()
    expect(parseCrmMemberRef('not@an')).toBeNull()
  })
})

describe('crmMemberOption', () => {
  it('labels by display name, then address, then uid', () => {
    expect(crmMemberOption({ $id: 'u1', displayName: 'Ada', email: 'ada@example.com' })).toEqual({
      uid: 'u1',
      label: 'Ada',
      email: 'ada@example.com',
    })
    expect(crmMemberOption({ $id: 'u2', email: 'sam@example.com' })).toEqual({
      uid: 'u2',
      label: 'sam@example.com',
      email: 'sam@example.com',
    })
  })

  it('lists a member whose document has no address, by name or by uid', () => {
    // The re-granted and the address-less adds: still on the team, still
    // pickable, never a blank line and never dropped.
    expect(crmMemberOption({ $id: 'u3', displayName: 'Grace' })).toEqual({
      uid: 'u3',
      label: 'Grace',
    })
    expect(crmMemberOption({ $id: 'u4', displayName: '' })).toEqual({ uid: 'u4', label: 'u4' })
  })

  it('refuses a row with no uid', () => {
    expect(crmMemberOption({ email: 'nobody@example.com' })).toBeNull()
  })
})

describe('findOrgMember', () => {
  const roster = [
    { uid: 'u1', label: 'Ada', email: 'ada@example.com' },
    { uid: 'u3', label: 'Grace' },
  ]

  it('resolves by uid, and by address when the record carries one', () => {
    expect(findOrgMember(roster, 'u3')?.label).toBe('Grace')
    expect(findOrgMember(roster, 'Ada@Example.com')?.uid).toBe('u1')
  })

  it('names nobody for a stranger, a blank, or an address nobody has', () => {
    expect(findOrgMember(roster, 'u9')).toBeUndefined()
    expect(findOrgMember(roster, '')).toBeUndefined()
    expect(findOrgMember(roster, 'ghost@example.com')).toBeUndefined()
  })
})

/*==========================================
 * WHO A NEW RECORD BELONGS TO (AGL-2618).
 *
 * The settings are read tolerantly off the raw org document, a rule matches
 * only when every condition it names holds, the pool is tried from the
 * member after the last recipient, and every path the section writes is
 * under the one key the org's client branch admits.
 *=========================================*/
describe('crm assignment settings', () => {
  it('reads nothing from an org that has set nothing', () => {
    for (const org of [null, undefined, {}, { crm: {} }, { crm: 'no' }]) {
      expect(readCrmAssignmentSettings(org as never)).toEqual({
        rules: [],
        pool: { memberUids: [], lastAssignedUid: null },
        hostDefaultOwners: {},
      })
    }
  })

  it('reads the rules in order, dropping the ones that cannot assign', () => {
    const { rules } = readCrmAssignmentSettings({
      crm: {
        assignmentRules: [
          { id: 'a', when: { source: 'form' }, assign: { memberUid: ' uid-1 ' } },
          // No id: nothing could reorder or delete it.
          { when: {}, assign: { memberUid: 'uid-2' } },
          // Names nobody and no pool.
          { id: 'c', when: {}, assign: {} },
          // A source outside the capture vocabulary is not a condition.
          { id: 'd', when: { source: 'carrier-pigeon', tag: ' VIP ' }, assign: { roundRobin: true } },
          'not a rule',
          null,
          { id: 'f', when: { emailDomain: '@Acme.COM', formId: 'form-1' }, assign: { memberUid: 'uid-3' } },
        ],
      },
    })
    expect(rules).toEqual([
      { id: 'a', when: { source: 'form' }, assign: { memberUid: 'uid-1' } },
      { id: 'd', when: { tag: 'vip' }, assign: { roundRobin: true } },
      { id: 'f', when: { emailDomain: 'acme.com', formId: 'form-1' }, assign: { memberUid: 'uid-3' } },
    ])
  })

  it('caps the rules and the pool at the section’s ceilings, and dedupes the pool', () => {
    const rules = Array.from({ length: CRM_ASSIGNMENT_RULES_MAX + 5 }, (_, index) => ({
      id: `r${index}`,
      when: {},
      assign: { memberUid: 'uid' },
    }))
    const memberUids = [
      ...Array.from({ length: CRM_ROUND_ROBIN_POOL_MAX + 5 }, (_, index) => `m${index}`),
      'm0',
    ]
    const settings = readCrmAssignmentSettings({
      crm: { assignmentRules: rules, roundRobin: { memberUids, lastAssignedUid: 'm3' } },
    })
    expect(settings.rules).toHaveLength(CRM_ASSIGNMENT_RULES_MAX)
    expect(settings.pool.memberUids).toHaveLength(CRM_ROUND_ROBIN_POOL_MAX)
    expect(new Set(settings.pool.memberUids).size).toBe(CRM_ROUND_ROBIN_POOL_MAX)
    expect(settings.pool.lastAssignedUid).toBe('m3')
  })

  it('reads a site’s default owner and ignores a site that set none', () => {
    const org = {
      crm: { hosts: { 'site-1': { defaultOwnerUid: 'uid-lead' }, 'site-2': {}, 'site-3': 'x' } },
    }
    expect(readCrmAssignmentSettings(org).hostDefaultOwners).toEqual({ 'site-1': 'uid-lead' })
    expect(crmHostDefaultOwner(org, 'site-1')).toBe('uid-lead')
    expect(crmHostDefaultOwner(org, 'site-2')).toBeNull()
    expect(crmHostDefaultOwner(null, 'site-1')).toBeNull()
  })

  it('reads one rule on its own, the way the drawer validates it', () => {
    expect(readCrmAssignmentRule({ id: 'x', when: {}, assign: { roundRobin: true } })).toEqual({
      id: 'x',
      when: {},
      assign: { roundRobin: true },
    })
    expect(readCrmAssignmentRule({ id: 'x', when: {}, assign: { roundRobin: 'yes' } })).toBeNull()
    expect(readCrmAssignmentRule({ id: '', when: {}, assign: { memberUid: 'u' } })).toBeNull()
    expect(readCrmAssignmentRule([])).toBeNull()
  })

  it('writes by paths under the one key the client may write', () => {
    for (const path of [
      CRM_ASSIGNMENT_RULES_PATH,
      CRM_ROUND_ROBIN_POOL_PATH,
      CRM_ROUND_ROBIN_LAST_ASSIGNED_PATH,
    ]) {
      expect(path.startsWith(`${ORG_CRM_SETTINGS_FIELD}.`)).toBe(true)
    }
    expect(crmHostDefaultOwnerSegments('site.with.dots')).toEqual([
      ORG_CRM_SETTINGS_FIELD,
      'hosts',
      'site.with.dots',
      'defaultOwnerUid',
    ])
    expect(() => crmHostDefaultOwnerSegments('')).toThrow()
    expect(Object.keys(ORG_CLIENT_WRITABLE_FIELDS)).toContain(ORG_CRM_SETTINGS_FIELD)
  })
})

describe('assignmentRuleMatches', () => {
  const capture = {
    source: 'form' as const,
    email: 'Jo@Acme.com',
    formId: 'form-1',
    tags: ['VIP', 'newsletter'],
  }

  it('matches every capture when it names no condition', () => {
    expect(assignmentRuleMatches({}, capture)).toBe(true)
    expect(assignmentRuleMatches({}, { source: 'order', email: 'x@y.z' })).toBe(true)
  })

  it('holds every condition it names, and fails on the first that does not', () => {
    expect(assignmentRuleMatches({ source: 'form', formId: 'form-1' }, capture)).toBe(true)
    expect(assignmentRuleMatches({ source: 'booking' }, capture)).toBe(false)
    expect(assignmentRuleMatches({ formId: 'form-2' }, capture)).toBe(false)
    expect(assignmentRuleMatches({ formId: 'form-1' }, { ...capture, formId: null })).toBe(false)
  })

  it('compares the address’s own domain, public mailboxes included', () => {
    expect(assignmentRuleMatches({ emailDomain: 'acme.com' }, capture)).toBe(true)
    expect(assignmentRuleMatches({ emailDomain: 'acme.co' }, capture)).toBe(false)
    expect(
      assignmentRuleMatches({ emailDomain: 'gmail.com' }, { source: 'form', email: 'a@Gmail.com' }),
    ).toBe(true)
    expect(assignmentEmailDomain('a@Gmail.com')).toBe('gmail.com')
    expect(assignmentEmailDomain('no-at-sign')).toBeNull()
    // Where the company link answers null for a consumer domain, a rule may
    // still name it: the two questions are different.
    expect(companyDomainForEmail('a@gmail.com')).toBeNull()
  })

  it('matches a tag regardless of case, against the capture’s and the contact’s', () => {
    expect(assignmentRuleMatches({ tag: 'vip' }, capture)).toBe(true)
    expect(assignmentRuleMatches({ tag: 'partner' }, capture)).toBe(false)
    expect(assignmentRuleMatches({ tag: 'vip' }, { ...capture, tags: undefined })).toBe(false)
  })
})

describe('roundRobinOrder', () => {
  it('starts after the last recipient and wraps round to them', () => {
    expect(roundRobinOrder(['a', 'b', 'c'], 'a')).toEqual(['b', 'c', 'a'])
    expect(roundRobinOrder(['a', 'b', 'c'], 'c')).toEqual(['a', 'b', 'c'])
  })

  it('starts from the top for no pointer, or a pointer no longer in the pool', () => {
    expect(roundRobinOrder(['a', 'b'], null)).toEqual(['a', 'b'])
    expect(roundRobinOrder(['a', 'b'], 'gone')).toEqual(['a', 'b'])
  })

  it('assigns a pool of one to that one, and an empty pool to nobody', () => {
    expect(roundRobinOrder(['a'], 'a')).toEqual(['a'])
    expect(roundRobinOrder([], 'a')).toEqual([])
  })
})

describe('describeAssignmentRule', () => {
  const name = (uid: string) => (uid === 'uid-1' ? 'Sam' : uid)

  it('reads the conditions in words and the target by name', () => {
    expect(
      describeAssignmentRule(
        {
          id: 'r',
          when: { source: 'form', formId: 'f1', emailDomain: 'acme.com', tag: 'vip' },
          assign: { memberUid: 'uid-1' },
        },
        name,
      ),
    ).toEqual({
      when: 'source is Form and form is f1 and email domain is acme.com and tagged vip',
      assign: 'Sam',
    })
    expect(
      describeAssignmentRule({ id: 'r', when: {}, assign: { roundRobin: true } }, name),
    ).toEqual({ when: 'Every capture', assign: 'Round robin' })
  })
})

describe('newAssignmentRuleId', () => {
  it('mints an id the org does not already hold', () => {
    const first = newAssignmentRuleId([])
    expect(first).toMatch(/^rule-/)
    const second = newAssignmentRuleId([first])
    expect(second).not.toBe(first)
  })
})
