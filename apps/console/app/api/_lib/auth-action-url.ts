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

/**
 * Canonical console origin. Same expression `app/layout.tsx` and
 * `render-system-email.ts` use, so the host in a recovery link cannot drift
 * from the host the rest of the console calls itself.
 */
function canonicalOrigin(): string {
  return stripTrailingSlash(
    process.env.NEXT_PUBLIC_CONSOLE_URL || 'https://app.aglyn.com',
  )
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

/**
 * Extra origins a minted link may legitimately point at, as a comma-separated
 * list. The operator control for this feature: a preview deploy that needs to
 * test recovery against itself is one env var, and removing it is the
 * rollback. Empty in production by default.
 */
function configuredOrigins(): string[] {
  return (process.env.AUTH_ACTION_ALLOWED_ORIGINS || '')
    .split(',')
    .map((entry) => stripTrailingSlash(entry.trim()))
    .filter(Boolean)
}

/**
 * Decide which origin a password-reset or verification link is built on.
 *
 * **The request may not choose.** `generate*Link` mints an `oobCode` that is
 * redeemed by a client SDK call against the Auth backend from wherever that
 * call is made — the property AGL-1112 relies on to escape the locked Firebase
 * action handler. The same property means the host in the emailed link is the
 * only thing deciding who receives the code when the recipient clicks: a link
 * built on an attacker's host hands them a live reset code for an account they
 * do not control, in a mail genuinely sent by us.
 *
 * `Origin` and `Host` are request headers, so on the unauthenticated recovery
 * endpoint they are attacker-supplied. Firebase's authorized-domain list does
 * constrain the `continueUrl` we pass alongside, but it is not a boundary this
 * link should rest on: it is remote configuration this repo cannot see, it
 * currently contains a bare `vercel.app`, and AGL-719 is about to edit it.
 *
 * So the origin comes from server configuration, and a request-supplied one is
 * honoured only when it is explicitly allowlisted. Anything else falls back to
 * canonical rather than failing — a link on the real console still redeems
 * perfectly, so the safe answer is also the working one, and account recovery
 * never breaks to protect itself.
 */
export function resolveAuthActionOrigin(
  requestOrigin: string | null | undefined,
): string {
  const canonical = canonicalOrigin()
  const candidate = stripTrailingSlash(String(requestOrigin ?? '').trim())
  if (!candidate) return canonical

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return canonical
  }
  // Only ever http/https — a `javascript:` or `data:` origin reaching an
  // email button is not a link, it is a payload.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return canonical
  }

  const allowed = new Set([canonical, ...configuredOrigins()])
  if (allowed.has(stripTrailingSlash(parsed.origin))) {
    return stripTrailingSlash(parsed.origin)
  }
  // Local development, where the canonical origin would send a developer's
  // reset link to production. Never outside development.
  if (
    process.env.NODE_ENV !== 'production' &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
  ) {
    return stripTrailingSlash(parsed.origin)
  }
  return canonical
}

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

