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
 * The declared unit of pooling.
 *
 * Two organizations have to work at once: an agency whose twelve clients must
 * never share a basis, and one business whose three sites legitimately do.
 * Every refusal below is a way a group could pool WITHOUT having been
 * declared and disclosed, which is the agency's leak arriving through the
 * feature that serves the other case.
 */

import {
  CONSENT_GROUPS_AWAIT_CONFIRMATION_FIELD,
  CONSENT_GROUPS_FIELD,
  consentGroupDisclosure,
  consentGroupDisclosureKey,
  consentGroupForGrant,
  consentGroupForHost,
  consentGroupOptOutHosts,
  consentGroupScope,
  consentGroupSiteHold,
  consentGroupsAwaitConfirmation,
  consentGroupTopicState,
  MAX_CONSENT_GROUP_HOSTS,
  readConsentGroups,
  soloConsentGroup,
} from './consent-groups'

const org = (groups: Record<string, unknown>) => ({
  [CONSENT_GROUPS_FIELD]: groups,
})

const GROUP = { name: 'Northwind Group', hostIds: ['site-a', 'site-b'] }

describe('an undeclared site is alone', () => {
  it('resolves a group of one for an org that declared nothing', () => {
    expect(consentGroupForHost(null, 'site-a')).toEqual({
      hostId: 'site-a',
      groupId: 'site-a',
      name: null,
      hostIds: ['site-a'],
      declared: false,
      awaitsConfirmation: false,
    })
    expect(consentGroupForHost({}, 'site-a').hostIds).toEqual(['site-a'])
  })

  /**
   * ⛔ Sharing an account is a BILLING fact. An agency's twelve clients are
   * all in one org, all on one sending domain, and none of them is one brand
   * with the others.
   */
  it('does not pool sites that merely share an org', () => {
    const sameOrg = { hosts: { 'site-a': true, 'site-b': true } }
    expect(consentGroupForHost(sameOrg, 'site-a').hostIds).toEqual(['site-a'])
    expect(consentGroupForHost(sameOrg, 'site-b').hostIds).toEqual(['site-b'])
  })

  it('refuses a group with no site to belong to', () => {
    expect(() => soloConsentGroup('')).toThrow(/must name a site/)
    expect(() => consentGroupForHost(org({ g: GROUP }), '')).toThrow(
      /must name a site/,
    )
  })
})

