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
  describeScope,
  hostIdsFromScope,
  hostScopeToken,
  isOrgWideScope,
  isScopeToken,
  MAX_SCOPE_HOSTS,
  narrowsScope,
  normalizeVisibleTo,
  ORG_SCOPE_TOKEN,
  parseScopeToken,
  scopeForHosts,
  scopeTokensForHost,
  visibleToHost,
  visibleToTokens,
} from './scope-tokens'

describe('isScopeToken / parseScopeToken', () => {
  it('accepts org and host tokens', () => {
    expect(isScopeToken(ORG_SCOPE_TOKEN)).toBe(true)
    expect(isScopeToken('host:abc')).toBe(true)
    expect(parseScopeToken('host:abc')).toEqual({
      kind: 'host',
      hostId: 'abc',
    })
    expect(parseScopeToken(ORG_SCOPE_TOKEN)).toEqual({ kind: 'org' })
  })

  it('rejects junk, including a prefix with no id', () => {
    expect(isScopeToken('host:')).toBe(false)
    expect(isScopeToken('orgs')).toBe(false)
    expect(isScopeToken('')).toBe(false)
    expect(isScopeToken(null)).toBe(false)
    expect(isScopeToken(42)).toBe(false)
    expect(parseScopeToken('host:')).toBeNull()
  })

  it('keeps host ids containing a colon intact', () => {
    expect(parseScopeToken(hostScopeToken('a:b'))).toEqual({
      kind: 'host',
      hostId: 'a:b',
    })
  })
})

describe('scopeTokensForHost', () => {
  it('reads org-wide resources plus the site itself', () => {
    expect(scopeTokensForHost('h1')).toEqual([ORG_SCOPE_TOKEN, 'host:h1'])
  })
})

describe('visibleToHost', () => {
  it('treats a missing scope as org-wide, for the pre-backfill window', () => {
    expect(visibleToHost(undefined, 'h1')).toBe(true)
    expect(visibleToHost(null, 'h1')).toBe(true)
  })

  it('fails closed on an empty array, which only a bug can write', () => {
    expect(visibleToHost([], 'h1')).toBe(false)
  })

  it('matches org-wide and the named host, and nothing else', () => {
    expect(visibleToHost([ORG_SCOPE_TOKEN], 'h1')).toBe(true)
    expect(visibleToHost(['host:h1'], 'h1')).toBe(true)
    expect(visibleToHost(['host:h2'], 'h1')).toBe(false)
    expect(visibleToHost(['host:h2', 'host:h1'], 'h1')).toBe(true)
  })

  it('does not match on a host id prefix', () => {
    expect(visibleToHost(['host:h10'], 'h1')).toBe(false)
  })
})

describe('visibleToTokens', () => {
  it('mirrors the rules hasAny check', () => {
    const collaborator = scopeTokensForHost('h1')
    expect(visibleToTokens([ORG_SCOPE_TOKEN], collaborator)).toBe(true)
    expect(visibleToTokens(['host:h1'], collaborator)).toBe(true)
    expect(visibleToTokens(['host:h2'], collaborator)).toBe(false)
  })

  it('denies a caller holding no tokens', () => {
    expect(visibleToTokens(['host:h1'], [])).toBe(false)
    expect(visibleToTokens(['host:h1'], undefined)).toBe(false)
  })

  it('still lets a legacy unscoped resource through', () => {
    expect(visibleToTokens(undefined, [])).toBe(true)
  })
})

describe('normalizeVisibleTo', () => {
  it('collapses to org-wide, since org already implies every host', () => {
    expect(normalizeVisibleTo([ORG_SCOPE_TOKEN, 'host:h1'])).toEqual([
      ORG_SCOPE_TOKEN,
    ])
  })

  it('dedupes and drops junk', () => {
    expect(
      normalizeVisibleTo(['host:h1', 'host:h1', 'nonsense', 'host:h2'])
    ).toEqual(['host:h1', 'host:h2'])
  })

  it('returns null rather than silently dropping or widening', () => {
    expect(normalizeVisibleTo([])).toBeNull()
    expect(normalizeVisibleTo(['nonsense'])).toBeNull()
    expect(normalizeVisibleTo(undefined)).toBeNull()
    const tooMany = Array.from({ length: MAX_SCOPE_HOSTS + 1 }, (_, i) =>
      hostScopeToken(`h${i}`)
    )
    expect(normalizeVisibleTo(tooMany)).toBeNull()
  })

  it('accepts exactly the cap', () => {
    const atCap = Array.from({ length: MAX_SCOPE_HOSTS }, (_, i) =>
      hostScopeToken(`h${i}`)
    )
    expect(normalizeVisibleTo(atCap)).toHaveLength(MAX_SCOPE_HOSTS)
  })
})

describe('scopeForHosts / hostIdsFromScope', () => {
  it('round-trips a selected-sites scope', () => {
    const scope = scopeForHosts(['a', 'b', 'c'])
    expect(scope).toEqual(['host:a', 'host:b', 'host:c'])
    expect(hostIdsFromScope(scope ?? [])).toEqual(['a', 'b', 'c'])
  })

  it('names no hosts for an org-wide scope', () => {
    expect(hostIdsFromScope([ORG_SCOPE_TOKEN])).toEqual([])
  })
})

describe('isOrgWideScope', () => {
  it('counts the legacy absent scope as org-wide', () => {
    expect(isOrgWideScope(undefined)).toBe(true)
    expect(isOrgWideScope([ORG_SCOPE_TOKEN])).toBe(true)
    expect(isOrgWideScope(['host:h1'])).toBe(false)
    expect(isOrgWideScope([])).toBe(false)
  })
})

describe('narrowsScope', () => {
  it('flags org-wide going to selected sites', () => {
    expect(narrowsScope([ORG_SCOPE_TOKEN], ['host:h1'])).toBe(true)
    expect(narrowsScope(undefined, ['host:h1'])).toBe(true)
  })

  it('does not flag widening', () => {
    expect(narrowsScope(['host:h1'], [ORG_SCOPE_TOKEN])).toBe(false)
    expect(narrowsScope(['host:h1'], ['host:h1', 'host:h2'])).toBe(false)
  })

  it('flags dropping a host from a selected-sites scope', () => {
    expect(narrowsScope(['host:h1', 'host:h2'], ['host:h1'])).toBe(true)
  })

  it('does not flag a no-op', () => {
    expect(narrowsScope([ORG_SCOPE_TOKEN], [ORG_SCOPE_TOKEN])).toBe(false)
    expect(narrowsScope(['host:h1'], ['host:h1'])).toBe(false)
  })
})

describe('describeScope', () => {
  const names = { h1: 'Northwind Coffee', h2: 'Contoso' }

  it('describes the org-wide cases', () => {
    expect(describeScope(undefined, names)).toBe('All sites')
    expect(describeScope([ORG_SCOPE_TOKEN], names)).toBe('All sites')
  })

  it('names a single site when it can', () => {
    expect(describeScope(['host:h1'], names)).toBe('Northwind Coffee only')
    expect(describeScope(['host:unknown'], names)).toBe('1 site')
  })

  it('counts multiple sites', () => {
    expect(describeScope(['host:h1', 'host:h2'], names)).toBe('2 sites')
  })

  it('says so when a scope names nobody', () => {
    expect(describeScope([], names)).toBe('No sites')
  })
})
