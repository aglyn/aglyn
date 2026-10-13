/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
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

jest.mock('@aglyn/shared-util-email', () => ({}))
jest.mock('@aglyn/tenant-data-admin/server/operator-alerts', () => ({
  raiseOperatorAlert: jest.fn(),
}))

import { sendsFromDomain } from './email-health'

describe('the platform sender domain check', () => {
  it('accepts the operator domain itself', () => {
    expect(sendsFromDomain('aglyn.com', 'aglyn.com')).toBe(true)
  })

  it('accepts a sending subdomain of it — the notify.aglyn.com stream', () => {
    expect(sendsFromDomain('notify.aglyn.com', 'aglyn.com')).toBe(true)
    expect(sendsFromDomain('Notify.Aglyn.com', 'aglyn.com')).toBe(true)
  })

  it('refuses a different domain, including one that only ends the same', () => {
    expect(sendsFromDomain('example.com', 'aglyn.com')).toBe(false)
    expect(sendsFromDomain('notaglyn.com', 'aglyn.com')).toBe(false)
    expect(sendsFromDomain('aglyn.com.evil.io', 'aglyn.com')).toBe(false)
  })
})
