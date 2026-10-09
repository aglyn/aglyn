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

// The SSO Auth-record identity backfill's decisions (AGL-3721).
//
//   node --test tools/scripts/lib/sso-auth-identity-backfill.test.mjs

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isSsoUserRecord, planAuthIdentityFill } from './sso-auth-identity-backfill.mjs'

const blankSso = {
  displayName: null,
  photoURL: undefined,
  providerData: [{ providerId: 'saml.aglyn-workspace', displayName: null, photoURL: null }],
}

describe('which accounts are SSO', () => {
  it('is every tenant-pool account, and a project account with a saml./oidc. provider', () => {
    assert.equal(isSsoUserRecord({ providerData: [] }, 'aglyn-org-y5v14'), true)
    assert.equal(isSsoUserRecord(blankSso, null), true)
    assert.equal(isSsoUserRecord({ providerData: [{ providerId: 'oidc.okta' }] }, null), true)
    assert.equal(isSsoUserRecord({ providerData: [{ providerId: 'google.com' }] }, null), false)
  })
})

describe('the plan for one record', () => {
  it('fills a blank SSO record from its profile first', () => {
    const plan = planAuthIdentityFill({
      record: blankSso,
      profile: { firstName: 'Zach', lastName: 'Gover', photoUrl: 'https://cdn.example/z.png' },
      rosterRows: [{ displayName: 'Roster Name', photoURL: 'https://roster.example/r.png' }],
    })
    assert.deepEqual(plan, {
      fill: { displayName: 'Zach Gover', photoURL: 'https://cdn.example/z.png' },
      sources: { displayName: 'profile', photoURL: 'profile' },
    })
  })

  it('falls back to the roster row the IdP filled at sign-in', () => {
    const plan = planAuthIdentityFill({
      record: blankSso,
      profile: null,
      rosterRows: [{ displayName: 'Roster Name', photoURL: 'https://roster.example/r.png' }],
    })
    assert.deepEqual(plan?.sources, { displayName: 'roster', photoURL: 'roster' })
  })

  it('NEVER overwrites a field the record holds', () => {
    const plan = planAuthIdentityFill({
      record: { ...blankSso, displayName: 'Chosen', photoURL: 'https://mine.example/me.png' },
      profile: { firstName: 'Zach', photoUrl: 'https://cdn.example/z.png' },
    })
    assert.equal(plan, null)
    const half = planAuthIdentityFill({
      record: { ...blankSso, displayName: 'Chosen' },
      profile: { firstName: 'Zach', photoUrl: 'https://cdn.example/z.png' },
    })
    assert.deepEqual(half?.fill, { photoURL: 'https://cdn.example/z.png' })
  })

  it('does not put back a removed avatar, nor write a non-https one', () => {
    const erased = planAuthIdentityFill({
      record: blankSso,
      profile: { photoUrl: 'https://cdn.example/z.png', photoUrlErasedAt: 1 },
      rosterRows: [{ photoURL: 'https://roster.example/r.png' }],
    })
    assert.equal(erased, null)
    const path = planAuthIdentityFill({ record: blankSso, profile: { photoUrl: '/media/z.png' } })
    assert.equal(path, null)
  })

  it('plans nothing when no source holds anything', () => {
    assert.equal(planAuthIdentityFill({ record: blankSso }), null)
  })
})
