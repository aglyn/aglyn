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

import { reauthProvider } from './close-account-card.component'

const user = (...providerIds: string[]) =>
  ({ providerData: providerIds.map((providerId) => ({ providerId })) }) as never

/**
 * AGL-1140. Closing an account requires a fresh re-challenge, and the wrong
 * provider throws instead of prompting — so an account that CAN be closed
 * would look broken. Cheap to get wrong, invisible until an Enterprise
 * customer tries it.
 */
describe('reauthProvider', () => {
  it('re-challenges an SSO account with its own SAML provider', () => {
    // The regression this exists for: "not a password account" was treated as
    // "a Google account", which throws for every SSO user.
    expect(reauthProvider(user('saml.aglyn-workspace')).providerId).toBe(
      'saml.aglyn-workspace',
    )
  })

  it('uses the SAML provider even when another is also linked', () => {
    expect(reauthProvider(user('google.com', 'saml.acme')).providerId).toBe(
      'saml.acme',
    )
  })

  it('handles an OIDC provider', () => {
    expect(reauthProvider(user('oidc.okta')).providerId).toBe('oidc.okta')
  })

  it('falls back to Google for a plain social account', () => {
    expect(reauthProvider(user('google.com')).providerId).toBe('google.com')
    expect(reauthProvider(user()).providerId).toBe('google.com')
  })
})
