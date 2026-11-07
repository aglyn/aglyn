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
  CRM_SHARING_MAX_INCLUDED,
  crmRecordWritableBy,
  crmShareChipFor,
  crmShareChipLabel,
  crmSharingRuleMatches,
  type CrmSharingRule,
  describeRecordSharing,
  describeShareTargets,
  evaluateRecordGrants,
  MANUAL_EXCEPT_GRANT_KEY,
  manualGrantKey,
  planRecordSharing,
  readCrmSharingRules,
  readRecordGrants,
  recordHeldScope,
  ruleGrantKey,
  shareExceptChoiceFrom,
  sharingAsksOrgSites,
  sharingPlanChanges,
  shareTargetsFrom,
  sitesAllExcept,
  withManualExceptShare,
  withManualShares,
  withoutManualExceptShare,
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

describe('all sites except some (AGL-4047)', () => {
  const ORG_SITES = ['site-a', 'site-b', 'site-c']
  const D = 'host:site-d'

  it('a hand share reaches every site but the ones left out, through tokens, added and writeTo', () => {
    const lead = leadOnA()
    const grants = withManualExceptShare({}, { tokens: [B], except: [C] }, 'edit', BY, 5)
    expect(grants[MANUAL_EXCEPT_GRANT_KEY]).toMatchObject({ tokens: [B], except: [C], access: 'edit' })
    const plan = planRecordSharing(lead, grants)
    expect(plan.visibleTo).toEqual([A, B])
    expect(plan.writeTo).toEqual([A, B])
    expect(plan.sharing).toMatchObject({ added: [B], hasExcept: true })
    expect(heldScopeTokens(stored(lead, plan))).toEqual([A])
  })

  it('a site added later joins the next time the record is worked out; the one left out never does', () => {
    const lead = leadOnA()
    const shared = stored(
      lead,
      planRecordSharing(lead, withManualExceptShare({}, { tokens: [B], except: [C] }, 'read', BY, 5)),
    )
    const grants = evaluateRecordGrants('leads', shared, [], 9, { orgHostIds: [...ORG_SITES, 'site-d'] })
    expect(grants[MANUAL_EXCEPT_GRANT_KEY].tokens).toEqual([A, B, D])
    const plan = planRecordSharing(shared, grants)
    // The capturing site is held, so it is never counted as added.
    expect(plan.visibleTo).toEqual([A, B, D])
    expect(plan.sharing?.added).toEqual([B, D])
    expect(plan.visibleTo).not.toContain(C)
  })

  it('keeps the person on the site that captured them, even when that site is left out', () => {
    const lead = leadOnA()
    const grants = evaluateRecordGrants(
      'leads',
      lead,
      [rule({ sourceHostIds: [], targets: [B, C], except: [A] })],
      5,
      { orgHostIds: ORG_SITES },
    )
    expect(grants['rule_r1']).toMatchObject({ tokens: [B, C], except: [A] })
    const plan = planRecordSharing(lead, grants)
    expect(plan.visibleTo).toEqual([A, B, C])
    expect(heldScopeTokens(stored(lead, plan))).toEqual([A])
  })

  it('changes nothing on a record every site already holds', () => {
    const orgHeld = { ...leadOnA(), visibleTo: ['org'] }
    const plan = planRecordSharing(
      orgHeld,
      withManualExceptShare({}, { tokens: [B], except: [C] }, 'read', BY, 5),
    )
    expect(plan.visibleTo).toEqual(['org'])
    expect(plan.sharing?.added).toEqual([])
  })

  it('a rule leaving sites out follows the workspace’s sites, and keeps its date while they stand still', () => {
    const rules = [rule({ sourceHostIds: [], targets: [B], except: [C] })]
    const lead = leadOnA()
    const grants = evaluateRecordGrants('leads', lead, rules, 10, { orgHostIds: ORG_SITES })
    const shared = stored(lead, planRecordSharing(lead, grants))
    expect(shared['visibleTo']).toEqual([A, B])
    const again = planRecordSharing(
      shared,
      evaluateRecordGrants('leads', shared, rules, 50, { orgHostIds: ORG_SITES }),
    )
    expect(sharingPlanChanges(shared, again)).toBe(false)
    const widened = planRecordSharing(
      shared,
      evaluateRecordGrants('leads', shared, rules, 60, { orgHostIds: [...ORG_SITES, 'site-d'] }),
    )
    expect(widened.visibleTo).toEqual([A, B, D])
    // A site that left the workspace leaves the grant.
    const narrowed = planRecordSharing(
      shared,
      evaluateRecordGrants('leads', shared, rules, 70, { orgHostIds: ['site-a', 'site-c'] }),
    )
    expect(narrowed.visibleTo).toEqual([A])
  })

  it('keeps the sites it reached when the workspace’s sites are not known', () => {
    expect(sitesAllExcept([C], undefined, [B, C])).toEqual([B])
  })

  it('stops widening past thirty sites, keeping the ones it reached that are still there', () => {
    const many = Array.from({ length: 32 }, (_, index) => `s${String(index).padStart(2, '0')}`)
    const before = many.slice(0, 30).map((id) => `host:${id}`)
    const after = sitesAllExcept(['host:s00'], [...many, 'extra'], before)
    expect(after).toEqual(before.slice(1))
    expect(CRM_SHARING_MAX_INCLUDED).toBe(30)
  })

  it('describes and unshares the hand share as one line', () => {
    const lead = leadOnA()
    const grants = withManualShares(
      withManualExceptShare({}, { tokens: [B], except: [C] }, 'read', BY, 5),
      [C],
      'read',
      BY,
      6,
    )
    const record = stored(lead, planRecordSharing(lead, grants))
    const lines = describeRecordSharing(record)
    expect(lines.map((line) => line.kind).sort()).toEqual(['held', 'manual', 'manualExcept'])
    const name = (id: string) => ({ 'site-b': 'Shop', 'site-c': 'Blog' })[id] ?? id
    const line = lines.find((entry) => entry.kind === 'manualExcept')
    if (line?.kind !== 'manualExcept') throw new Error('expected the except line')
    expect(describeShareTargets(line.tokens, name, line.except)).toBe('All sites except Blog')
    const left = withoutManualExceptShare(readRecordGrants(record))
    expect(Object.keys(left)).toEqual([manualGrantKey(C)])
  })

  it('reads a stored grant and rule with `except`, and never a grant that says all sites beside it', () => {
    const rules = readCrmSharingRules({
      crm: {
        sharingRules: [
          { id: 'r1', name: 'x', object: 'leads', targets: [B], except: [C, 'org', 'nonsense'] },
          { id: 'r2', name: 'y', object: 'leads', targets: ['org'] },
        ],
      },
    })
    expect(rules[0]).toMatchObject({ targets: [B], except: [C] })
    expect(rules[1]).not.toHaveProperty('except')
    expect(
      readRecordGrants({ sharing: { grants: { g: { source: 'manual', tokens: ['org'], except: [C] } } } }),
    ).toEqual({})
    expect(
      readRecordGrants({ sharing: { grants: { g: { source: 'manual', tokens: [], except: [C] } } } })['g'],
    ).toMatchObject({ tokens: [], except: [C] })
  })

  it('reads the choice off a request, and nothing else', () => {
    expect(
      shareExceptChoiceFrom({ mode: 'allExcept', exceptHostIds: ['site-c', 'site-c', 'host:x', 'a/b'] }),
    ).toEqual({ mode: 'allExcept', exceptHostIds: ['site-c'] })
    expect(shareExceptChoiceFrom('all')).toBeNull()
    expect(shareExceptChoiceFrom(['site-c'])).toBeNull()
  })

  it('asks for the workspace’s sites only where a grant or a rule leaves some out', () => {
    expect(sharingAsksOrgSites('leads', leadOnA(), [rule()])).toBe(false)
    expect(sharingAsksOrgSites('leads', leadOnA(), [rule({ except: [C] })])).toBe(true)
    expect(sharingAsksOrgSites('contacts', leadOnA(), [rule({ except: [C] })])).toBe(false)
  })
})
