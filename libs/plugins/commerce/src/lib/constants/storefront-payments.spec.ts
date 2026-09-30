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
 *
 * @jest-environment node
 */

import { storefrontPaymentsNotConfiguredText } from './storefront-payments'

describe('the STOREFRONT sentence is safe to show a stranger', () => {
  const text = storefrontPaymentsNotConfiguredText()

  it('says it about the store, in the present tense', () => {
    expect(text).toMatch(/store/i)
    expect(text).toMatch(/not set up to take payments/i)
  })

  it('leaks no variable name, no platform name and no deployment detail', () => {
    // The operator's deployment shape is not a shopper's business, and this
    // string is rendered on the public internet.
    for (const leak of [
      /STRIPE/i,
      /SECRET/i,
      /\benv\b/i,
      /deployment/i,
      /self-host/i,
      /Aglyn/i,
    ]) {
      expect(text).not.toMatch(leak)
    }
  })

  it('does not imply a transient outage that invites a retry', () => {
    // "right now" / "temporarily" would say wait and try again; nothing about
    // this resolves without the operator acting.
    expect(text).not.toMatch(/right now|temporarily|try again|later/i)
  })
})
