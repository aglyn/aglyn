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

import { AuthAppErrorCodes, type AuthAppCode } from '@aglyn/shared-data-enums'

/**
 * Turns an SSO failure into something a person can act on (AGL-1416).
 *
 * ## The error that blames the wrong party
 *
 * Google answers a SAML request it cannot serve with **"this app was not
 * configured for the user"**. Read plainly, that sentence says the admin
 * misconfigured the app for this person — so the reader stops and files a
 * ticket. It is almost never true. Google resolves the request against the
 * DEFAULT signed-in account, and when that default is a personal Gmail with
 * no SAML app attached, the message is about an account the user was not even
 * trying to sign in with.
 *
 * The fix the user needs is "sign out of your other Google account" and it
 * appears nowhere in Google's text. So we say it.
 *
 * `login_hint` (see `oauth-providers`) is the primary fix and should stop
 * most of these ever happening. This is the other half: an IdP is free to
 * ignore a hint, and a hint cannot help someone who has already failed.
 *
 * ## Every branch returns a code
 *
 * `AuthErrorAlertComponent` renders NOTHING unless `error.code` is set, so an
 * error shaped `{ message }` is silently dropped — which is exactly what
 * happened to every message the SSO page wrote for itself. Returning a code
 * on every path is what makes these visible at all.
 */

export interface SsoFailure {
  code: AuthAppCode
  message: string
}

/**
 * Collapses an error into one lowercase, punctuation-free string.
 *
 * `app_not_configured_for_user` arrives spelled several ways depending on
 * whether it reaches us through the SAML response, a GCIP wrapper, or the
 * error message text, so match on words rather than on an exact token.
 */
function searchable(caught: unknown): string {
  const error = caught as {
    code?: unknown
    message?: unknown
    customData?: unknown
  }
  let custom = ''
  try {
    custom = error?.customData ? JSON.stringify(error.customData) : ''
  } catch {
    /* circular or exotic — the code and message below still carry it */
  }
  return [error?.code, error?.message, custom]
    .map((part) => String(part ?? ''))
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
}

/**
 * Google spells this verdict at least three ways — the raw SAML/GCIP token
 * `app_not_configured_for_user`, the prose "This app was not configured for
 * the user", and upper-case hyphenated variants. Matching the words in order
 * with filler between them catches all of them; matching the literal token
 * catches only the machine-readable one, which is not the one a user sees.
 */
const NOT_CONFIGURED =
  /\bapp\b(?:\s+\w+){0,3}?\s+not\s+configured\s+for(?:\s+\w+){0,3}?\s+user\b/

export function describeSsoError(caught: unknown): SsoFailure {
  const text = searchable(caught)

  if (NOT_CONFIGURED.test(text)) {
    return {
      code: AuthAppErrorCodes.SSO_ACCOUNT_MISMATCH,
      message:
        'Google signed you in as a different account than the one you ' +
        'entered, and that account has no access to your organization’s ' +
        'single sign-on.',
    }
  }

  // The IdP window closed with no result. On this path that is as likely to
  // be Google's own refusal page as a real cancel, so it must not be silent.
  if (
    text.includes('popup closed by user') ||
    text.includes('cancelled popup request') ||
    text.includes('popup blocked')
  ) {
    return {
      code: AuthAppErrorCodes.SSO_INCOMPLETE,
      message: 'The single sign-on window closed before sign-in finished.',
    }
  }

  if (text.includes('network request failed') || text.includes('timeout')) {
    return {
      code: AuthAppErrorCodes.SSO_FAILED,
      message: 'We could not reach your identity provider.',
    }
  }

  return {
    code: AuthAppErrorCodes.SSO_FAILED,
    message: 'Single sign-on did not complete.',
  }
}
