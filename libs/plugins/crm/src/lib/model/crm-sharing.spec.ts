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
 * CRM sharing's model (AGL-3336): what a record stores for its grants, what
 * a rule matches, and what a site sees.
 *
 * The claims that carry the feature: a share WIDENS `visibleTo` (so the
 * target site's own list query returns it) and nothing else; taking a
 * share away removes only what shares alone added, never a token the record
 * holds; a capture on the target site makes its token held; `writeTo` is
 * the held scope plus edit grants; and a rule re-evaluated on an unchanged
 * record plans no write.
 */

import {
  crmReadTokens,
  heldByHost,
  heldScopeTokens,
  seenOnlyThroughGrant,
  soloConsentGroup,
  visibleToTokens,
} from '@aglyn/aglyn'
import {
  crmRecordWritableBy,
  crmShareChipFor,
  crmShareChipLabel,
  crmSharingRuleMatches,
  type CrmSharingRule,
  describeRecordSharing,
  evaluateRecordGrants,
  manualGrantKey,
  planRecordSharing,
  readCrmSharingRules,
  recordHeldScope,
  ruleGrantKey,
  sharingPlanChanges,
  shareTargetsFrom,
  withManualShares,
  withoutManualShares,
} from './crm-sharing'

const A = 'host:site-a'
const B = 'host:site-b'
const C = 'host:site-c'
const BY = { uid: 'uid-dana', name: 'Dana' }

/** A record with a plan applied, as the transaction would store it. */
function stored(
  record: Record<string, unknown>,
  plan: ReturnType<typeof planRecordSharing>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...record, visibleTo: plan.visibleTo }
  if (plan.writeTo) next['writeTo'] = plan.writeTo
  else delete next['writeTo']
  if (plan.sharing) next['sharing'] = plan.sharing
  else delete next['sharing']
  return next
}

function rule(overrides: Partial<CrmSharingRule> = {}): CrmSharingRule {
  return {
    id: 'r1',
    name: 'Brand A leads',
    object: 'leads',
    enabled: true,
    sourceHostIds: ['site-a'],
    criteria: {},
    targets: ['org'],
    access: 'read',
    createdAtMs: 1,
    updatedAtMs: 1,
    ...overrides,
  }
}

const leadOnA = (): Record<string, unknown> => ({
  email: 'p@acme.test',
  hostId: 'site-a',
  capturedByHostIds: ['site-a'],
  visibleTo: [A],
  status: 'new',
})

