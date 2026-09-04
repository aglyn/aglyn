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
  defaultScopeForNewResource,
  describeScope,
  hostQualifiedCdnPath,
  scopeCovers,
  hostIdsFromScope,
  hostScopeToken,
  isOrgWideScope,
  isScopeToken,
  MAX_SCOPE_HOSTS,
  narrowsScope,
  newResourceScopeFields,
  normalizeVisibleTo,
  ORG_SCOPE_TOKEN,
  type ScopeToken,
  parseScopeToken,
  scopeForHosts,
  scopeTokensForHost,
  storedScope,
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
  /**
   * The fail-open, closed.
   *
   * A missing `visibleTo` used to answer "every site", which is the shape
   * this codebase keeps paying for: a read that cannot see a value answering
   * the same as a value that is absent. Both enforcement layers underneath
   * — `array-contains-any` and the rules' `hasAny` — have always answered
   * false for a document with no array, so the permissive default was one
   * helper disagreeing with the database.
   */
  it('treats a missing scope as visible to NOBODY, matching both enforcement layers', () => {
    expect(visibleToHost(undefined, 'h1')).toBe(false)
    expect(visibleToHost(null, 'h1')).toBe(false)
  })

  /**
   * ANTI-VACUITY. The line above passes against a `visibleToHost` that
   * refuses everything, which would hide every resource in the product. This
   * is the control that says the door still opens.
   */
  it('still admits a stamped resource, so the close is not a blanket refusal', () => {
    expect(visibleToHost([ORG_SCOPE_TOKEN], 'h1')).toBe(true)
    expect(visibleToHost(['host:h1'], 'h1')).toBe(true)
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

  it('refuses an unscoped resource, the twin of the rules’ hasAny', () => {
    expect(visibleToTokens(undefined, [])).toBe(false)
    expect(visibleToTokens(undefined, [ORG_SCOPE_TOKEN])).toBe(false)
    // The control: a stamped resource still reaches a caller holding the org
    // token, so this is the missing field being refused and not everything.
    expect(visibleToTokens([ORG_SCOPE_TOKEN], [ORG_SCOPE_TOKEN])).toBe(true)
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
  /**
   * An absent scope is NOT org-wide. While it answered `true`, the console
   * rendered "All sites" over a document that no site could see — the
   * inversion `storedScope` exists to keep out of the editors.
   */
  it('counts only a stamped org token as org-wide', () => {
    expect(isOrgWideScope(undefined)).toBe(false)
    expect(isOrgWideScope([ORG_SCOPE_TOKEN])).toBe(true)
    expect(isOrgWideScope(['host:h1'])).toBe(false)
    expect(isOrgWideScope([])).toBe(false)
  })
})

describe('narrowsScope', () => {
  it('flags org-wide going to selected sites', () => {
    expect(narrowsScope([ORG_SCOPE_TOKEN], ['host:h1'])).toBe(true)
  })

  /**
   * Stamping a scope onto a document that had none is a WIDENING, not a
   * narrowing: nothing could see it before. Confirming it as a narrowing
   * would put a "sites will lose access" warning in front of the one save
   * that gives access back.
   */
  it('does not flag a stamp onto an unscoped document', () => {
    expect(narrowsScope(undefined, ['host:h1'])).toBe(false)
    expect(narrowsScope(undefined, [ORG_SCOPE_TOKEN])).toBe(false)
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
    expect(describeScope([ORG_SCOPE_TOKEN], names)).toBe('All sites')
  })

  /** And an unscoped document is described as what it is. */
  it('does not describe an unscoped document as shared with everyone', () => {
    expect(describeScope(undefined, names)).toBe('No sites')
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

describe('hostQualifiedCdnPath (AGL-1043/1045)', () => {
  const PATH = '/api/media/cdn/org:acme/med123'

  it('leaves an org-wide asset alone', () => {
    expect(hostQualifiedCdnPath(PATH, ['org'], 'site-a')).toBe(PATH)
  })

  /**
   * An UNSCOPED asset is qualified with the site, because it is no longer
   * org-wide. The org CDN path serves org-wide assets only, so leaving it
   * bare would ask the unauthenticated CDN for a scope the asset does not
   * have — and the CDN's own check is the one that refuses.
   */
  it('names the site for an unscoped asset rather than assuming org-wide', () => {
    expect(hostQualifiedCdnPath(PATH, undefined, 'site-a')).toBe(
      '/api/media/cdn/org:acme:site-a/med123',
    )
  })

  it('names the site for a restricted asset', () => {
    expect(hostQualifiedCdnPath(PATH, ['host:site-a'], 'site-a')).toBe(
      '/api/media/cdn/org:acme:site-a/med123',
    )
  })

  it('keeps the immutable hash segment', () => {
    expect(
      hostQualifiedCdnPath(`${PATH}/abc123`, ['host:site-a'], 'site-a'),
    ).toBe('/api/media/cdn/org:acme:site-a/med123/abc123')
  })

  it('does no harm when there is nothing to qualify', () => {
    expect(hostQualifiedCdnPath(PATH, ['host:site-a'], undefined)).toBe(PATH)
    // A host-library asset: its scope segment is not an org one.
    const hostPath = '/api/media/cdn/site-a/med123'
    expect(hostQualifiedCdnPath(hostPath, ['host:site-a'], 'site-a')).toBe(
      hostPath,
    )
    expect(hostQualifiedCdnPath(undefined, ['host:x'], 'site-a')).toBeUndefined()
    expect(hostQualifiedCdnPath('https://cdn.example/x.png', ['host:x'], 'a')).toBe(
      'https://cdn.example/x.png',
    )
  })

  it('does not double-qualify an already-scoped path', () => {
    const already = '/api/media/cdn/org:acme:site-a/med123'
    expect(hostQualifiedCdnPath(already, ['host:site-a'], 'site-b')).toBe(already)
  })
})

describe('scopeCovers (AGL-1044)', () => {
  it('org-wide covers everything', () => {
    expect(scopeCovers(['org'], ['host:a'])).toBe(true)
    expect(scopeCovers(['org'], ['org'])).toBe(true)
  })

  /** An unscoped target reaches no site, so it covers nothing. */
  it('does not let an unscoped target cover a source', () => {
    expect(scopeCovers(undefined, ['host:a'])).toBe(false)
  })

  it('a restricted target cannot cover an org-wide source', () => {
    // A page on ANY site can bind the source; most cannot resolve the
    // target, so the reference renders blank with no explanation.
    expect(scopeCovers(['host:a'], ['org'])).toBe(false)
    // An unscoped SOURCE reaches nowhere, so any target covers it.
    expect(scopeCovers(['host:a'], undefined)).toBe(true)
  })

  it('covers when the target reaches every site the source does', () => {
    expect(scopeCovers(['host:a', 'host:b'], ['host:a'])).toBe(true)
    expect(scopeCovers(['host:a'], ['host:a'])).toBe(true)
  })

  it('does not cover when the source reaches further', () => {
    expect(scopeCovers(['host:a'], ['host:a', 'host:b'])).toBe(false)
  })
})

describe('defaultScopeForNewResource (AGL-1048)', () => {
  it('is org-wide unless the org opted into site-private', () => {
    expect(defaultScopeForNewResource({ hostId: 'h1' })).toEqual(['org'])
    expect(
      defaultScopeForNewResource({ defaultResourceScope: 'org', hostId: 'h1' }),
    ).toEqual(['org'])
  })

  it('starts site-private when the org asked for it', () => {
    expect(
      defaultScopeForNewResource({ defaultResourceScope: 'host', hostId: 'h1' }),
    ).toEqual(['host:h1'])
  })

  it('falls back to org-wide with no site in context', () => {
    // Created from the org Media/Data page: inventing a host would hide the
    // resource from the page that just created it.
    expect(defaultScopeForNewResource({ defaultResourceScope: 'host' })).toEqual([
      'org',
    ])
    expect(
      defaultScopeForNewResource({ defaultResourceScope: 'host', hostId: null }),
    ).toEqual(['org'])
  })
})

describe('newResourceScopeFields (AGL-1478)', () => {
  it('stamps the tokens it was given, copied not aliased', () => {
    const chosen: ScopeToken[] = ['host:h1']
    const fields = newResourceScopeFields(chosen)
    expect(fields).toEqual({ visibleTo: ['host:h1'] })
    chosen.push('host:h2')
    expect(fields.visibleTo).toEqual(['host:h1'])
  })

  it('stores nothing for a collection that is not scoped', () => {
    // `hosts/{hostId}` subcollections are private by construction; the
    // point of spelling it `null` is that it is a DECISION, distinguishable
    // from a creator who never thought about it.
    expect(newResourceScopeFields(null)).toEqual({})
  })

  it('throws rather than storing "visible to nobody"', () => {
    // An empty array is written, not absent: the backfill leaves it alone
    // by design and no read path treats it as legacy, so it is permanent
    // where a missing field is repairable.
    expect(() => newResourceScopeFields([])).toThrow(/empty scope/)
  })
})

/**
 * The read-side counterpart of `newResourceScopeFields`, and the answer to
 * the same question this module keeps being asked wrongly (AGL-1466/1480).
 *
 * Every helper above answers "may this be seen", where a missing field reads
 * as visible to nobody. An EDITOR asks a different question — "what is
 * stored" — and four call sites in two files each wrote their own
 * `Array.isArray(x) ? x : ['org']` for it, which is the first question's
 * answer given to the second one. That is how a folder no site could see
 * reported "All sites" for three weeks.
 */
describe('storedScope (AGL-1480)', () => {
  it('answers null when nothing is stored', () => {
    expect(storedScope(undefined)).toBeNull()
    expect(storedScope(null)).toBeNull()
    // Not an array at all — a legacy string, a number, whatever landed there.
    expect(storedScope('org' as unknown as string[])).toBeNull()
  })

  it('answers null for a stored empty array too', () => {
    // The two are different on the doc and identical to an editor: neither
    // is a scope somebody chose, and both must offer the choice rather than
    // pre-fill one. `newResourceScopeFields` refuses to WRITE this; the
    // editor still has to read the ones that exist.
    expect(storedScope([])).toBeNull()
  })

  it('answers the tokens verbatim, copied not aliased', () => {
    const stored = ['host:h1', 'host:h2']
    const read = storedScope(stored)
    expect(read).toEqual(['host:h1', 'host:h2'])
    stored.push('org')
    expect(read).toEqual(['host:h1', 'host:h2'])
  })

  it('does not normalize — an editor shows what is there', () => {
    // `normalizeVisibleTo` collapses and dedupes for STORAGE. Doing it here
    // would make an untouched drawer differ from the document it was seeded
    // from, and the save gate compares those two to decide whether to write.
    expect(storedScope(['org', 'host:h1'])).toEqual(['org', 'host:h1'])
    expect(normalizeVisibleTo(['org', 'host:h1'])).toEqual([ORG_SCOPE_TOKEN])
  })

  it('never substitutes the org token, which is the whole point', () => {
    expect(storedScope(undefined)).not.toEqual([ORG_SCOPE_TOKEN])
    // The reading the rest of this module takes, for contrast: absent is
    // visible to NOBODY when asking permission, and stored-nothing when
    // asking what a person chose. The two answers differ, and an editor that
    // took the permission answer would offer no choice at all.
    expect(visibleToHost(undefined, 'h1')).toBe(false)
  })
})
