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
 * The pure half of a consent group change (AGL-3320): what a submitted
 * declaration is refused for, and what moving to it requires.
 *
 * The two properties the executor rests on are pinned over random
 * declarations rather than a handful of cases: every pair of sites that stops
 * being one sender carries in BOTH directions and no other pair carries (I1),
 * and a holder key whose sites all land under one new key moves exactly once
 * while no flow ever creates a solo key for a site that is grouped (I6).
 */

import {
  CONSENT_GROUP_ID_PREFIX,
  CONSENT_GROUP_NAME_MAX,
  CONSENT_GROUPS_CHANGE_FIELD,
  type ConsentGroupDeclaration,
  type ConsentGroupHolderFlow,
  consentGroupDisclosureChanges,
  consentGroupHoldersInMotion,
  consentGroupsEqual,
  consentGroupsFingerprint,
  describeConsentGroupChangeLine,
  discardedConsentGroupIds,
  estimateConsentGroupChange,
  mintConsentGroupId,
  orgSiteIds,
  planConsentGroupChange,
  readConsentGroupsChange,
  validateConsentGroupDeclaration,
} from './consent-group-change'
import {
  CONSENT_GROUPS_FIELD,
  consentGroupSiteHold,
  MAX_CONSENT_GROUP_HOSTS,
} from './consent-groups'

const SITES = ['a', 'b', 'c', 'd', 'r1', 'r2', 'x']

/** A random source that walks a fixed sequence, for reproducible ids. */
function sequence(values: number[]): () => number {
  let index = 0
  return () => values[index++ % values.length]
}

/** Draws that mint one id per value, sixteen characters each. */
const draws = (...values: number[]) => values.flatMap((value) => Array(16).fill(value))

const validate = (groups: unknown, before: ConsentGroupDeclaration = {}) =>
  validateConsentGroupDeclaration({ groups, before, siteIds: SITES })

