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
 * The re-auth verdict (AGL-1063).
 *
 * Both directions matter, but not equally: a MISSED prompt leaves the
 * console degrading quietly, which is where we already were. A FALSE prompt
 * tells someone mid-edit that their session is dead when it is not — so the
 * scoped-collaborator cases below are the ones that must never regress.
 */

import {
  __resetSessionHealth,
  getSessionHealth,
  reportDeniedRead,
  reportSuccessfulRead,
  SESSION_STALE_WINDOW_MS,
  subscribeSessionHealth,
} from './session-health'

describe('session health', () => {
  let clock = 0
  beforeEach(() => {
    clock = 1_000_000
    __resetSessionHealth(() => clock)
  })
  afterEach(() => __resetSessionHealth())

  it('says nothing on a healthy session', () => {
    expect(getSessionHealth()).toEqual({
      staleSession: false,
      deniedCollections: [],
      serverReads: 0,
    })
  })

  it('does NOT prompt for one denied collection', () => {
    // The AGL-1041 case: a scoped collaborator reading something they may
    // not see gets this denial forever, by design.
    reportDeniedRead('orgs/datasets')
    reportDeniedRead('orgs/datasets')
    reportDeniedRead('orgs/datasets')
    expect(getSessionHealth().staleSession).toBe(false)
  })

  it('does NOT prompt when every report is unlabelled', () => {
    // A caller that forgets to name its collection can only ever fail to
    // raise the prompt — the whole point of the shared bucket.
    reportDeniedRead()
    reportDeniedRead()
    expect(getSessionHealth().staleSession).toBe(false)
  })

  it('prompts once two distinct collections are denied', () => {
    reportDeniedRead('orgs/media')
    expect(getSessionHealth().staleSession).toBe(false)
    reportDeniedRead('orgs/members')
    expect(getSessionHealth()).toEqual({
      staleSession: true,
      deniedCollections: ['orgs/media', 'orgs/members'],
      serverReads: 0,
    })
  })

  it('forgets a denial older than the window', () => {
    reportDeniedRead('orgs/media')
    clock += SESSION_STALE_WINDOW_MS + 1
    reportDeniedRead('orgs/members')
    // Two collections, but an hour apart is two unrelated answers, not a
    // session that stopped working.
    expect(getSessionHealth().staleSession).toBe(false)
  })

  it('clears everything on a successful server read', () => {
    reportDeniedRead('orgs/media')
    reportDeniedRead('orgs/members')
    expect(getSessionHealth().staleSession).toBe(true)
    reportSuccessfulRead()
    expect(getSessionHealth()).toEqual({
      staleSession: false,
      deniedCollections: [],
      serverReads: 1,
    })
  })

  it('notifies subscribers on arrival and on change', () => {
    const seen: boolean[] = []
    const unsubscribe = subscribeSessionHealth((state) =>
      seen.push(state.staleSession),
    )
    reportDeniedRead('orgs/media')
    reportDeniedRead('orgs/members')
    reportSuccessfulRead()
    unsubscribe()
    reportDeniedRead('orgs/media')
    reportDeniedRead('hostIndex')
    expect(seen).toEqual([false, false, true, false])
  })

  it('reports a no-op success without waking subscribers', () => {
    const seen: number[] = []
    const unsubscribe = subscribeSessionHealth(() => seen.push(1))
    reportSuccessfulRead()
    reportSuccessfulRead()
    unsubscribe()
    expect(seen).toHaveLength(1) // the initial call only
  })

  /**
   * The episode counter (AGL-2486). The automatic re-auth prompt latches on
   * this, so what matters is that it moves for EVERY read that reached the
   * server — including the ones with no evidence left to clear. A counter
   * that skipped those would leave the latch armed across a recovery the
   * user actually had, and the next genuine failure would never prompt.
   */
  it('counts a server read even when there is no evidence to clear', () => {
    expect(getSessionHealth().serverReads).toBe(0)
    reportSuccessfulRead()
    reportSuccessfulRead()
    expect(getSessionHealth().serverReads).toBe(2)

    reportDeniedRead('orgs/media')
    reportDeniedRead('orgs/members')
    // Denials do NOT move it: it dates recoveries, not failures.
    expect(getSessionHealth().serverReads).toBe(2)
    reportSuccessfulRead()
    expect(getSessionHealth().serverReads).toBe(3)
  })

  /**
   * And the case the counter exists to separate from a recovery: an idle tab
   * whose evidence simply aged out. `staleSession` goes false and comes back
   * with nothing having changed, so anything latching on the VERDICT would
   * re-fire; latching on this number does not.
   */
  it('does not move when a denial merely ages out of the window', () => {
    reportDeniedRead('orgs/media')
    reportDeniedRead('orgs/members')
    expect(getSessionHealth().staleSession).toBe(true)
    clock += SESSION_STALE_WINDOW_MS + 1
    expect(getSessionHealth().staleSession).toBe(false)
    expect(getSessionHealth().serverReads).toBe(0)
  })
})
