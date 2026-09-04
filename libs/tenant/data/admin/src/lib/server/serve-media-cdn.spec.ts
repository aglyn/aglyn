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
  mediaCdnAllows,
  mediaCdnScopeRefusal,
  MEDIA_CDN_STABLE_CACHE_CONTROL,
  parseMediaCdnScope,
} from './serve-media-cdn'

describe('parseMediaCdnScope (AGL-1043)', () => {
  it('reads a host library segment', () => {
    expect(parseMediaCdnScope('site-a')).toEqual({
      isOrg: false,
      scopeId: 'site-a',
    })
  })

  it('reads the org-wide segment', () => {
    expect(parseMediaCdnScope('org:acme')).toEqual({
      isOrg: true,
      scopeId: 'acme',
    })
  })

  it('reads the host-qualified org segment', () => {
    expect(parseMediaCdnScope('org:acme:site-a')).toEqual({
      isOrg: true,
      scopeId: 'acme',
      contextHostId: 'site-a',
    })
  })

  it('rejects malformed segments rather than guessing', () => {
    expect(parseMediaCdnScope('org:acme:site-a:extra')).toBeNull()
    expect(parseMediaCdnScope('org:')).toBeNull()
    expect(parseMediaCdnScope('org:acme:')).toBeNull()
    expect(parseMediaCdnScope('has spaces')).toBeNull()
    expect(parseMediaCdnScope('../../etc')).toBeNull()
  })
})

describe('mediaCdnAllows (AGL-1043)', () => {
  const orgWide = parseMediaCdnScope('org:acme') as NonNullable<
    ReturnType<typeof parseMediaCdnScope>
  >
  const forSiteA = parseMediaCdnScope('org:acme:site-a') as NonNullable<
    ReturnType<typeof parseMediaCdnScope>
  >

  it('serves an org-wide asset on the bare org URL', () => {
    expect(mediaCdnAllows(orgWide, ['org'])).toBe(true)
  })

  it('REFUSES a restricted asset on the bare org URL', () => {
    // The leak this closes: a bearer link to an internal asset.
    expect(mediaCdnAllows(orgWide, ['host:site-b'])).toBe(false)
  })

  it('serves a restricted asset only to a host it is scoped to', () => {
    expect(mediaCdnAllows(forSiteA, ['host:site-a'])).toBe(true)
    expect(mediaCdnAllows(forSiteA, ['host:site-b'])).toBe(false)
  })

  it('serves an org-wide asset through a host-qualified URL too', () => {
    // Org-wide implies every host, so the qualified form must not be
    // stricter than the bare one — otherwise re-widening an asset would
    // break the URLs minted while it was restricted.
    expect(mediaCdnAllows(forSiteA, ['org'])).toBe(true)
  })

  /**
   * An UNSCOPED asset is served to nobody, matching what both enforcement
   * layers already do with a document carrying no `visibleTo`. The CDN is
   * unauthenticated and the URL is the only thing it can decide from, so this
   * is the surface where the permissive reading was worth the least and cost
   * the most.
   */
  it('refuses a MISSING scope rather than serving it to everyone', () => {
    expect(mediaCdnAllows(orgWide, undefined)).toBe(false)
    expect(mediaCdnAllows(forSiteA, undefined)).toBe(false)
    // The control: a stamped asset is still served, so this is the absent
    // field being refused and not the whole CDN.
    expect(mediaCdnAllows(orgWide, ['org'])).toBe(true)
  })

  it('fails closed on an empty scope', () => {
    // `[]` is a written value meaning "nobody" (AGL-1037), unlike absent.
    expect(mediaCdnAllows(orgWide, [])).toBe(false)
    expect(mediaCdnAllows(forSiteA, [])).toBe(false)
  })

  it('never gates a host library asset', () => {
    const hostScope = parseMediaCdnScope('site-a') as NonNullable<
      ReturnType<typeof parseMediaCdnScope>
    >
    expect(mediaCdnAllows(hostScope, undefined)).toBe(true)
    expect(mediaCdnAllows(hostScope, [])).toBe(true)
  })
})

/**
 * The three refusals behind the one 404.
 *
 * The wire cannot tell them apart and must not: whether a restricted asset
 * exists is not an anonymous caller's business. Whoever is holding the
 * broken page has the opposite problem — "this URL names the wrong site" and
 * "this document names no site at all" are the same blank image, and the
 * second one is broken on every URL there is. Separating them is what lets
 * the route say the difference in its logs.
 */