describe('validateConsentGroupDeclaration', () => {
  it('accepts a new group and mints its id', () => {
    const result = validate([{ name: ' Northwind ', hostIds: ['b', 'a', 'a'] }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [[id, group]] = Object.entries(result.after)
    expect(id.startsWith(CONSENT_GROUP_ID_PREFIX)).toBe(true)
    expect(id).toHaveLength(CONSENT_GROUP_ID_PREFIX.length + 16)
    expect(group).toEqual({ name: 'Northwind', hostIds: ['a', 'b'] })
  })

  it('keeps the id of a group that exists', () => {
    const before = { g1: { name: 'Old', hostIds: ['a', 'b'] } }
    const result = validate([{ id: 'g1', name: 'New', hostIds: ['a', 'b'] }], before)
    expect(result).toEqual({ ok: true, after: { g1: { name: 'New', hostIds: ['a', 'b'] } } })
  })

  it('refuses anything that is not a list of groups', () => {
    expect(validate(null)).toEqual({ ok: false, errors: [{ code: 'malformed' }] })
    expect(validate([{ name: 'X' }])).toEqual({
      ok: false,
      errors: [{ code: 'malformed', groupIndex: 0 }],
    })
    expect(validate(['nope'])).toEqual({
      ok: false,
      errors: [{ code: 'malformed', groupIndex: 0 }],
    })
  })

  it.each([
    ['name-empty', [{ name: '   ', hostIds: ['a', 'b'] }]],
    ['name-too-long', [{ name: 'n'.repeat(CONSENT_GROUP_NAME_MAX + 1), hostIds: ['a', 'b'] }]],
    ['too-few-sites', [{ name: 'One', hostIds: ['a'] }]],
  ])('refuses %s', (code, groups) => {
    expect(validate(groups)).toEqual({ ok: false, errors: [{ code, groupIndex: 0 }] })
  })

  it('accepts a name of exactly the limit', () => {
    expect(validate([{ name: 'n'.repeat(CONSENT_GROUP_NAME_MAX), hostIds: ['a', 'b'] }]).ok).toBe(true)
  })

  it('refuses a name used twice, ignoring case, on the second group', () => {
    expect(
      validate([
        { name: 'Northwind', hostIds: ['a', 'b'] },
        { name: 'NORTHWIND', hostIds: ['c', 'd'] },
      ]),
    ).toEqual({ ok: false, errors: [{ code: 'name-duplicate', groupIndex: 1 }] })
  })

  it('refuses more sites than a group may name', () => {
    const many = Array.from({ length: MAX_CONSENT_GROUP_HOSTS + 1 }, (_, index) => `s${index}`)
    const result = validateConsentGroupDeclaration({
      groups: [{ name: 'Many', hostIds: many }],
      before: {},
      siteIds: many,
    })
    expect(result).toEqual({ ok: false, errors: [{ code: 'too-many-sites', groupIndex: 0 }] })
  })

  it('refuses a site the organization does not own, naming it', () => {
    expect(validate([{ name: 'G', hostIds: ['a', 'elsewhere'] }])).toEqual({
      ok: false,
      errors: [{ code: 'unknown-site', groupIndex: 0, hostId: 'elsewhere' }],
    })
  })

  it('refuses a site claimed by two groups, on the second claim', () => {
    expect(
      validate([
        { name: 'G1', hostIds: ['a', 'b'] },
        { name: 'G2', hostIds: ['b', 'c'] },
      ]),
    ).toEqual({ ok: false, errors: [{ code: 'site-in-two-groups', groupIndex: 1, hostId: 'b' }] })
  })

  it('refuses an id the declaration in force does not have, and an id twice', () => {
    const before = { g1: { name: 'G1', hostIds: ['a', 'b'] } }
    expect(validate([{ id: 'ghost', name: 'G', hostIds: ['a', 'b'] }], before)).toEqual({
      ok: false,
      errors: [{ code: 'unknown-group', groupIndex: 0 }],
    })
    expect(
      validate(
        [
          { id: 'g1', name: 'G1', hostIds: ['a', 'b'] },
          { id: 'g1', name: 'G2', hostIds: ['c', 'd'] },
        ],
        before,
      ),
    ).toEqual({ ok: false, errors: [{ code: 'duplicate-group', groupIndex: 1 }] })
  })

  it('refuses a kept id whose sites were all replaced', () => {
    const before = { g1: { name: 'G1', hostIds: ['a', 'b'] } }
    expect(validate([{ id: 'g1', name: 'G1', hostIds: ['c', 'd'] }], before)).toEqual({
      ok: false,
      errors: [{ code: 'group-replaced', groupIndex: 0 }],
    })
    // One original site staying is a group that changed, not a new one.
    expect(validate([{ id: 'g1', name: 'G1', hostIds: ['a', 'c'] }], before).ok).toBe(true)
  })

  it('refuses the declaration in force', () => {
    const before = { g1: { name: 'G1', hostIds: ['a', 'b'] } }
    expect(validate([{ id: 'g1', name: ' G1 ', hostIds: ['b', 'a'] }], before)).toEqual({
      ok: false,
      errors: [{ code: 'no-change' }],
    })
    expect(validate([], {})).toEqual({ ok: false, errors: [{ code: 'no-change' }] })
  })

  it('accepts dissolving every group', () => {
    const before = { g1: { name: 'G1', hostIds: ['a', 'b'] } }
    expect(validate([], before)).toEqual({ ok: true, after: {} })
  })

  it('reports every problem at once', () => {
    const result = validate([
      { name: '', hostIds: ['a'] },
      { name: 'G', hostIds: ['a', 'nowhere'] },
    ])
    expect(result.ok).toBe(false)
    const { errors } = result as { errors: Array<{ code: string }> }
    expect(errors.map((error) => error.code).sort()).toEqual([
      'name-empty',
      'site-in-two-groups',
      'too-few-sites',
      'unknown-site',
    ])
  })

  it('never mints an id the declaration, a site or a reserved key already holds', () => {
    const before = { [`${CONSENT_GROUP_ID_PREFIX}${'0'.repeat(16)}`]: { name: 'Old', hostIds: ['a', 'b'] } }
    // The first draw would mint exactly the existing id; the minter must move on.
    const result = validateConsentGroupDeclaration({
      groups: [
        { id: Object.keys(before)[0], name: 'Old', hostIds: ['a', 'b'] },
        { name: 'New', hostIds: ['c', 'd'] },
      ],
      before,
      siteIds: SITES,
      random: sequence(draws(0, 0.5)),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.keys(result.after).sort()).toEqual([
      `${CONSENT_GROUP_ID_PREFIX}${'0'.repeat(16)}`,
      `${CONSENT_GROUP_ID_PREFIX}${'i'.repeat(16)}`,
    ])
  })
})

describe('mintConsentGroupId', () => {
  it('skips every taken id and is never a site id', () => {
    const zeros = `${CONSENT_GROUP_ID_PREFIX}${'0'.repeat(16)}`
    const halves = `${CONSENT_GROUP_ID_PREFIX}${'i'.repeat(16)}`
    const id = mintConsentGroupId(new Set([zeros, halves]), sequence(draws(0, 0.5, 0.99)))
    expect(id).toBe(`${CONSENT_GROUP_ID_PREFIX}${'z'.repeat(16)}`)
    // An automatic Firestore id is alphanumeric, so the prefix alone rules it out.
    expect(id).toMatch(/_/)
  })

  it('mints distinct ids across many draws', () => {
    const taken = new Set<string>()
    for (let index = 0; index < 500; index += 1) {
      const id = mintConsentGroupId(taken)
      expect(taken.has(id)).toBe(false)
      expect(id).toMatch(/^cg_[0-9a-z]{16}$/)
      taken.add(id)
    }
  })
})

describe('consentGroupsEqual and the fingerprint', () => {
  it('ignores order, whitespace and duplicate sites', () => {
    expect(
      consentGroupsEqual(
        { g1: { name: 'G', hostIds: ['b', 'a'] }, g2: { name: 'H', hostIds: ['c', 'd'] } },
        { g2: { name: ' H', hostIds: ['d', 'c', 'c'] }, g1: { name: 'G ', hostIds: ['a', 'b'] } },
      ),
    ).toBe(true)
  })

  it('tells a rename, a site and an id apart', () => {
    const base = { g1: { name: 'G', hostIds: ['a', 'b'] } }
    expect(consentGroupsEqual(base, { g1: { name: 'H', hostIds: ['a', 'b'] } })).toBe(false)
    expect(consentGroupsEqual(base, { g1: { name: 'G', hostIds: ['a', 'c'] } })).toBe(false)
    expect(consentGroupsEqual(base, { g9: { name: 'G', hostIds: ['a', 'b'] } })).toBe(false)
  })

  it('reads absent, null and an empty map as one value', () => {
    expect(consentGroupsFingerprint(undefined)).toBe(consentGroupsFingerprint({}))
    expect(consentGroupsFingerprint(null)).toBe(consentGroupsFingerprint([]))
  })

  it('keeps entries readConsentGroups would drop, so an edit to one is still an edit', () => {
    expect(consentGroupsFingerprint({ g1: { name: '', hostIds: ['a'] } })).not.toBe(
      consentGroupsFingerprint({}),
    )
  })
})

describe('orgSiteIds and discardedConsentGroupIds', () => {
  it('reads the hosts map, sorted', () => {
    expect(orgSiteIds({ hosts: { b: true, a: true } })).toEqual(['a', 'b'])
    expect(orgSiteIds({ hosts: ['b', 'a', 'a'] })).toEqual(['a', 'b'])
    expect(orgSiteIds(null)).toEqual([])
  })

  it('lists the stored entries that cannot be honored', () => {
    expect(
      discardedConsentGroupIds({
        [CONSENT_GROUPS_FIELD]: {
          good: { name: 'G', hostIds: ['a', 'b'] },
          nameless: { name: '', hostIds: ['c', 'd'] },
          lonely: { name: 'L', hostIds: ['x'] },
        },
      }),
    ).toEqual(['lonely', 'nameless'])
  })
})

/** The flows of a plan, keyed for readable assertions. */
const flowsOf = (flows: ConsentGroupHolderFlow[]) =>
  flows.map((flow) =>
    flow.kind === 'move'
      ? `move ${flow.from}->${flow.to}`
      : `split ${flow.from} ${flow.survives ? 'survives' : 'dies'} -> ${flow.successors
          .map((successor) => `${successor.key}[${successor.hostIds.join(',')}]`)
          .join(' ')}`,
  )
const carriesOf = (plan: ReturnType<typeof planConsentGroupChange>) =>
  plan.carries.map((carry) => `${carry.toHostId}<-${carry.fromHostId}`).sort()

describe('planConsentGroupChange — the worked plans', () => {
  it('X leaves G = {X, R1, R2}: both directions carry, G splits and survives', () => {
    const plan = planConsentGroupChange(
      { g: { name: 'G', hostIds: ['r1', 'r2', 'x'] } },
      { g: { name: 'G', hostIds: ['r1', 'r2'] } },
    )
    expect(carriesOf(plan)).toEqual(['r1<-x', 'r2<-x', 'x<-r1', 'x<-r2'])
    expect(flowsOf(plan.flows)).toEqual(['split g survives -> x[x]'])
    const [split] = plan.flows
    expect(split.kind === 'split' && split.stayHostIds).toEqual(['r1', 'r2'])
    expect(plan.lines).toEqual([{ kind: 'removed', groupId: 'g', name: 'G', hostId: 'x' }])
    expect(plan.hostIds).toEqual(['r1', 'r2', 'x'])
    expect(plan.renameOnly).toBe(false)
  })

  it('dissolving {A, B} carries across the pair and splits G, which dies', () => {
    const plan = planConsentGroupChange({ g: { name: 'G', hostIds: ['a', 'b'] } }, {})
    expect(carriesOf(plan)).toEqual(['a<-b', 'b<-a'])
    expect(flowsOf(plan.flows)).toEqual(['split g dies -> a[a] b[b]'])
    expect(plan.lines).toEqual([{ kind: 'dissolved', groupId: 'g', name: 'G' }])
  })

  it('creating G from solo A and B carries nothing and moves both solo keys', () => {
    const plan = planConsentGroupChange({}, { g: { name: 'G', hostIds: ['a', 'b'] } })
    expect(plan.carries).toEqual([])
    expect(flowsOf(plan.flows)).toEqual(['move a->g', 'move b->g'])
    expect(plan.lines).toEqual([
      { kind: 'created', groupId: 'g', name: 'G', hostIds: ['a', 'b'] },
    ])
  })

  it('G2 = {c, d} absorbed into G1 carries nothing and moves G2', () => {
    const plan = planConsentGroupChange(
      { g1: { name: 'G1', hostIds: ['a', 'b'] }, g2: { name: 'G2', hostIds: ['c', 'd'] } },
      { g1: { name: 'G1', hostIds: ['a', 'b', 'c', 'd'] } },
    )
    expect(plan.carries).toEqual([])
    expect(flowsOf(plan.flows)).toEqual(['move g2->g1'])
    expect(plan.lines).toEqual([
      { kind: 'moved', hostId: 'c', fromGroupId: 'g2', fromName: 'G2', toGroupId: 'g1', toName: 'G1' },
      { kind: 'moved', hostId: 'd', fromGroupId: 'g2', fromName: 'G2', toGroupId: 'g1', toName: 'G1' },
      { kind: 'dissolved', groupId: 'g2', name: 'G2' },
    ])
  })

  it('X moving G1 -> G2 carries with G1’s remaining sites and splits G1 toward G2', () => {
    const plan = planConsentGroupChange(
      { g1: { name: 'G1', hostIds: ['a', 'x'] }, g2: { name: 'G2', hostIds: ['c', 'd'] } },
      { g1: { name: 'G1', hostIds: ['a', 'b'] }, g2: { name: 'G2', hostIds: ['c', 'd', 'x'] } },
    )
    expect(carriesOf(plan)).toEqual(['a<-x', 'x<-a'])
    expect(flowsOf(plan.flows)).toEqual(['move b->g1', 'split g1 survives -> g2[x]'])
    expect(plan.lines).toContainEqual({
      kind: 'moved',
      hostId: 'x',
      fromGroupId: 'g1',
      fromName: 'G1',
      toGroupId: 'g2',
      toName: 'G2',
    })
    expect(plan.lines).toContainEqual({ kind: 'added', groupId: 'g1', name: 'G1', hostId: 'b' })
  })

  it('a rename moves nothing and is rename-only', () => {
    const plan = planConsentGroupChange(
      { g: { name: 'Old', hostIds: ['a', 'b'] } },
      { g: { name: 'New', hostIds: ['a', 'b'] } },
    )
    expect(plan.carries).toEqual([])
    expect(plan.flows).toEqual([])
    expect(plan.lines).toEqual([{ kind: 'renamed', groupId: 'g', from: 'Old', to: 'New' }])
    expect(plan.renameOnly).toBe(true)
    expect(plan.hostIds).toEqual(['a', 'b'])
  })

  it('leaving a group of two is a dissolve plus the leaver going solo', () => {
    // The editor presents it that way; the plan agrees.
    const plan = planConsentGroupChange({ g: { name: 'G', hostIds: ['a', 'b'] } }, {})
    expect(plan.lines.map((line) => line.kind)).toEqual(['dissolved'])
  })

  it('neither carries to nor copies for a site the organization no longer owns', () => {
    const plan = planConsentGroupChange(
      { g: { name: 'G', hostIds: ['a', 'b', 'gone'] } },
      { g: { name: 'G', hostIds: ['a', 'b'] } },
      { siteIds: ['a', 'b'] },
    )
    expect(plan.carries).toEqual([])
    expect(plan.flows).toEqual([])
    // The line still says what the declaration lost.
    expect(plan.lines).toEqual([{ kind: 'removed', groupId: 'g', name: 'G', hostId: 'gone' }])
  })
})

describe('planConsentGroupChange — invariants over random declarations', () => {
  /** A deterministic generator, so a failure reproduces. */
  function lcg(seed: number): () => number {
    let state = seed >>> 0
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state / 2 ** 32
    }
  }
  const POOL = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8']
  const IDS = ['g1', 'g2', 'g3', 'g4']

  function randomDeclaration(random: () => number): ConsentGroupDeclaration {
    const out: ConsentGroupDeclaration = {}
    for (const site of POOL) {
      const pick = Math.floor(random() * (IDS.length + 2))
      if (pick >= IDS.length) continue
      const id = IDS[pick]
      out[id] = { name: id.toUpperCase(), hostIds: [...(out[id]?.hostIds ?? []), site].sort() }
    }
    for (const [id, group] of Object.entries(out)) {
      if (group.hostIds.length < 2) delete out[id]
    }
    return out
  }
  const membersIn = (declaration: ConsentGroupDeclaration, site: string) =>
    Object.values(declaration).find((group) => group.hostIds.includes(site))?.hostIds ?? [site]
  const keyIn = (declaration: ConsentGroupDeclaration, site: string) =>
    Object.entries(declaration).find(([, group]) => group.hostIds.includes(site))?.[0] ?? site

  const cases = Array.from({ length: 300 }, (_, index) => {
    const random = lcg(index + 1)
    return [index, randomDeclaration(random), randomDeclaration(random)] as const
  })

  it('I1: a carry for every co-member pair that separates, and for no other pair', () => {
    for (const [, before, after] of cases) {
      const plan = planConsentGroupChange(before, after)
      const carried = new Set(plan.carries.map((carry) => `${carry.toHostId}<-${carry.fromHostId}`))
      for (const a of POOL) {
        for (const b of POOL) {
          if (a === b) continue
          const separates =
            membersIn(before, a).includes(b) && !membersIn(after, a).includes(b)
          expect(carried.has(`${a}<-${b}`)).toBe(separates)
        }
      }
    }
  })

  it('I6: one MOVE per key whose sites share one new key, and no solo key for a grouped site', () => {
    for (const [, before, after] of cases) {
      const plan = planConsentGroupChange(before, after)
      const keysBefore = new Set(POOL.map((site) => keyIn(before, site)))
      for (const key of keysBefore) {
        const covered = POOL.filter((site) => keyIn(before, site) === key)
        const targets = new Set(covered.map((site) => keyIn(after, site)))
        const flows = plan.flows.filter((flow) => flow.from === key)
        if (targets.size === 1 && !targets.has(key)) {
          expect(flows.map((flow) => flow.kind)).toEqual(['move'])
          expect(flows[0].kind === 'move' && flows[0].to).toBe([...targets][0])
        } else if (targets.size === 1) {
          expect(flows).toEqual([])
        } else {
          expect(flows.map((flow) => flow.kind)).toEqual(['split'])
        }
      }
      const grouped = new Set(Object.values(after).flatMap((group) => group.hostIds))
      for (const flow of plan.flows) {
        const targets =
          flow.kind === 'move' ? [flow.to] : flow.successors.map((successor) => successor.key)
        for (const target of targets) expect(grouped.has(target)).toBe(false)
      }
    }
  })

  it('every site of a split lands somewhere exactly once', () => {
    for (const [, before, after] of cases) {
      for (const flow of planConsentGroupChange(before, after).flows) {
        if (flow.kind !== 'split') continue
        const landed = [...flow.stayHostIds, ...flow.successors.flatMap((successor) => successor.hostIds)]
        expect(landed.sort()).toEqual([...flow.fromHostIds].sort())
        expect(flow.survives).toBe(flow.stayHostIds.length > 0)
      }
    }
  })
})

describe('describeConsentGroupChangeLine', () => {
  const name = (hostId: string) => ({ a: 'Shop', b: 'Blog', c: 'Bookings' })[hostId] ?? ''

  it('words every kind the activity log records', () => {
    expect(
      describeConsentGroupChangeLine(
        { kind: 'created', groupId: 'g', name: 'Northwind', hostIds: ['a', 'b', 'c'] },
        name,
      ),
    ).toBe('Created consent group "Northwind" with Shop, Blog and Bookings')
    expect(
      describeConsentGroupChangeLine({ kind: 'renamed', groupId: 'g', from: 'Old', to: 'New' }),
    ).toBe('Renamed consent group "Old" to "New"')
    expect(
      describeConsentGroupChangeLine({ kind: 'added', groupId: 'g', name: 'N', hostId: 'a' }, name),
    ).toBe('Added Shop to consent group "N"')
    expect(
      describeConsentGroupChangeLine({ kind: 'removed', groupId: 'g', name: 'N', hostId: 'b' }, name),
    ).toBe('Removed Blog from consent group "N"')
    expect(
      describeConsentGroupChangeLine(
        { kind: 'moved', hostId: 'c', fromGroupId: 'g1', fromName: 'N', toGroupId: 'g2', toName: 'S' },
        name,
      ),
    ).toBe('Moved Bookings from consent group "N" to "S"')
    expect(describeConsentGroupChangeLine({ kind: 'dissolved', groupId: 'g', name: 'N' })).toBe(
      'Dissolved consent group "N"',
    )
  })

  it('falls back to the site id rather than a blank', () => {
    expect(
      describeConsentGroupChangeLine({ kind: 'added', groupId: 'g', name: 'N', hostId: 'zz' }, name),
    ).toBe('Added zz to consent group "N"')
  })
})

describe('the marker', () => {
  const marker = {
    changeId: 'change-1',
    phase: 'rehome',
    hostIds: ['a', 'b'],
    startedAtMs: 10,
    declaredAtMs: 20,
  }

  it('reads a marker and nothing that is not one', () => {
    expect(readConsentGroupsChange({ [CONSENT_GROUPS_CHANGE_FIELD]: marker })).toEqual(marker)
    expect(readConsentGroupsChange({})).toBeNull()
    expect(
      readConsentGroupsChange({ [CONSENT_GROUPS_CHANGE_FIELD]: { ...marker, phase: 'bogus' } }),
    ).toBeNull()
  })

  it('holds a named site’s records in motion only after the flip', () => {
    const org = (phase: string) => ({ [CONSENT_GROUPS_CHANGE_FIELD]: { ...marker, phase } })
    expect(consentGroupHoldersInMotion(org('rehome'), 'a')).toBe(true)
    expect(consentGroupHoldersInMotion(org('sweep'), 'b')).toBe(true)
    expect(consentGroupHoldersInMotion(org('carry'), 'a')).toBe(false)
    expect(consentGroupHoldersInMotion(org('rehome'), 'elsewhere')).toBe(false)
    expect(consentGroupHoldersInMotion({}, 'a')).toBe(false)
  })

  it('is the marker the site-delete hold reads, in every phase', () => {
    // `consent-groups.ts` spells the field itself, since this module imports
    // that one; this pins the two spellings together.
    for (const phase of ['carry', 'rehome', 'sweep']) {
      const org = { [CONSENT_GROUPS_CHANGE_FIELD]: { ...marker, phase } }
      expect(consentGroupSiteHold(org, 'a')).toEqual({ reason: 'changing' })
      expect(consentGroupSiteHold(org, 'elsewhere')).toBeNull()
    }
  })
})

describe('the preview helpers', () => {
  it('lists every group whose signup-form sentence changes', () => {
    const changes = consentGroupDisclosureChanges(
      { g1: { name: 'Old', hostIds: ['a', 'b'] }, g2: { name: 'Same', hostIds: ['c', 'd'] } },
      { g1: { name: 'New', hostIds: ['a', 'b'] }, g2: { name: 'Same', hostIds: ['c', 'd'] } },
    )
    expect(changes).toEqual([
      {
        groupId: 'g1',
        hostIds: ['a', 'b'],
        before: "You'll receive marketing email from Old, which covers 2 sites.",
        after: "You'll receive marketing email from New, which covers 2 sites.",
      },
    ])
  })

  it('estimates by the work counted', () => {
    expect(estimateConsentGroupChange({ renameOnly: true }, 0)).toBe('instant')
    expect(estimateConsentGroupChange({ renameOnly: false }, 4_999)).toBe('under-a-minute')
    expect(estimateConsentGroupChange({ renameOnly: false }, 5_000)).toBe('minutes')
    expect(estimateConsentGroupChange({ renameOnly: false }, 100_000)).toBe('long')
  })
})