describe('a manual share (AGL-3336)', () => {
  it('adds the target to visibleTo, so the target site’s own list query returns the record', () => {
    const lead = leadOnA()
    // Before: site B's read set does not reach the lead.
    expect(visibleToTokens(lead['visibleTo'] as string[], crmReadTokens(soloConsentGroup('site-b')))).toBe(false)
    const plan = planRecordSharing(lead, withManualShares({}, [B], 'read', BY, 10))
    expect(plan.visibleTo).toEqual([A, B])
    expect(plan.sharing?.added).toEqual([B])
    // After: the SAME `array-contains-any` the site's list sends admits it.
    expect(visibleToTokens(plan.visibleTo, crmReadTokens(soloConsentGroup('site-b')))).toBe(true)
    // …and a third site still cannot see it.
    expect(visibleToTokens(plan.visibleTo, crmReadTokens(soloConsentGroup('site-c')))).toBe(false)
  })

  it('shares with every site — including one created later — through the org token', () => {
    const plan = planRecordSharing(leadOnA(), withManualShares({}, ['org'], 'read', BY, 10))
    expect(plan.visibleTo).toEqual([A, 'org'])
    // A site that did not exist when the share was made reads `org` too.
    expect(visibleToTokens(plan.visibleTo, crmReadTokens(soloConsentGroup('site-created-later')))).toBe(true)
    expect(plan.sharing?.orgWideHeldBy).toEqual([A])
  })

  it('is read-only by default: writeTo is the held scope', () => {
    const plan = planRecordSharing(leadOnA(), withManualShares({}, [B], 'read', BY, 10))
    expect(plan.writeTo).toEqual([A])
    const record = stored(leadOnA(), plan)
    expect(crmRecordWritableBy(record, ['org', B])).toBe(false)
    expect(crmRecordWritableBy(record, ['org', A])).toBe(true)
  })

  it('writes from the target only when the grant says edit', () => {
    const plan = planRecordSharing(leadOnA(), withManualShares({}, [B], 'edit', BY, 10))
    expect(plan.writeTo).toEqual([A, B])
    expect(crmRecordWritableBy(stored(leadOnA(), plan), ['org', B])).toBe(true)
  })

  it('unsharing removes only what the share added, never a consent-group token', () => {
    // A lead held by A and B (a consent group), then shared with B and C.
    const lead = { ...leadOnA(), visibleTo: [A, B], capturedByHostIds: ['site-a'] }
    const shared = stored(lead, planRecordSharing(lead, withManualShares({}, [B, C], 'read', BY, 10)))
    expect(shared['visibleTo']).toEqual([A, B, C])
    expect((shared['sharing'] as { added: string[] }).added).toEqual([C])
    const grants = withoutManualShares(evaluateRecordGrants('leads', shared, [], 20), [B, C])
    const plan = planRecordSharing(shared, grants)
    expect(plan.visibleTo).toEqual([A, B])
    expect(plan.sharing).toBeNull()
    expect(plan.writeTo).toBeNull()
  })

  it('keeps a site that later captured the person when the share goes', () => {
    const shared = stored(leadOnA(), planRecordSharing(leadOnA(), withManualShares({}, [B], 'read', BY, 10)))
    // Site B captures the same person itself: the capture door arrayUnions
    // its token (already present) and records the capture.
    const captured = { ...shared, capturedByHostIds: ['site-a', 'site-b'] }
    expect(recordHeldScope(captured)).toEqual([A, B])
    const plan = planRecordSharing(captured, withoutManualShares(evaluateRecordGrants('leads', captured, [], 20), [B]))
    expect(plan.visibleTo).toEqual([A, B])
  })

  it('names who shared it on the target site, and nothing on the holding site', () => {
    const record = stored(leadOnA(), planRecordSharing(leadOnA(), withManualShares({}, [B], 'read', BY, 10)))
    const chip = crmShareChipFor(record, ['site-b'])
    expect(chip).toMatchObject({ source: 'manual', access: 'read', byName: 'Dana', allSites: false })
    expect(crmShareChipLabel(chip!)).toBe('Shared by Dana')
    expect(crmShareChipFor(record, ['site-a'])).toBeNull()
    // The organization level has no viewing site.
    expect(crmShareChipFor(record, [])).toBeNull()
  })

  it('describes where the record is visible and why, sources kept apart', () => {
    const record = stored(
      leadOnA(),
      planRecordSharing(leadOnA(), {
        ...withManualShares({}, [B], 'edit', BY, 10),
        [ruleGrantKey('r1')]: { source: 'rule', ruleId: 'r1', tokens: ['org'], access: 'read', atMs: 5 },
      }),
    )
    expect(describeRecordSharing(record)).toEqual([
      { kind: 'held', hostIds: ['site-a'], allSites: false },
      { kind: 'manual', key: manualGrantKey(B), token: B, access: 'edit', byName: 'Dana', atMs: 10 },
      { kind: 'rule', key: 'rule_r1', ruleId: 'r1', tokens: ['org'], access: 'read', atMs: 5 },
    ])
  })

  it('adds nothing to a record every site already holds', () => {
    const lead = { ...leadOnA(), visibleTo: ['org'] }
    const plan = planRecordSharing(lead, withManualShares({}, [B], 'read', BY, 10))
    expect(plan.visibleTo).toEqual(['org'])
    expect(plan.sharing?.added).toEqual([])
  })

  it('plans no write for a record whose grants are unchanged', () => {
    const record = stored(leadOnA(), planRecordSharing(leadOnA(), withManualShares({}, [B], 'read', BY, 10)))
    const again = planRecordSharing(record, evaluateRecordGrants('leads', record, [], 99))
    expect(sharingPlanChanges(record, again)).toBe(false)
    expect(sharingPlanChanges(leadOnA(), planRecordSharing(leadOnA(), {}))).toBe(false)
  })
})

describe('the held scope, as core reads it (AGL-3336)', () => {
  it('never counts a site a record was only shared with as a holder, or as its audience', () => {
    const record = stored(leadOnA(), planRecordSharing(leadOnA(), withManualShares({}, [B], 'read', BY, 10)))
    expect(heldScopeTokens(record)).toEqual([A])
    expect(heldByHost(record, 'site-a')).toBe(true)
    expect(heldByHost(record, 'site-b')).toBe(false)
    expect(seenOnlyThroughGrant(record, 'site-b')).toBe(true)
    expect(seenOnlyThroughGrant(record, 'site-a')).toBe(false)
    // A record never shared is held by everything that sees it.
    expect(seenOnlyThroughGrant(leadOnA(), 'site-b')).toBe(false)
  })
})

