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
 * The store is the single channel between "the console's auth machinery
 * decided the session is lost" and the AGL-664 dialog. What is worth
 * pinning: the reason semantics (`stale` keeps its local user, everything
 * else requires a full sign-in), first-evidence-wins, and that dismissal
 * degrades rather than clears.
 */

import {
  __resetSessionReauth,
  captureReauthIdentity,
  clearSessionReauth,
  dismissSessionReauth,
  getSessionReauth,
  reopenSessionReauth,
  requestSessionReauth,
  subscribeSessionReauth,
} from './session-reauth'

describe('session-reauth store (AGL-664)', () => {
  beforeEach(() => __resetSessionReauth())
  afterEach(() => __resetSessionReauth())

  it('starts with no prompt', () => {
    expect(getSessionReauth().reason).toBeNull()
  })

  it('a request raises the prompt and publishes to subscribers', () => {
    const seen: unknown[] = []
    const unsubscribe = subscribeSessionReauth((state) =>
      seen.push(state.reason),
    )
    requestSessionReauth('revoked')
    expect(getSessionReauth().reason).toBe('revoked')
    expect(getSessionReauth().requiresSignIn).toBe(true)
    expect(seen).toEqual([null, 'revoked'])
    unsubscribe()
  })

  it('the stale heuristic does not claim the user was signed out', () => {
    requestSessionReauth('stale')
    expect(getSessionReauth().requiresSignIn).toBe(false)
  })

  it('first evidence wins; a later request never rewrites the reason', () => {
    requestSessionReauth('idle', {
      email: 'a@b.c',
      hasPassword: true,
      providerId: null,
    })
    requestSessionReauth('stale')
    const state = getSessionReauth()
    expect(state.reason).toBe('idle')
    expect(state.identity.email).toBe('a@b.c')
  })

  it('dismissal degrades instead of clearing, and a repeat request re-opens', () => {
    requestSessionReauth('idle')
    dismissSessionReauth()
    expect(getSessionReauth().reason).toBe('idle')
    expect(getSessionReauth().dismissed).toBe(true)
    // A user-initiated repeat (the banner click, a fresh loss event) must
    // bring the dialog back rather than be swallowed by the dismissal.
    requestSessionReauth('idle')
    expect(getSessionReauth().dismissed).toBe(false)
  })

  it('reopen brings back a dismissed prompt', () => {
    requestSessionReauth('signed-out')
    dismissSessionReauth()
    reopenSessionReauth()
    expect(getSessionReauth().dismissed).toBe(false)
  })

  it('clearing stands the whole thing down', () => {
    requestSessionReauth('revoked')
    clearSessionReauth()
    expect(getSessionReauth().reason).toBeNull()
  })
})

describe('captureReauthIdentity', () => {
  it('reads password + federated factors off providerData', () => {
    const identity = captureReauthIdentity({
      email: 'user@example.com',
      providerData: [
        { providerId: 'password', email: 'user@example.com' },
        { providerId: 'google.com', email: 'user@example.com' },
      ],
    })
    expect(identity).toEqual({
      email: 'user@example.com',
      hasPassword: true,
      providerId: 'google.com',
    })
  })

  it('falls back to a provider email and survives nothing at all', () => {
    expect(
      captureReauthIdentity({
        providerData: [{ providerId: 'saml.acme', email: 'sso@acme.com' }],
      }),
    ).toEqual({
      email: 'sso@acme.com',
      hasPassword: false,
      providerId: 'saml.acme',
    })
    expect(captureReauthIdentity(null)).toEqual({
      email: null,
      hasPassword: false,
      providerId: null,
    })
  })
})
