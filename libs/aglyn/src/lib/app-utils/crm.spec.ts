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
import {
  companyDomainForEmail,
  CONTACT_LIFECYCLE_STAGES,
  CONTACT_LIFECYCLE_STAGE_LABELS,
  CRM_ACTIVITY_KIND_LABELS,
  CRM_ACTIVITY_KINDS,
  CRM_COLLECTIONS,
  CRM_TASK_KIND_LABELS,
  CRM_TASK_KINDS,
  crmScopeTokens,
  isCrmActivityKind,
  isCrmTaskKind,
  DEFAULT_DEAL_STAGES,
  dealStageById,
  isContactLifecycleStage,
  normalizeCompanyDomain,
  normalizeContactFieldKey,
  taskDueState,
  weightedDealAmountCents,
} from './crm'

describe('CRM collections', () => {
  it('names six org subcollections, two of them prefixed', () => {
    expect(Object.values(CRM_COLLECTIONS)).toEqual([
      'companies',
      'pipelines',
      'deals',
      'crmTasks',
      'crmActivities',
      'contactFields',
    ])
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