describe('mediaCdnScopeRefusal', () => {
  const orgWide = parseMediaCdnScope('org:acme') as NonNullable<
    ReturnType<typeof parseMediaCdnScope>
  >
  const forSiteA = parseMediaCdnScope('org:acme:site-a') as NonNullable<
    ReturnType<typeof parseMediaCdnScope>
  >

  it('calls a wrong-URL refusal restricted', () => {
    // Somebody chose sites, and this is not one of them. The asset still
    // serves from the site it IS shared with, so the URL is the fault.
    expect(mediaCdnScopeRefusal(orgWide, ['host:site-b'])).toBe('restricted')
    expect(mediaCdnScopeRefusal(forSiteA, ['host:site-b'])).toBe('restricted')
  })

  it('calls a document with no scope unscoped', () => {
    // Nobody ever chose. Undeliverable under EVERY URL form, which is the
    // difference that matters: a creation path skipped the field, and the
    // scope backfill is what repairs it.
    expect(mediaCdnScopeRefusal(orgWide, undefined)).toBe('unscoped')
    expect(mediaCdnScopeRefusal(forSiteA, undefined)).toBe('unscoped')
    expect(mediaCdnScopeRefusal(orgWide, null)).toBe('unscoped')
  })

  it('distinguishes a stored empty scope from an absent one', () => {
    // Both are refused; only one of them the backfill will repair. It leaves
    // `[]` alone rather than widening a resource nobody asked to widen, so
    // an asset in this state needs a person and never appears in the drift
    // report — which is exactly why the route has to name it.
    expect(mediaCdnScopeRefusal(orgWide, [])).toBe('no-sites')
    expect(mediaCdnScopeRefusal(forSiteA, [])).toBe('no-sites')
  })

  it('refuses nothing that is allowed', () => {
    expect(mediaCdnScopeRefusal(orgWide, ['org'])).toBeNull()
    expect(mediaCdnScopeRefusal(forSiteA, ['org'])).toBeNull()
    expect(mediaCdnScopeRefusal(forSiteA, ['host:site-a'])).toBeNull()
    const hostScope = parseMediaCdnScope('site-a') as NonNullable<
      ReturnType<typeof parseMediaCdnScope>
    >
    expect(mediaCdnScopeRefusal(hostScope, undefined)).toBeNull()
  })

  it('is the only thing mediaCdnAllows answers from', () => {
    // The delivery decision and the diagnosis have to be one function, or a
    // later edit can make the log say one thing while the gate does another.
    const scopes = [
      orgWide,
      forSiteA,
      parseMediaCdnScope('site-a') as NonNullable<
        ReturnType<typeof parseMediaCdnScope>
      >,
    ]
    const values: unknown[] = [
      undefined,
      null,
      [],
      ['org'],
      ['host:site-a'],
      ['host:site-b'],
      ['org', 'host:site-b'],
      'not-an-array',
    ]
    for (const scope of scopes) {
      for (const visibleTo of values) {
        expect(mediaCdnAllows(scope, visibleTo)).toBe(
          mediaCdnScopeRefusal(scope, visibleTo) === null,
        )
      }
    }
  })
})

describe('MEDIA_CDN_STABLE_CACHE_CONTROL — the stable URL must stay bustable', () => {
  it('caches at the EDGE for an hour, via s-maxage', () => {
    // Measured on production 2026-08-12: Vercel's edge caches this route on
    // a bare `max-age` too, so this is not about whether it caches — it is
    // about which cache holds the hour.
    expect(MEDIA_CDN_STABLE_CACHE_CONTROL).toContain('s-maxage=3600')
  })

  it('does NOT pin a replaced asset in the browser for an hour', () => {
    // The regression this exists to prevent. A browser `max-age=3600` means
    // no conditional request for an hour, so the ETag two functions down
    // never gets asked and a replaced asset stays wrong in every open tab —
    // the exact failure the stable URL was introduced to avoid (AGL-829).
    const browserMaxAge = /(?:^|[\s,])max-age=(\d+)/.exec(
      MEDIA_CDN_STABLE_CACHE_CONTROL,
    )
    expect(browserMaxAge).not.toBeNull()
    expect(Number(browserMaxAge?.[1])).toBeLessThanOrEqual(60)
  })

  it('carries stale-while-revalidate WITH delta-seconds', () => {
    // RFC 5861 requires the delta; without it a CDN may serve stale forever.
    expect(MEDIA_CDN_STABLE_CACHE_CONTROL).toMatch(
      /stale-while-revalidate=\d+/,
    )
  })

  it('stays publicly cacheable — this is the platform-wide image path', () => {
    expect(MEDIA_CDN_STABLE_CACHE_CONTROL.startsWith('public')).toBe(true)
  })
})
