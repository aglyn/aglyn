/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, this runs on jsdom, and `Request` is not a constructor
 * there.
 *
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

import { readCookie } from '../app/api/auth/read-cookie'
import {
  ACTIVITY_COOKIE,
  isSessionIdle,
  parseActivity,
} from '../app/api/auth/activity/session-activity'

const withCookie = (cookie: string) =>
  new Request('https://app.aglyn.com/api/auth/activity', {
    headers: { cookie },
  })

describe('readCookie: an empty duplicate never shadows a real value', () => {
  it('prefers the non-empty value when the empty one sorts FIRST', () => {
    expect(readCookie(withCookie('__session=; __session=real'), '__session')).toBe(
      'real',
    )
  })

  it('prefers the non-empty value when the empty one sorts LAST', () => {
    expect(readCookie(withCookie('__session=real; __session='), '__session')).toBe(
      'real',
    )
  })

  it('still reads empty when the jar holds ONLY empties', () => {
    // Not `undefined`: the caller distinguishes "no cookie at all" from "a
    // cookie carrying nothing", and only the former should mint.
    expect(readCookie(withCookie('__session=; __session='), '__session')).toBe('')
  })

  it('returns undefined when the name is absent, and when there is no header', () => {
    expect(readCookie(withCookie('other=1'), '__session')).toBeUndefined()
    expect(
      readCookie(new Request('https://app.aglyn.com/x'), '__session'),
    ).toBeUndefined()
  })

  it('does not match a name that merely ends with the one asked for', () => {
    const request = withCookie('__session_tenant=t; __session=s')
    expect(readCookie(request, '__session')).toBe('s')
    expect(readCookie(request, '__session_tenant')).toBe('t')
  })

  it('decodes a percent-encoded value', () => {
    expect(readCookie(withCookie('__session=a%20b'), '__session')).toBe('a b')
  })
})

describe('the activity cookie has the same exposure the session cookie had', () => {
  /**
   * `activityCookie` attaches `Domain=.aglyn.com` only when the request host
   * is on the workspace domain, so the same jar can end up holding a
   * host-scoped and a domain-scoped `aglyn_session_activity`. Reading the
   * first match meant an empty duplicate produced `at: 0` — and `isSessionIdle`
   * treats 0 as "no evidence, stay signed in", so the AGL-697 idle-logout
   * control silently stopped firing rather than failing loudly.
   */
  const idleFor = (cookie: string) => {
    const at = parseActivity(readCookie(withCookie(cookie), ACTIVITY_COOKIE))
    // Last seen at t=1h, "now" is t=2h, against a 30-minute idle window: an
    // hour of inactivity, comfortably past the threshold rather than exactly
    // on it (`isSessionIdle` compares with `>`).
    return isSessionIdle(at, 7_200_000, 1_800_000)
  }

  it('a shadowing empty duplicate no longer disables idle expiry', () => {
    expect(idleFor(`${ACTIVITY_COOKIE}=; ${ACTIVITY_COOKIE}=3600000`)).toBe(true)
  })

  it('agrees with the single-cookie case', () => {
    expect(idleFor(`${ACTIVITY_COOKIE}=3600000`)).toBe(true)
  })

  it('a RECENT heartbeat behind an empty duplicate is not idle', () => {
    // The paired negative: the case above must pass because the real value is
    // read, not because the helper reports idle for everything.
    expect(idleFor(`${ACTIVITY_COOKIE}=; ${ACTIVITY_COOKIE}=7000000`)).toBe(false)
  })

  it('a genuinely absent record still fails OPEN, as designed', () => {
    expect(idleFor('other=1')).toBe(false)
  })
})