describe('sharing rules (AGL-3336)', () => {
  it('match on the capturing site and the criteria — AND across, OR within', () => {
    const lead = { ...leadOnA(), leadSource: 'Webinar', tags: ['vip'], ownerUid: 'u1' }
    expect(crmSharingRuleMatches(rule(), 'leads', lead)).toBe(true)
    expect(crmSharingRuleMatches(rule({ sourceHostIds: ['site-b'] }), 'leads', lead)).toBe(false)
    expect(crmSharingRuleMatches(rule({ criteria: { leadSources: ['webinar', 'Ads'] } }), 'leads', lead)).toBe(true)
    expect(
      crmSharingRuleMatches(rule({ criteria: { leadSources: ['Webinar'], tags: ['cold'] } }), 'leads', lead),
    ).toBe(false)
    expect(crmSharingRuleMatches(rule({ criteria: { stages: ['new'] } }), 'leads', lead)).toBe(true)
    expect(crmSharingRuleMatches(rule({ criteria: { ownerUids: ['u2'] } }), 'leads', lead)).toBe(false)
    // Another object, a switched-off rule and a rule being deleted match nothing.
    expect(crmSharingRuleMatches(rule({ object: 'contacts' }), 'leads', lead)).toBe(false)
    expect(crmSharingRuleMatches(rule({ enabled: false }), 'leads', lead)).toBe(false)
    expect(crmSharingRuleMatches(rule({ deleting: true }), 'leads', lead)).toBe(false)
  })

  it('read a contact through every holder’s facet', () => {
    const contact = {
      email: 'p@acme.test',
      hostId: 'site-a',
      visibleTo: [A],
      facets: { 'site-a': { tags: ['VIP'], lifecycleStage: 'customer', ownerUid: 'u1' } },
    }
    expect(crmSharingRuleMatches(rule({ object: 'contacts', criteria: { tags: ['vip'] } }), 'contacts', contact)).toBe(true)
    expect(
      crmSharingRuleMatches(rule({ object: 'contacts', criteria: { stages: ['lead'] } }), 'contacts', contact),
    ).toBe(false)
  })

  it('grant on create and update, and take the grant away when the record stops matching', () => {
    const rules = [rule({ targets: ['org'] })]
    const lead = leadOnA()
    const grants = evaluateRecordGrants('leads', lead, rules, 10)
    expect(grants).toEqual({
      rule_r1: { source: 'rule', ruleId: 'r1', tokens: ['org'], access: 'read', atMs: 10 },
    })
    const shared = stored(lead, planRecordSharing(lead, grants))
    expect(shared['visibleTo']).toEqual([A, 'org'])
    // The same record re-evaluated later keeps its grant's date: no write.
    expect(sharingPlanChanges(shared, planRecordSharing(shared, evaluateRecordGrants('leads', shared, rules, 50)))).toBe(false)
    // A narrower rule the record no longer matches.
    const narrowed = [rule({ criteria: { stages: ['working'] } })]
    const plan = planRecordSharing(shared, evaluateRecordGrants('leads', shared, narrowed, 60))
    expect(plan.visibleTo).toEqual([A])
    expect(plan.sharing).toBeNull()
  })

  it('removes only the visibility a deleted rule granted', () => {
    const lead = leadOnA()
    const both = {
      ...withManualShares({}, [B], 'read', BY, 5),
      ...evaluateRecordGrants('leads', lead, [rule({ targets: [B, C] })], 10),
    }
    const shared = stored(lead, planRecordSharing(lead, both))
    expect(shared['visibleTo']).toEqual([A, B, C])
    // The rule is gone: its grant goes, the hand share to B stays.
    const plan = planRecordSharing(shared, evaluateRecordGrants('leads', shared, [], 20))
    expect(plan.visibleTo).toEqual([A, B])
    expect(plan.sharing?.ruleIds).toEqual([])
  })

  it('read back from the org document, cleaned', () => {
    const rules = readCrmSharingRules({
      crm: {
        sharingRules: [
          { id: 'r1', name: 'A', object: 'leads', targets: ['org', 'host:x'], criteria: { tags: ['VIP'] } },
          { id: 'r1', name: 'duplicate', object: 'leads', targets: ['org'] },
          { id: 'bad id!', object: 'leads', targets: ['org'] },
          { id: 'r2', object: 'tasks', targets: ['org'] },
          { id: 'r3', object: 'deals', targets: [] },
        ],
      },
    })
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({ id: 'r1', targets: ['org'], access: 'read', enabled: true, criteria: { tags: ['vip'] } })
  })

  it('take targets as all sites or host ids, never a scope token smuggled in', () => {
    expect(shareTargetsFrom('all')).toEqual(['org'])
    expect(shareTargetsFrom(['site-b', 'site-b', 'site-c'])).toEqual([B, C])
    expect(shareTargetsFrom(['host:site-b'])).toBeNull()
    expect(shareTargetsFrom([])).toBeNull()
  })
})