describe('a declared group pools, and only when it could be disclosed', () => {
  it('resolves every member to the same group', () => {
    for (const hostId of ['site-a', 'site-b']) {
      expect(consentGroupForHost(org({ nw: GROUP }), hostId)).toMatchObject({
        hostId,
        groupId: 'nw',
        name: 'Northwind Group',
        hostIds: ['site-a', 'site-b'],
        declared: true,
      })
    }
  })

  /** ANTI-VACUITY: a site outside the declaration is still alone. */
  it('leaves a site the declaration does not name alone', () => {
    expect(consentGroupForHost(org({ nw: GROUP }), 'site-c')).toMatchObject({
      groupId: 'site-c',
      hostIds: ['site-c'],
      declared: false,
    })
  })

  /**
   * A group with no NAME cannot be rendered beside a checkbox, so the person
   * could not have been told — and pooling without a disclosure is the leak
   * with a settings screen in front of it.
   */
  it('refuses to pool a group that cannot be disclosed', () => {
    for (const broken of [
      { hostIds: ['site-a', 'site-b'] },
      { name: '   ', hostIds: ['site-a', 'site-b'] },
      { name: 42, hostIds: ['site-a', 'site-b'] },
    ]) {
      expect(consentGroupForHost(org({ nw: broken }), 'site-a').declared).toBe(
        false,
      )
    }
  })

  it('refuses a declaration that is not a set of sites', () => {
    for (const broken of [
      { name: 'X', hostIds: 'site-a' },
      { name: 'X', hostIds: [] },
      { name: 'X', hostIds: ['site-a'] },
      { name: 'X' },
      'nw',
      null,
    ]) {
      expect(readConsentGroups(org({ nw: broken }))).toEqual({})
    }
  })

  it('refuses a group wider than the query primitives can carry', () => {
    const tooMany = Array.from(
      { length: MAX_CONSENT_GROUP_HOSTS + 1 },
      (_unused, index) => `site-${index}`,
    )
    expect(readConsentGroups(org({ nw: { name: 'X', hostIds: tooMany } }))).toEqual(
      {},
    )
    // The control: one fewer is accepted, so the refusal is the ceiling and
    // not the shape.
    expect(
      Object.keys(
        readConsentGroups(org({ nw: { name: 'X', hostIds: tooMany.slice(1) } })),
      ),
    ).toEqual(['nw'])
  })

  /**
   * Two controllers claiming one site is a contradiction, not a wider group.
   * Picking one would be a coin flip deciding who may mail somebody.
   */
  it('drops BOTH claims when two groups name the same site', () => {
    const contested = org({
      one: { name: 'One', hostIds: ['site-a', 'site-b'] },
      two: { name: 'Two', hostIds: ['site-b', 'site-c'] },
    })
    expect(readConsentGroups(contested)).toEqual({})
    for (const hostId of ['site-a', 'site-b', 'site-c']) {
      expect(consentGroupForHost(contested, hostId).declared).toBe(false)
    }
  })

  it('leaves an UNcontested group standing beside a contested pair', () => {
    const mixed = org({
      one: { name: 'One', hostIds: ['site-a', 'site-b'] },
      two: { name: 'Two', hostIds: ['site-b', 'site-c'] },
      three: { name: 'Three', hostIds: ['site-d', 'site-e'] },
    })
    expect(Object.keys(readConsentGroups(mixed))).toEqual(['three'])
    expect(consentGroupForHost(mixed, 'site-d').groupId).toBe('three')
  })

  it('reads a malformed field as no declaration at all', () => {
    for (const broken of [null, 'nw', 42, [GROUP]]) {
      expect(readConsentGroups({ [CONSENT_GROUPS_FIELD]: broken })).toEqual({})
    }
  })
})

/**
 * A site that declared nothing uses its own id as its group id, so a group
 * spelled like a site would share that site's key — its grant stamps, its
 * opt-out lookups, and every record the CRM files under a group id.
 */
describe('a group id that is also a site id', () => {
  it('is dropped when it names one of the org’s sites', () => {
    const colliding = {
      hosts: { 'site-a': true, 'site-b': true, 'site-c': true },
      ...org({ 'site-c': GROUP }),
    }
    expect(readConsentGroups(colliding)).toEqual({})
    for (const hostId of ['site-a', 'site-b', 'site-c']) {
      expect(consentGroupForHost(colliding, hostId)).toMatchObject({
        groupId: hostId,
        hostIds: [hostId],
        declared: false,
      })
    }
  })

  it('is dropped when it names a site another group lists, usable or not', () => {
    // `site-x` is in no `hosts` map, but a second entry names it — and that
    // entry is itself unusable (a group of one), which does not excuse it.
    expect(
      readConsentGroups(
        org({
          'site-x': GROUP,
          other: { name: 'Other', hostIds: ['site-x'] },
        }),
      ),
    ).toEqual({})
    // …and a group listing its OWN id among its sites is the same collision.
    expect(
      readConsentGroups(org({ 'site-a': GROUP })),
    ).toEqual({})
  })

  it('reads a `hosts` list as well as the map the org writes', () => {
    expect(
      readConsentGroups({ hosts: ['site-z'], ...org({ 'site-z': GROUP }) }),
    ).toEqual({})
  })

  it('leaves the other groups standing, and contests nothing it named', () => {
    const mixed = {
      hosts: { 'site-a': true, 'site-b': true, 'site-c': true, 'site-d': true },
      ...org({
        'site-d': { name: 'Collides', hostIds: ['site-a', 'site-b'] },
        kept: { name: 'Kept', hostIds: ['site-b', 'site-c'] },
      }),
    }
    // The colliding entry is refused on its own, like a nameless one, so its
    // claim on `site-b` is not a second controller for the overlap pass.
    expect(readConsentGroups(mixed)).toEqual({
      kept: { name: 'Kept', hostIds: ['site-b', 'site-c'] },
    })
  })

  it('THE CONTROL: a group id no site uses is kept', () => {
    expect(
      readConsentGroups({
        hosts: { 'site-a': true, 'site-b': true },
        ...org({ nw: GROUP }),
      }),
    ).toEqual({ nw: GROUP })
  })
})

