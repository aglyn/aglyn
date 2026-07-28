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

import { mediaCdnAllows, parseMediaCdnScope } from './serve-media-cdn'

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

  it('treats a MISSING scope as org-wide, for pre-backfill docs', () => {
    expect(mediaCdnAllows(orgWide, undefined)).toBe(true)
    expect(mediaCdnAllows(forSiteA, undefined)).toBe(true)
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
