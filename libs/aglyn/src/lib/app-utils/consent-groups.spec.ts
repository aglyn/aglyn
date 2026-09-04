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
  CONSENT_GROUPS_FIELD,
  consentGroupDisclosure,
  consentGroupForHost,
  consentGroupScope,
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
})