/**
 * A grant pools only where the person was shown THIS disclosure. The key is
 * what a capture surface sends back to prove which sentence it rendered.
 */
describe('the disclosure key, and the group a grant is recorded for', () => {
  const grouped = consentGroupForHost(org({ nw: GROUP }), 'site-a')

  it('keys only a group that has something to disclose', () => {
    expect(consentGroupDisclosureKey(soloConsentGroup('site-a'))).toBeNull()
    expect(consentGroupDisclosureKey(grouped)).toMatch(/^[0-9a-f]{8}$/)
  })

  it('is the same for every member of the group, and on every call', () => {
    const fromB = consentGroupForHost(org({ nw: GROUP }), 'site-b')
    expect(consentGroupDisclosureKey(fromB)).toBe(consentGroupDisclosureKey(grouped))
    expect(consentGroupDisclosureKey(grouped)).toBe(consentGroupDisclosureKey(grouped))
    // The stored order of the sites is not part of what was disclosed.
    const reordered = consentGroupForHost(
      org({ nw: { name: 'Northwind Group', hostIds: ['site-b', 'site-a'] } }),
      'site-a',
    )
    expect(consentGroupDisclosureKey(reordered)).toBe(consentGroupDisclosureKey(grouped))
  })

  it('changes with the name, the sites and the id', () => {
    const key = consentGroupDisclosureKey(grouped)
    const renamed = consentGroupForHost(
      org({ nw: { ...GROUP, name: 'Northwind Brands' } }),
      'site-a',
    )
    const grown = consentGroupForHost(
      org({ nw: { ...GROUP, hostIds: ['site-a', 'site-b', 'site-c'] } }),
      'site-a',
    )
    const redeclared = consentGroupForHost(org({ nw2: GROUP }), 'site-a')
    for (const changed of [renamed, grown, redeclared]) {
      expect(consentGroupDisclosureKey(changed)).not.toBe(key)
    }
  })

  it('pools a grant for the group when the key is the current one', () => {
    expect(
      consentGroupForGrant(grouped, consentGroupDisclosureKey(grouped)),
    ).toEqual(grouped)
  })

  it('records the site alone for a missing, stale-name or stale-membership key', () => {
    const renamed = consentGroupForHost(
      org({ nw: { ...GROUP, name: 'Northwind Brands' } }),
      'site-a',
    )
    const grown = consentGroupForHost(
      org({ nw: { ...GROUP, hostIds: ['site-a', 'site-b', 'site-c'] } }),
      'site-a',
    )
    const keyFromBefore = consentGroupDisclosureKey(grouped)
    for (const [group, key] of [
      [grouped, undefined],
      [grouped, null],
      [grouped, ''],
      [grouped, 'not-a-key'],
      [renamed, keyFromBefore],
      [grown, keyFromBefore],
    ] as const) {
      expect(consentGroupForGrant(group, key)).toEqual(soloConsentGroup('site-a'))
    }
  })

  it('never pools a group of one, whatever key arrives', () => {
    const solo = soloConsentGroup('site-a')
    expect(
      consentGroupForGrant(solo, consentGroupDisclosureKey(grouped)),
    ).toEqual(solo)
  })
})

