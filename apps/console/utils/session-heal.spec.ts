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
 * The console half of "re-subscribe on session heal" (AGL-1066).
 *
 * The listener half — three hooks reopening a refused listen, and ignoring
 * the broadcast when they are healthy — is proven next to the hooks in
 * `libs/tenant/feature/instance/src/lib/hooks/listener-heal-resubscribe.spec.ts`.
 *
 * What is proven here is WHICH events count as a heal, which is the half that
 * can go wrong quietly. Broadcast too narrowly and a user who
 * re-authenticates successfully watches an errored console until they reload;
 * broadcast on any token event and every listener in the app reopens on
 * Firebase's hourly refresh. The real heal channel is used, not a mock — a
 * watcher that broadcasts into a double proves nothing about the wiring.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { subscribeFirestoreSessionHeal } from '@aglyn/tenant-feature-instance'
import { watchSessionHeal } from './session-heal'
import {
  __resetSessionReauth,
  clearSessionReauth,
  dismissSessionReauth,
  reopenSessionReauth,
  requestSessionReauth,
} from './session-reauth'

describe('watchSessionHeal (AGL-1066)', () => {
  let heals: number
  let stopWatching: (() => void) | undefined
  let stopCounting: (() => void) | undefined

  beforeEach(() => {
    heals = 0
    __resetSessionReauth()
    stopCounting = subscribeFirestoreSessionHeal(() => (heals += 1))
  })

  afterEach(() => {
    stopWatching?.()
    stopCounting?.()
    __resetSessionReauth()
  })

  /** The AGL-664 dialog's success path, which is the heal that matters. */
  it('broadcasts when a pending re-auth is resolved', () => {
    stopWatching = watchSessionHeal()

    requestSessionReauth('stale')
    expect(heals).toBe(0)

    clearSessionReauth()
    expect(heals).toBe(1)
  })

  /**
   * "Not now" leaves the degraded state standing and the session still dead.
   * Reopening the dialog is not a recovery either — nothing has been proven
   * about the session at that point.
   */
  it('does not broadcast on a dismissal or a re-open', () => {
    stopWatching = watchSessionHeal()

    requestSessionReauth('stale')
    dismissSessionReauth()
    reopenSessionReauth()
    dismissSessionReauth()

    expect(heals).toBe(0)
  })

  /**
   * The structural gate that makes a token event impossible to mistake for a
   * heal: with no fault pending there is no falling edge to detect, and
   * `clearSessionReauth` is a no-op. Firebase's hourly ID-token refresh never
   * touches this store, so it cannot reach the listeners through here.
   */
  it('does not broadcast when no fault was pending', () => {
    stopWatching = watchSessionHeal()

    clearSessionReauth()
    clearSessionReauth()

    expect(heals).toBe(0)
  })

  /**
   * A watcher registered while a fault is already pending gets the current
   * state replayed to it immediately. That replay is a fault, not a
   * recovery — and the recovery that follows still has to be broadcast.
   */
  it('does not read its own replay as a heal, and still catches the real one', () => {
    requestSessionReauth('revoked')
    stopWatching = watchSessionHeal()
    expect(heals).toBe(0)

    clearSessionReauth()
    expect(heals).toBe(1)
  })

  /** One heal per fault, however many times the resolution is called. */
  it('broadcasts once per fault, not once per call', () => {
    stopWatching = watchSessionHeal()

    requestSessionReauth('idle')
    clearSessionReauth()
    clearSessionReauth()
    clearSessionReauth()

    expect(heals).toBe(1)
  })

  /** A second fault later in the same session heals too. */
  it('re-arms for the next fault', () => {
    stopWatching = watchSessionHeal()

    requestSessionReauth('stale')
    clearSessionReauth()
    requestSessionReauth('stale')
    clearSessionReauth()

    expect(heals).toBe(2)
  })
})

/**
 * The wiring, asserted at the declaration.
 *
 * `watchSessionHeal` behaving correctly and never being called is the exact
 * failure AGL-1356 was filed for, and this seam has no other entry point:
 * drop the call and every hook keeps compiling, keeps passing its own tests,
 * and silently never hears about a heal again. Source-level, deliberately —
 * importing the layout would drag in the whole client Firebase stack to prove
 * something about a call graph.
 */
describe('the console registers the heal watcher (AGL-1066)', () => {
  const source = readFileSync(
    join(__dirname, '..', 'components', 'layouts', 'firebase-app.layout.tsx'),
    'utf8',
  )

  it('calls watchSessionHeal', () => {
    expect(source).toEqual(expect.stringContaining('watchSessionHeal()'))
  })

  it('registers at module scope, not inside a component or effect', () => {
    // The page tree does NOT remount across an AGL-664 re-auth — that is the
    // whole reason this exists — so a component-scoped watcher would be
    // mounted inside the thing whose survival is the problem.
    const registerAt = source.indexOf('watchSessionHeal()')
    const firstComponentAt = source.indexOf('function ')
    expect(registerAt).toBeGreaterThan(-1)
    expect(registerAt).toBeLessThan(firstComponentAt)
  })
})
