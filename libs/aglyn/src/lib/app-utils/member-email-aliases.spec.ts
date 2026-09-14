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

import {
  evaluateMemberEmailAliasAdd,
  findMemberByEmailAddress,
  isVerifiedMemberEmailAlias,
  MEMBER_EMAIL_ALIASES_MAX,
  type MemberEmailAlias,
  memberEmailAddresses,
  memberEmailAliasRows,
  normalizeMemberEmailAlias,
  readMemberEmailAliases,
  verifiedMemberEmailAliases,
} from './member-email-aliases'

/**
 * A member's own addresses (AGL-2975): only a confirmed alias is theirs,
 * and every address is normalized the way a sign-in address is.
 */

const confirmed = (address: string, addedAtMs = 1_000): MemberEmailAlias => ({
  address,
  addedAtMs,
  verifiedAtMs: addedAtMs + 1,
})
const pending = (address: string, addedAtMs = 1_000): MemberEmailAlias => ({ address, addedAtMs })

describe('reading a stored document', () => {
  it('keeps addresses, normalized, and drops whatever is not one', () => {
    expect(
      readMemberEmailAliases({
        aliases: [
          { address: '  Zach@Aglyn.IO ', addedAtMs: 10, verifiedAtMs: 20 },
          { address: 'not an address', addedAtMs: 11 },
          { address: 'ops@aglyn.io', addedAtMs: 0 },
          { address: 'sales@aglyn.io', addedAtMs: 12, verifiedAtMs: 'yesterday' },
          null,
        ],
      }),
    ).toEqual([
      { address: 'zach@aglyn.io', addedAtMs: 10, verifiedAtMs: 20 },
      { address: 'sales@aglyn.io', addedAtMs: 12 },
    ])
    expect(readMemberEmailAliases(undefined)).toEqual([])
    expect(readMemberEmailAliases({ aliases: 'zach@aglyn.io' })).toEqual([])
  })

  it('keeps the first entry of a repeated address and never more than the ceiling', () => {
    const many = Array.from({ length: MEMBER_EMAIL_ALIASES_MAX + 3 }, (_, index) => ({
      address: `rep${index}@aglyn.io`,
      addedAtMs: index + 1,
    }))
    expect(readMemberEmailAliases({ aliases: many })).toHaveLength(MEMBER_EMAIL_ALIASES_MAX)
    expect(
      readMemberEmailAliases({
        aliases: [
          { address: 'zach@aglyn.io', addedAtMs: 1 },
          { address: 'ZACH@aglyn.io', addedAtMs: 2, verifiedAtMs: 3 },
        ],
      }),
    ).toEqual([{ address: 'zach@aglyn.io', addedAtMs: 1 }])
  })

  it('answers only the CONFIRMED addresses to a reader deciding whose an address is', () => {
    const document = { aliases: [confirmed('zach@aglyn.io'), pending('typo@aglyn.io')] }
    expect(verifiedMemberEmailAliases(document)).toEqual(['zach@aglyn.io'])
    expect(isVerifiedMemberEmailAlias(pending('typo@aglyn.io'))).toBe(false)
    expect(isVerifiedMemberEmailAlias({ verifiedAtMs: Number.NaN })).toBe(false)
    expect(isVerifiedMemberEmailAlias(null)).toBe(false)
  })
})

describe('normalization, the same as a sign-in address', () => {
  it('folds case and whitespace, and keeps plus addressing as another address', () => {
    expect(normalizeMemberEmailAlias('  Zach@Aglyn.IO\t')).toBe('zach@aglyn.io')
    expect(normalizeMemberEmailAlias('zach+news@aglyn.io')).toBe('zach+news@aglyn.io')
    expect(normalizeMemberEmailAlias('zach')).toBeNull()
  })

  it('reads a member’s addresses — sign-in first, then confirmed aliases — each once', () => {
    expect(
      memberEmailAddresses({
        email: 'Zach@Aglyn.com',
        verifiedAliases: [' zach@aglyn.io', 'ZACH@AGLYN.IO', 'zach@aglyn.com'],
      }),
    ).toEqual(['zach@aglyn.com', 'zach@aglyn.io'])
    expect(memberEmailAddresses({ email: '' })).toEqual([])
    expect(memberEmailAddresses(null)).toEqual([])
  })
})

