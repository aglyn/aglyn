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

import {
  GoogleAuthProvider,
  OAuthProvider,
  SAMLAuthProvider,
  type AuthProvider,
} from 'firebase/auth'

/**
 * The one place that answers "which account do we mean?" (AGL-1415).
 *
 * Every federated provider the console builds comes from here. That is the
 * whole point: the console had FIVE bare `new GoogleAuthProvider()` sites and
 * not one of them set a custom parameter, so Google was free to resolve each
 * sign-in against whatever account the device already held. On a phone, which
 * is permanently signed into exactly one account, that meant the chooser never
 * appeared and the identity was never actually chosen.
 *
 * ## Why silence is the wrong default
 *
 * With no `prompt`, Google auto-selects the single signed-in session. That is
 * a reasonable default for a consumer app with one identity per person. It is
 * the wrong default here, where a person routinely holds two — a personal
 * Google account and a work account under an SSO domain — and where landing in
 * the wrong one is not an inconvenience but a wrong-tenant session. Forcing
 * `select_account` costs one tap and removes the entire class.
 *
 * ## Not just sign-in
 *
 * The re-auth dialog, the account-close re-challenge, and "Connect Google" in
 * Manage Account all build providers too. The link flow is the sharpest case:
 * without a chooser, "Connect Google" can only ever link the account the
 * device already holds, so a second identity is unlinkable by construction.
 *
 * A guard spec asserts nothing outside this module constructs a provider —
 * an inconsistent set is exactly how this comes back.
 */

/** Always show Google's account chooser, even with one account in session. */
export const ACCOUNT_CHOOSER_PROMPT = 'select_account'

/**
 * The email we mean, when we know it (AGL-1416).
 *
 * `login_hint` is the sibling of `prompt` and fixes the same bug one layer
 * over. Google resolves an inbound SAML request against the DEFAULT signed-in
 * account (`authuser=0`) unless the request names an account. A person with a
 * personal Gmail at `authuser=0` and their work account further down the list
 * gets the SAML request resolved against the personal one, which has no SAML
 * app attached, and Google answers `app_not_configured_for_user` — an error
 * about the *session* account that reads as if the admin misconfigured SSO.
 *
 * The SSO gate already asked for the work email. Passing it as a hint makes
 * the flow independent of browser account ordering, which is otherwise a
 * silent input that shifts whenever another Google account is added.
 *
 * It is a HINT: an IdP may ignore it, so it narrows the failure but never
 * substitutes for the legible error on the other side.
 */
function accountHint(email?: string | null): Record<string, string> {
  const value = String(email ?? '').trim()
  return value ? { login_hint: value } : {}
}

/**
 * Google, with the account chooser forced on.
 *
 * `prompt` is an OAuth 2.0 authorization-request parameter, so it is carried
 * identically by the popup and redirect flows — mobile (redirect, AGL-462)
 * gets the chooser on the same terms as desktop.
 */
export function createGoogleOAuthProvider(email?: string | null): GoogleAuthProvider {
  const provider = new GoogleAuthProvider()
  // Both, deliberately: the hint preselects the right account and the prompt
  // still lets the person override it. A hint alone would silently pick for
  // them, which is the very behaviour AGL-1415 removed.
  provider.setCustomParameters({
    prompt: ACCOUNT_CHOOSER_PROMPT,
    ...accountHint(email),
  })
  return provider
}

/**
 * The provider for a known `providerId`, or Google when there is none.
 *
 * Collapses the two copies of this selection that had drifted apart in
 * `close-account-card` and `session-reauth-dialog` — the latter's comment
 * already admitted it was "the same selection logic". An SSO user's only
 * provider is `saml.<tenant-id>` and `SAMLAuthProvider` needs that exact id;
 * handing an Enterprise account a `GoogleAuthProvider` would throw.
 */
export function createAuthProvider(
  providerId?: string | null,
  email?: string | null,
): AuthProvider {
  if (providerId && providerId.startsWith('saml.')) {
    const provider = new SAMLAuthProvider(providerId)
    provider.setCustomParameters(accountHint(email))
    return provider
  }
  if (providerId && providerId.startsWith('oidc.')) {
    const provider = new OAuthProvider(providerId)
    provider.setCustomParameters(accountHint(email))
    return provider
  }
  return createGoogleOAuthProvider(email)
}