describe('what a group hands the surfaces that use it', () => {
  /**
   * Visibility is a SEPARATE axis from consent, and this is the function
   * that says so: a group of one produces one site's token, which is the
   * agency's isolation arrived at with nothing configured.
   */
  it('scopes a captured resource to the group and no wider', () => {
    expect(consentGroupScope(soloConsentGroup('site-a'))).toEqual([
      'host:site-a',
    ])
    expect(consentGroupScope(consentGroupForHost(org({ nw: GROUP }), 'site-a'))).toEqual(
      ['host:site-a', 'host:site-b'],
    )
  })

  it('has a sentence to render only when there is pooling to disclose', () => {
    expect(consentGroupDisclosure(soloConsentGroup('site-a'))).toBeNull()
    expect(
      consentGroupDisclosure(consentGroupForHost(org({ nw: GROUP }), 'site-a')),
    ).toContain('Northwind Group')
  })

  /**
   * Opt-out runs against the group (AGL-3310): the lists a send reads are
   * every site's in it, the sending site first so a reader can tell its own
   * record from a sibling's. A group of one is the site alone — the read every
   * org that declared nothing keeps.
   */
  it('names the sites whose opt-outs answer for a send, the sender first', () => {
    expect(consentGroupOptOutHosts(soloConsentGroup('site-a'))).toEqual(['site-a'])
    expect(
      consentGroupOptOutHosts(consentGroupForHost(org({ nw: GROUP }), 'site-b')),
    ).toEqual(['site-b', 'site-a'])
    // A site the declaration does not name reads its own lists alone.
    expect(
      consentGroupOptOutHosts(consentGroupForHost(org({ nw: GROUP }), 'site-c')),
    ).toEqual(['site-c'])
  })
})

/**
 * The org's confirmation switch (AGL-3316), resolved INTO the group so a send
 * path holding the group holds the answer. Off is the default and the
 * absence; on reaches a declared group and nothing else, because a group of
 * one has no sibling to wait for.
 */
describe('whether a group waits for a confirmation click', () => {
  const waiting = (groups: Record<string, unknown>, value: unknown = true) => ({
    ...org(groups),
    [CONSENT_GROUPS_AWAIT_CONFIRMATION_FIELD]: value,
  })

  it('is off for every declared group of an org that never set it', () => {
    expect(consentGroupForHost(org({ nw: GROUP }), 'site-a').awaitsConfirmation).toBe(
      false,
    )
  })

  it('is on for every member of a declared group once the org turns it on', () => {
    for (const hostId of ['site-a', 'site-b']) {
      expect(consentGroupForHost(waiting({ nw: GROUP }), hostId)).toMatchObject({
        groupId: 'nw',
        declared: true,
        awaitsConfirmation: true,
      })
    }
  })

  it('reads only a stored `true` as on', () => {
    for (const value of [false, 'true', 1, null, {}]) {
      expect(consentGroupsAwaitConfirmation(waiting({ nw: GROUP }, value))).toBe(false)
      expect(
        consentGroupForHost(waiting({ nw: GROUP }, value), 'site-a').awaitsConfirmation,
      ).toBe(false)
    }
    expect(consentGroupsAwaitConfirmation(null)).toBe(false)
    expect(consentGroupsAwaitConfirmation(waiting({}))).toBe(true)
  })

  /** ANTI-VACUITY: the switch is about a group, so a site alone never waits. */
  it('never makes a group of one wait, whatever the org says', () => {
    expect(soloConsentGroup('site-a').awaitsConfirmation).toBe(false)
    // An org that turned it on and declared nothing.
    expect(consentGroupForHost(waiting({}), 'site-a').awaitsConfirmation).toBe(false)
    // A site the declaration does not name.
    expect(consentGroupForHost(waiting({ nw: GROUP }), 'site-c')).toMatchObject({
      declared: false,
      awaitsConfirmation: false,
    })
    // A declaration the reader refuses is no group at all.
    expect(
      consentGroupForHost(
        waiting({ nw: { name: '  ', hostIds: ['site-a', 'site-b'] } }),
        'site-a',
      ),
    ).toMatchObject({ declared: false, awaitsConfirmation: false })
  })

  it('leaves every refusal of the declaration exactly as it was', () => {
    const contested = waiting({
      one: { name: 'One', hostIds: ['site-a', 'site-b'] },
      two: { name: 'Two', hostIds: ['site-b', 'site-c'] },
    })
    expect(readConsentGroups(contested)).toEqual({})
    expect(readConsentGroups(waiting({ nw: GROUP }))).toEqual(
      readConsentGroups(org({ nw: GROUP })),
    )
  })
})

