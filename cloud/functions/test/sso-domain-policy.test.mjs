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

// The account-creation half of the workspace-domain SSO rule, against the
// compiled module the blocking function runs.

import test from 'node:test'
import assert from 'node:assert/strict'
import { ssoDomainCreationRefused } from '../lib/sso-domain-policy.js'

const ON = {
  AGLYN_SSO_REQUIRED_DOMAINS: 'example.com=example-tenant',
  AGLYN_SSO_EXEMPT_EMAILS: 'Reviewer@Example.com',
  AGLYN_SSO_DOMAIN_ENFORCEMENT: 'on',
}

test('a governed address outside any tenant is refused', () => {
  assert.equal(ssoDomainCreationRefused({ email: 'person@example.com', tenantId: null }, ON), true)
  assert.equal(ssoDomainCreationRefused({ email: 'Person@EXAMPLE.com' }, ON), true)
})

test('the same address created through its SSO tenant is admitted', () => {
  assert.equal(ssoDomainCreationRefused({ email: 'person@example.com', tenantId: 'example-tenant' }, ON), false)
})

test('an address named in the exemptions is admitted, case-insensitively', () => {
  assert.equal(ssoDomainCreationRefused({ email: 'reviewer@example.com', tenantId: null }, ON), false)
})

test('an ungoverned address is admitted, including a look-alike domain', () => {
  assert.equal(ssoDomainCreationRefused({ email: 'person@gmail.com', tenantId: null }, ON), false)
  assert.equal(ssoDomainCreationRefused({ email: 'person@notexample.com', tenantId: null }, ON), false)
  assert.equal(ssoDomainCreationRefused({ email: undefined, tenantId: null }, ON), false)
})

test('nothing is refused unless the switch is exactly on', () => {
  for (const value of [undefined, '', 'true', 'ON', '1']) {
    const env = { ...ON, AGLYN_SSO_DOMAIN_ENFORCEMENT: value }
    assert.equal(ssoDomainCreationRefused({ email: 'person@example.com', tenantId: null }, env), false)
  }
  assert.equal(
    ssoDomainCreationRefused({ email: 'person@example.com', tenantId: null }, { AGLYN_SSO_DOMAIN_ENFORCEMENT: 'on' }),
    false,
  )
})

test('a plus-tag entry admits the stamped canary and nothing wider', () => {
  const env = { ...ON, AGLYN_SSO_EXEMPT_EMAILS: 'ops+signup-canary*@example.com, *@example.com' }
  assert.equal(ssoDomainCreationRefused({ email: 'ops+signup-canary-1729123456@example.com', tenantId: null }, env), false)
  assert.equal(ssoDomainCreationRefused({ email: 'ops@example.com', tenantId: null }, env), true)
  assert.equal(ssoDomainCreationRefused({ email: 'person@example.com', tenantId: null }, env), true)
})
