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
 * Auth action links that point at Aglyn instead of Firebase (AGL-1112).
 *
 * The Admin SDK's `generate*Link` calls mint a one-time `oobCode` and wrap it
 * in a URL on the project's `authDomain` — `aglyn-main.firebaseapp.com`. That
 * host then bounces to whatever action URL the Firebase console has
 * configured, and this project's is stuck: every write under
 * `notification.sendEmail` is refused with
 * `EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`, which covers `callbackUri` too. It
 * cannot be changed by us, by the Admin API, or by the CLI.
 *
 * So don't go through it. The `oobCode` is not bound to the page that
 * redeems it — it is redeemed by a client SDK call against the Auth backend,
 * from wherever that call is made. Rewriting the link onto our own handler
 * pages skips `aglyn-main.firebaseapp.com` entirely, and with it the wrong
 * branding, the wrong domain in the address bar, and a console setting we are
 * locked out of.
 *
 * The `oobCode` is the only part that carries meaning; everything else in the
 * generated URL is Firebase's own routing. Reading the code out and building
 * our own URL is therefore lossless, not a hack around a signature.
 */


export type AuthActionKind = 'resetPassword' | 'verifyEmail'

/** Where each action is redeemed in the console. */
const ACTION_PATH: Record<AuthActionKind, string> = {
  resetPassword: '/reset-password',
  verifyEmail: '/verify-email',
}

/**
 * Pull the one-time code out of a Firebase-generated action URL.
 *
 * Exported for tests: the shape of that URL is Firebase's, not ours, and if
 * it ever changes this is the single place that would silently start
 * producing links with no code in them.
 */
export function oobCodeFromLink(link: string): string {
  try {
    return new URL(link).searchParams.get('oobCode') ?? ''
  } catch {
    return ''
  }
}

/**
 * Build the console-hosted URL that redeems `oobCode`.
 *
 * `mode` rides along because the handler pages already read it and refuse a
 * code presented for the wrong action — a reset code arriving at the verify
 * page should fail closed rather than be attempted.
 */
export function authActionUrl(
  origin: string,
  kind: AuthActionKind,
  oobCode: string,
): string {
  const url = new URL(ACTION_PATH[kind], origin)
  url.searchParams.set('mode', kind)
  url.searchParams.set('oobCode', oobCode)
  return url.toString()
}