/**
 * The fold every group read decides by: the sending site's standing first,
 * then its siblings'. Off, it is exactly the rule that shipped with AGL-3310 —
 * a sibling's refusal holds and its pending question does not.
 */
describe('the sending site’s standing on a stream, across its group', () => {
  const OFF = { awaitsConfirmation: false }
  const ON = { awaitsConfirmation: true }

  it('holds on a refusal anywhere in the group, switch or no switch', () => {
    for (const group of [OFF, ON]) {
      expect(consentGroupTopicState(group, ['opted-out'])).toBe('opted-out')
      expect(consentGroupTopicState(group, ['subscribed', 'opted-out'])).toBe(
        'opted-out',
      )
      // A refusal outranks a pending question, here as within one entry.
      expect(consentGroupTopicState(group, ['pending', 'opted-out'])).toBe(
        'opted-out',
      )
      expect(consentGroupTopicState(group, ['opted-out', 'pending'])).toBe(
        'opted-out',
      )
    }
  })

  it('holds on the sending site’s own pending question, switch or no switch', () => {
    expect(consentGroupTopicState(OFF, ['pending', 'subscribed'])).toBe('pending')
    expect(consentGroupTopicState(ON, ['pending', 'subscribed'])).toBe('pending')
  })

  it('holds on a sibling’s pending question only when the group waits', () => {
    expect(consentGroupTopicState(OFF, ['subscribed', 'pending'])).toBe('subscribed')
    expect(consentGroupTopicState(ON, ['subscribed', 'pending'])).toBe('pending')
    expect(consentGroupTopicState(ON, ['subscribed', 'subscribed', 'pending'])).toBe(
      'pending',
    )
  })

  it('is subscribed when nothing in the group holds', () => {
    expect(consentGroupTopicState(ON, ['subscribed', 'subscribed'])).toBe('subscribed')
    expect(consentGroupTopicState(ON, [])).toBe('subscribed')
  })
})

/**
 * A site's opt-outs are read across its group, so a grouped site — or one a
 * change is still moving — is not deleted until it is out (AGL-3320).
 */
describe('whether a site may be deleted', () => {
  it('holds a site in a declared group, naming the group', () => {
    expect(consentGroupSiteHold(org({ nw: GROUP }), 'site-a')).toEqual({
      reason: 'grouped',
      groupId: 'nw',
      name: 'Northwind Group',
    })
  })

  it('holds a site a running change names, grouped or not', () => {
    const changing = {
      consentGroupsChange: { changeId: 'c1', phase: 'rehome', hostIds: ['site-x'] },
    }
    expect(consentGroupSiteHold(changing, 'site-x')).toEqual({ reason: 'changing' })
    // The declared group answers first: the site is in it either way.
    expect(
      consentGroupSiteHold(
        { ...org({ nw: GROUP }), consentGroupsChange: { hostIds: ['site-a'] } },
        'site-a',
      ),
    ).toMatchObject({ reason: 'grouped' })
  })

  it('lets a site alone go, and a site no running change names', () => {
    expect(consentGroupSiteHold(null, 'site-a')).toBeNull()
    expect(consentGroupSiteHold(org({ nw: GROUP }), 'site-c')).toBeNull()
    expect(
      consentGroupSiteHold({ consentGroupsChange: { hostIds: ['site-b'] } }, 'site-a'),
    ).toBeNull()
    // A declaration that cannot be honored holds nothing: the site reads as
    // alone, and nothing reads its refusals across a group.
    expect(
      consentGroupSiteHold(org({ nw: { name: '', hostIds: ['site-a', 'site-b'] } }), 'site-a'),
    ).toBeNull()
    expect(consentGroupSiteHold(org({ nw: GROUP }), '')).toBeNull()
  })
})