describe('whose address it is', () => {
  const zach = { uid: 'u-zach', email: 'zach@aglyn.com', verifiedAliases: ['zach@aglyn.io'] }
  const kim = { uid: 'u-kim', email: 'kim@aglyn.com', verifiedAliases: ['sales@aglyn.io'] }
  const sam = { uid: 'u-sam', email: 'sam@aglyn.com', verifiedAliases: ['sales@aglyn.io'] }

  it('finds the member by a confirmed alias, in any case or spacing', () => {
    expect(findMemberByEmailAddress([kim, zach], ' ZACH@aglyn.io ')?.uid).toBe('u-zach')
  })

  it('lets a sign-in address decide over an alias somebody else confirmed', () => {
    const claimant = { uid: 'u-other', email: 'other@aglyn.com', verifiedAliases: ['kim@aglyn.com'] }
    expect(findMemberByEmailAddress([claimant, kim], 'kim@aglyn.com')?.uid).toBe('u-kim')
  })

  it('names nobody for an alias two members confirmed, or a plus-addressed variant', () => {
    expect(findMemberByEmailAddress([zach, kim, sam], 'sales@aglyn.io')).toBeNull()
    expect(findMemberByEmailAddress([zach], 'zach+news@aglyn.io')).toBeNull()
    expect(findMemberByEmailAddress([zach], 'not an address')).toBeNull()
  })
})

describe('adding an address', () => {
  const base = { signInEmail: 'zach@aglyn.com', reservedDomains: ['in.aglyn.com'] }

  it('accepts a new address, normalized', () => {
    expect(evaluateMemberEmailAliasAdd({ ...base, address: ' Zach@Aglyn.IO', aliases: [] })).toEqual({
      ok: true,
      address: 'zach@aglyn.io',
      existing: null,
    })
  })

  it('answers an unconfirmed duplicate with the entry, so the caller sends another link', () => {
    const entry = pending('zach@aglyn.io', 42)
    expect(
      evaluateMemberEmailAliasAdd({ ...base, address: 'zach@aglyn.io', aliases: [entry] }),
    ).toEqual({ ok: true, address: 'zach@aglyn.io', existing: entry })
  })

  it.each([
    ['not an address', [], 'invalid-address'],
    ['"Zach" <zach@aglyn.io>', [], 'invalid-address'],
    ['zach,ops@aglyn.io', [], 'invalid-address'],
    [' ZACH@aglyn.com', [], 'sign-in-address'],
    [`crm+${'a'.repeat(32)}@in.aglyn.com`, [], 'reserved-domain'],
    ['zach@aglyn.io', [confirmed('zach@aglyn.io')], 'already-confirmed'],
  ] as const)('refuses %s', (address, aliases, refusal) => {
    expect(evaluateMemberEmailAliasAdd({ ...base, address, aliases })).toMatchObject({
      ok: false,
      refusal,
    })
  })

  it('refuses a new address past the ceiling, but not another link for one it holds', () => {
    const full = Array.from({ length: MEMBER_EMAIL_ALIASES_MAX }, (_, index) =>
      pending(`rep${index}@aglyn.io`, index + 1),
    )
    expect(evaluateMemberEmailAliasAdd({ ...base, address: 'new@aglyn.io', aliases: full })).toMatchObject({
      ok: false,
      refusal: 'limit-reached',
    })
    expect(evaluateMemberEmailAliasAdd({ ...base, address: 'rep0@aglyn.io', aliases: full })).toMatchObject({
      ok: true,
    })
  })
})

describe('the rows the management route answers', () => {
  it('lists addresses in the order they were added, with their state', () => {
    expect(memberEmailAliasRows([pending('b@aglyn.io', 20), confirmed('a@aglyn.io', 10)])).toEqual([
      { address: 'a@aglyn.io', addedAtMs: 10, verified: true, verifiedAtMs: 11 },
      { address: 'b@aglyn.io', addedAtMs: 20, verified: false, verifiedAtMs: null },
    ])
  })
})
