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
  defaultMediaScopeOf,
  defaultScopeForNewResource,
  describeScope,
  describeSharing,
  grantedScopeTokens,
  heldByHost,
  heldScopeTokens,
  hostQualifiedCdnPath,
  scopeCovers,
  hostIdsFromScope,
  hostScopeToken,
  isOrgWideScope,
  isScopeToken,
  isSiteOnlyScope,
  MAX_SCOPE_HOSTS,
  narrowsScope,
  newResourceScopeFields,
  normalizeVisibleTo,
  ORG_SCOPE_TOKEN,
  type ScopeToken,
  parseScopeToken,
  reconcileAllExcept,
  SCOPE_MODE_ALL_EXCEPT,
  scopeForHosts,
  scopeSharingOf,
  scopeToStore,
  scopeTokensForHost,
  seenOnlyThroughGrant,
  sharingCovers,
  sharingFromChoice,
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

/**
 * A save that cannot store its selection must say why and store nothing
 * (AGL-2773). Substituting the org token for `normalizeVisibleTo`'s null
 * shares the resource with every site.
 */
describe('scopeToStore', () => {
  it('passes a storable scope through, normalized', () => {
    expect(scopeToStore(['host:h1', 'host:h1'])).toEqual({
      scope: ['host:h1'],
      problem: null,
    })
    expect(scopeToStore([ORG_SCOPE_TOKEN, 'host:h1'])).toEqual({
      scope: [ORG_SCOPE_TOKEN],
      problem: null,
    })
  })

  it('refuses an empty selection, and never answers with the org token', () => {
    for (const input of [[], ['nonsense'], undefined, null]) {
      const result = scopeToStore(input)
      expect(result.scope).toBeNull()
      expect(result.problem).toMatch(/at least one site/)
    }
  })

  it('refuses a selection over the cap, naming the cap', () => {
    const tooMany = Array.from({ length: MAX_SCOPE_HOSTS + 1 }, (_, i) =>
      hostScopeToken(`h${i}`)
    )
    const result = scopeToStore(tooMany)
    expect(result.scope).toBeNull()
    expect(result.problem).toContain(`${MAX_SCOPE_HOSTS} sites or fewer`)
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

describe('defaultMediaScopeOf (AGL-3662)', () => {
  it('is the media value when set, the dataset value until then', () => {
    expect(defaultMediaScopeOf({ defaultMediaScope: 'org', defaultResourceScope: 'host' })).toBe('org')
    expect(defaultMediaScopeOf({ defaultMediaScope: 'host', defaultResourceScope: 'org' })).toBe('host')
    expect(defaultMediaScopeOf({ defaultResourceScope: 'host' })).toBe('host')
    expect(defaultMediaScopeOf({})).toBeUndefined()
    expect(defaultMediaScopeOf(undefined)).toBeUndefined()
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

/**
 * SEEN, AND HELD (AGL-3336). A share widens `visibleTo` and records what it
 * added under `sharing.added`; holding is `visibleTo` without those tokens.
 */
describe('held scope tokens', () => {
  const shared = { visibleTo: ['host:a', 'host:b', 'org'], sharing: { added: ['host:b', 'org'] } }

  it('reads the grant tokens, and nothing from a document never shared', () => {
    expect(grantedScopeTokens(shared)).toEqual(['host:b', 'org'])
    expect(grantedScopeTokens({ visibleTo: ['host:a'] })).toEqual([])
    expect(grantedScopeTokens({ sharing: { added: 'org' } })).toEqual([])
    expect(grantedScopeTokens(null)).toEqual([])
  })

  it('holds by visibleTo less the grants — and by nothing without visibleTo', () => {
    expect(heldScopeTokens(shared)).toEqual(['host:a'])
    expect(heldScopeTokens({ visibleTo: ['host:a', 'org'] })).toEqual(['host:a', 'org'])
    expect(heldScopeTokens({ sharing: { added: ['host:b'] } })).toEqual([])
  })

  it('keeps a site that captured the person as a holder, whatever the grants say', () => {
    const capturedLater = { ...shared, capturedByHostIds: ['a', 'b'] }
    expect(heldScopeTokens(capturedLater)).toEqual(['host:a', 'host:b'])
    expect(seenOnlyThroughGrant(capturedLater, 'b')).toBe(false)
    expect(heldScopeTokens({ ...shared, hostId: 'b' })).toEqual(['host:a', 'host:b'])
  })

  it('tells a site that holds a document from one that only sees it', () => {
    expect(visibleToHost(shared.visibleTo, 'b')).toBe(true)
    expect(heldByHost(shared, 'b')).toBe(false)
    expect(heldByHost(shared, 'a')).toBe(true)
    expect(seenOnlyThroughGrant(shared, 'b')).toBe(true)
    expect(seenOnlyThroughGrant(shared, 'a')).toBe(false)
    // A document with no grants answers exactly as before: never "only a grant".
    expect(seenOnlyThroughGrant({ visibleTo: ['host:a'] }, 'b')).toBe(false)
    expect(seenOnlyThroughGrant({}, 'b')).toBe(false)
  })
})

describe('all sites except', () => {
  const SITES = ['a', 'b', 'c']
  const marked = (
    visibleTo: string[],
    except: string[],
    extra: Record<string, unknown> = {},
  ) => ({
    visibleTo,
    scopeMode: SCOPE_MODE_ALL_EXCEPT,
    scopeExcept: except,
    ...extra,
  })

  describe('scopeSharingOf', () => {
    it('reads each way of sharing', () => {
      expect(scopeSharingOf({ visibleTo: ['org'] })).toEqual({ mode: 'all' })
      expect(scopeSharingOf({ visibleTo: ['host:a'] })).toEqual({ mode: 'selected', hostIds: ['a'] })
      expect(scopeSharingOf(marked(['host:b'], ['host:a']))).toEqual({
        mode: 'allExcept',
        exceptHostIds: ['a'],
        includedHostIds: ['b'],
      })
      expect(scopeSharingOf({})).toEqual({ mode: 'none' })
      expect(scopeSharingOf(null)).toEqual({ mode: 'none' })
    })

    it('believes what readers enforce when the marker disagrees', () => {
      expect(scopeSharingOf(marked(['org'], ['host:a']))).toEqual({ mode: 'all' })
      expect(scopeSharingOf({ visibleTo: ['host:b'], scopeMode: 'allExcept' })).toEqual({
        mode: 'selected',
        hostIds: ['b'],
      })
    })
  })

  describe('sharingFromChoice', () => {
    it('All sites clears any marker', () => {
      expect(sharingFromChoice({ mode: 'all' }, SITES)).toEqual({
        fields: { visibleTo: ['org'], scopeMode: null, scopeExcept: null },
        problem: null,
      })
    })

    it('chosen sites clear any marker and keep the query cap', () => {
      expect(sharingFromChoice({ mode: 'selected', hostIds: ['a'] }, SITES).fields).toEqual({
        visibleTo: ['host:a'],
        scopeMode: null,
        scopeExcept: null,
      })
      const tooMany = Array.from({ length: MAX_SCOPE_HOSTS + 1 }, (_, at) => `h${at}`)
      expect(sharingFromChoice({ mode: 'selected', hostIds: tooMany }, tooMany).fields).toBeNull()
    })

    it('stores the included sites as tokens, with the marker beside them', () => {
      expect(sharingFromChoice({ mode: 'allExcept', exceptHostIds: ['a'] }, SITES).fields).toEqual({
        visibleTo: ['host:b', 'host:c'],
        scopeMode: 'allExcept',
        scopeExcept: ['host:a'],
      })
    })

    it('stores past the 30 a query can ask for, unless the collection caps it', () => {
      const many = Array.from({ length: 250 }, (_, at) => `h${at}`)
      const choice = { mode: 'allExcept', exceptHostIds: ['h0'] } as const
      expect(sharingFromChoice(choice, many).fields?.visibleTo).toHaveLength(249)
      expect(sharingFromChoice(choice, many, { maxIncluded: 30 }).fields).toBeNull()
      expect(sharingFromChoice(choice, many, { maxIncluded: 30 }).problem).toContain('30 sites')
    })

    it('refuses excluding nothing and excluding everything', () => {
      expect(sharingFromChoice({ mode: 'allExcept', exceptHostIds: [] }, SITES).fields).toBeNull()
      expect(sharingFromChoice({ mode: 'allExcept', exceptHostIds: ['gone'] }, SITES).fields).toBeNull()
      expect(sharingFromChoice({ mode: 'allExcept', exceptHostIds: SITES }, SITES).fields).toBeNull()
    })

    it('a kept site stays on the list though it is excluded', () => {
      expect(
        sharingFromChoice({ mode: 'allExcept', exceptHostIds: ['a'] }, SITES, { keepHostIds: ['a'] }).fields,
      ).toEqual({
        visibleTo: ['host:a', 'host:b', 'host:c'],
        scopeMode: 'allExcept',
        scopeExcept: ['host:a'],
      })
    })
  })

  describe('reconcileAllExcept', () => {
    it('leaves a document with no marker alone, whatever it says', () => {
      for (const doc of [{ visibleTo: ['org'] }, { visibleTo: ['host:zzz'] }, {}, null]) {
        expect(reconcileAllExcept(doc, SITES)).toEqual({ status: 'unmarked', fields: null })
      }
    })

    it('adds a new site, and does not add an excluded one', () => {
      expect(reconcileAllExcept(marked(['host:b'], ['host:a']), SITES)).toEqual({
        status: 'changed',
        fields: { visibleTo: ['host:b', 'host:c'], scopeMode: 'allExcept', scopeExcept: ['host:a'] },
      })
    })

    it('takes a site that left off both lists', () => {
      expect(
        reconcileAllExcept(marked(['host:b', 'host:c', 'host:gone'], ['host:a', 'host:away']), SITES).fields,
      ).toEqual({ visibleTo: ['host:b', 'host:c'], scopeMode: 'allExcept', scopeExcept: ['host:a'] })
    })

    it('reports nothing to do whatever order the list is in', () => {
      expect(reconcileAllExcept(marked(['host:c', 'host:b'], ['host:a']), SITES)).toEqual({
        status: 'current',
        fields: null,
      })
    })

    it('is idempotent: running over its own answer says current', () => {
      const first = reconcileAllExcept(marked(['host:gone'], ['host:a']), SITES)
      expect(first.status).toBe('changed')
      expect(reconcileAllExcept({ ...first.fields }, SITES).status).toBe('current')
    })

    it('collapses to All sites when the last exclusion is gone', () => {
      expect(reconcileAllExcept(marked(['host:b', 'host:c'], ['host:a']), ['b', 'c']).fields).toEqual({
        visibleTo: ['org'],
        scopeMode: null,
        scopeExcept: null,
      })
    })

    it('keeps the marker and the data when only excluded sites remain', () => {
      expect(reconcileAllExcept(marked(['host:b'], ['host:a']), ['a']).fields).toEqual({
        visibleTo: [],
        scopeMode: 'allExcept',
        scopeExcept: ['host:a'],
      })
    })

    it('refuses to guess at a damaged marker, in either direction', () => {
      for (const doc of [
        marked(['org'], ['host:a']),
        { visibleTo: ['host:b'], scopeMode: 'allExcept' },
        { visibleTo: ['host:b'], scopeMode: 'allExcept', scopeExcept: ['junk'] },
        { visibleTo: ['host:b'], scopeMode: 'other', scopeExcept: ['host:a'] },
        { scopeMode: 'allExcept', scopeExcept: ['host:a'] },
      ]) {
        expect(reconcileAllExcept(doc, SITES)).toEqual({ status: 'invalid', fields: null })
      }
    })

    it('stops widening at the cap, and still takes away what is gone', () => {
      expect(reconcileAllExcept(marked(['host:b'], ['host:a']), SITES, { maxIncluded: 1 })).toEqual({
        status: 'capped',
        fields: null,
      })
      expect(
        reconcileAllExcept(marked(['host:b', 'host:gone'], ['host:a']), SITES, { maxIncluded: 1 }),
      ).toEqual({
        status: 'capped',
        fields: { visibleTo: ['host:b'], scopeMode: 'allExcept', scopeExcept: ['host:a'] },
      })
    })

    it('never widens past the cap by keeping up: an over-cap document that is current stays', () => {
      expect(
        reconcileAllExcept(marked(['host:b', 'host:c'], ['host:a']), SITES, { maxIncluded: 1 }).status,
      ).toBe('current')
    })

    it('keeps a site shared by a grant, and a kept site, only while it is in the workspace', () => {
      const granted = marked(['host:a', 'host:b', 'host:c'], ['host:a'], {
        sharing: { added: ['host:a'] },
      })
      expect(reconcileAllExcept(granted, SITES).status).toBe('current')
      expect(reconcileAllExcept(marked(['host:b', 'host:c'], ['host:a']), SITES, { keepHostIds: ['a'] }).fields?.visibleTo).toEqual([
        'host:a',
        'host:b',
        'host:c',
      ])
      expect(reconcileAllExcept(marked(['host:b', 'host:c'], ['host:a']), SITES, { keepHostIds: ['gone'] }).status).toBe('current')
    })
  })

  describe('describeSharing', () => {
    it('names excluded sites where it can, and counts where it cannot', () => {
      expect(describeSharing(marked(['host:b'], ['host:a']), { a: 'Bakery' })).toBe('All sites except Bakery')
      expect(describeSharing(marked(['host:b'], ['host:a']))).toBe('All sites except 1 site')
      expect(describeSharing(marked(['host:c'], ['host:a', 'host:b']), { a: 'Bakery', b: 'Deli' })).toBe(
        'All sites except Bakery and Deli',
      )
      expect(describeSharing(marked(['host:c'], ['host:a', 'host:b']), { a: 'Bakery' })).toBe('All sites except 2 sites')
    })

    it('reads as no sites when nothing is included', () => {
      expect(describeSharing(marked([], ['host:a']), { a: 'Bakery' })).toBe('No sites')
    })

    it('answers as describeScope for a document with no marker', () => {
      for (const visibleTo of [['org'], ['host:a'], ['host:a', 'host:b'], []]) {
        expect(describeSharing({ visibleTo }, { a: 'Bakery' })).toBe(describeScope(visibleTo, { a: 'Bakery' }))
      }
    })
  })

  describe('isSiteOnlyScope', () => {
    it('answers true only for a site-only document with no marker', () => {
      expect(isSiteOnlyScope({ visibleTo: ['host:a'] }, 'a')).toBe(true)
      expect(isSiteOnlyScope({ visibleTo: ['host:a', 'host:a'] }, 'a')).toBe(true)
      expect(isSiteOnlyScope({ visibleTo: ['host:a', 'host:b'] }, 'a')).toBe(false)
      expect(isSiteOnlyScope({ visibleTo: ['org'] }, 'a')).toBe(false)
      expect(isSiteOnlyScope({ visibleTo: [] }, 'a')).toBe(false)
      expect(isSiteOnlyScope({}, 'a')).toBe(false)
      expect(isSiteOnlyScope(null, 'a')).toBe(false)
    })

    /** Deleting the last included site must never erase the workspace's data. */
    it('is false for a marked document whose list names only this site', () => {
      expect(isSiteOnlyScope(marked(['host:a'], ['host:b']), 'a')).toBe(false)
      expect(isSiteOnlyScope({ visibleTo: ['host:a'], scopeMode: 'other' }, 'a')).toBe(false)
    })
  })

  describe('sharingCovers', () => {
    it('answers as scopeCovers when neither side is marked', () => {
      const scopes = [['org'], ['host:a'], ['host:a', 'host:b'], [], undefined]
      for (const target of scopes) {
        for (const source of scopes) {
          expect(sharingCovers({ visibleTo: target }, { visibleTo: source })).toBe(scopeCovers(target, source))
        }
      }
    })

    it('a chosen-sites target never covers an all-except source: the next site breaks it', () => {
      expect(sharingCovers({ visibleTo: ['host:a', 'host:b'] }, marked(['host:a', 'host:b'], ['host:c']))).toBe(false)
    })

    it('All sites covers an all-except source', () => {
      expect(sharingCovers({ visibleTo: ['org'] }, marked(['host:b'], ['host:a']))).toBe(true)
    })

    it('an all-except target covers chosen sites it includes, and not All sites', () => {
      const target = marked(['host:b', 'host:c'], ['host:a'])
      expect(sharingCovers(target, { visibleTo: ['host:b'] })).toBe(true)
      expect(sharingCovers(target, { visibleTo: ['host:a'] })).toBe(false)
      expect(sharingCovers(target, { visibleTo: ['org'] })).toBe(false)
    })

    it('between two all-except documents, the target may leave out only what the source does', () => {
      const leavesOutA = marked(['host:b', 'host:c'], ['host:a'])
      const leavesOutAB = marked(['host:c'], ['host:a', 'host:b'])
      const leavesOutB = marked(['host:a', 'host:c'], ['host:b'])
      expect(sharingCovers(leavesOutA, leavesOutAB)).toBe(true)
      expect(sharingCovers(leavesOutAB, leavesOutA)).toBe(false)
      expect(sharingCovers(leavesOutA, leavesOutB)).toBe(false)
      expect(sharingCovers(leavesOutA, marked(['host:b', 'host:c'], ['host:a']))).toBe(true)
    })
  })
})
