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

import type { UserRecord } from 'firebase-admin/auth'
import { planAccount } from './sso-enforcement'

/**
 * AGL-1129. `planAccount` is the whole decision — the sweep around it only
 * carries it out — so the failure modes worth pinning are the ones that
 * cannot be undone: orphaning an account, or leaving a bypass in place.
 *
 * The tenant this ships against has exactly one account with exactly one
 * provider, so a live run proves nothing about any of these.
 */
const user = (uid: string, providers: string[]): UserRecord =>
  ({
    uid,
    email: `${uid}@aglyn.com`,
    providerData: providers.map((providerId) => ({ providerId })),
  }) as UserRecord

const SAML = 'saml.aglyn-workspace'

describe('planAccount', () => {
  it('removes a social provider and keeps the org IdP', () => {
    const plan = planAccount(user('u1', [SAML, 'google.com']), SAML)
    expect(plan).toMatchObject({ unlinked: ['google.com'], kept: [SAML] })
    expect(plan.skipped).toBeUndefined()
  })

  it('removes a password credential too', () => {
    // A standing email/password credential on a governed account is exactly
    // the bypass enforcement is bought to close — it is not the org's IdP.
    expect(planAccount(user('u2', [SAML, 'password']), SAML).unlinked).toEqual([
      'password',
    ])
  })

  it('NEVER unlinks an account down to zero providers', () => {
    // The unrecoverable one. An account whose only provider is removable is
    // misconfigured, not a bypass to close: stripping it leaves an account
    // nobody — not even the IdP — can reach.
    const plan = planAccount(user('u3', ['google.com']), SAML)
    expect(plan.unlinked).toEqual([])
    expect(plan.skipped).toBe('would-orphan')
    expect(plan.kept).toEqual(['google.com'])
  })

  it('reports an account that is already clean as no change', () => {
    // Idempotence: the second run of a sweep must be a no-op, or it fires a
    // second round of token revocations at people who are already compliant.
    const plan = planAccount(user('u4', [SAML]), SAML)
    expect(plan.unlinked).toEqual([])
    expect(plan.skipped).toBeUndefined()
  })

  it('strips every non-IdP provider, not just the first', () => {
    expect(
      planAccount(user('u5', ['google.com', SAML, 'password']), SAML).unlinked,
    ).toEqual(['google.com', 'password'])
  })

  it('leaves an account with no providers at all alone', () => {
    const plan = planAccount(user('u6', []), SAML)
    expect(plan.unlinked).toEqual([])
    expect(plan.skipped).toBeUndefined()
  })

  it('keys off the org’s OWN provider id, not the saml. prefix', () => {
    // Two SAML providers can exist in one tenant. Only the org's configured
    // one is the sanctioned way in; treating any `saml.*` as sanctioned
    // would leave a second IdP as a bypass.
    const plan = planAccount(user('u7', [SAML, 'saml.other-idp']), SAML)
    expect(plan.unlinked).toEqual(['saml.other-idp'])
    expect(plan.kept).toEqual([SAML])
  })
})
