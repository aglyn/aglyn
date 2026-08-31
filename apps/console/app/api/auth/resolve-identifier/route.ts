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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  consumeRateLimit,
  findAccountByVerifiedAlias,
  findUserByUidAcrossPools,
} from '@aglyn/tenant-data-admin'
import { normalizeAccountEmail } from '@aglyn/aglyn/app-utils/account-emails'
import { readClientIp } from '@aglyn/aglyn/app-utils/request-ip'

// lockdown-423: exempt — pre-auth sign-in routing, like `sso-lookup`. No
// session, no org action, and it grants nothing: whatever it returns still
// has to be followed by the account's password.

/**
 * Sign in with any CONFIRMED address (AGL-2486).
 *
 * Firebase Auth knows exactly one email per user — the record's own — so
 * `signInWithEmailAndPassword('ada@work.test', …)` fails for an account whose
 * record says `ada@personal.test`, even though the work address is confirmed
 * on that very account. This route is the translation step: the sign-in page
 * calls it only AFTER a password attempt has already failed on the typed
 * address, and retries once with what comes back.
 *
 * It grants nothing. The answer is an address, not a session; the password
 * check is unchanged and still happens in Firebase.
 *
 * ## The trade-off, stated plainly because it is real
 *
 * A caller who already knows `ada@work.test` learns `ada@personal.test`. Both
 * addresses belong to the same person, and the mapping is one they created
 * deliberately — but it IS a disclosure, and it is the one judgement call in
 * this feature that a reviewer might reasonably want to revisit.
 *
 * The alternative designs and why they were not taken:
 *
 *  - **Return nothing and drop alias sign-in.** Costs the feature its main
 *    convenience, which is the half the requirement was for by name.
 *  - **Take the password here and verify it server-side**, returning a custom
 *    token instead of an address. Leaks nothing — but it routes every
 *    password through our own Next.js route, where Firebase's client SDK
 *    handles it today. Trading a same-person address disclosure for a new
 *    place passwords can be logged is a bad trade.
 *
 * So it stays, bounded rather than unbounded:
 *
 *  - answers ONLY for a CONFIRMED alias — the index is written by the
 *    email round-trip and by nothing else, so an address somebody merely
 *    typed into a settings form reveals nothing;
 *  - rate-limited per identifier AND per IP, on the `send-password-reset`
 *    pattern — per identifier alone lets one host walk a list, per IP alone
 *    lets a botnet grind one address;
 *  - **the response is the same shape either way**: an unknown address echoes
 *    itself back, so the route is no more an account-existence oracle than
 *    the password form it sits behind already is.
 */

async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const identifier = normalizeAccountEmail((body as any)?.identifier)
  // Echo the input on every refusal path, so a caller cannot tell a rejected
  // address from an unknown one from a rate-limited one.
  const echo = (value: unknown) =>
    Response.json(
      { email: typeof value === 'string' ? value : null },
      { status: 200 },
    )
  if (identifier === null) return echo((body as any)?.identifier)

  try {
    const perAddress = await consumeRateLimit(`resolve-identifier:${identifier}`, {
      limit: 10,
      windowMs: 60 * 60 * 1000,
    })
    if (!perAddress.allowed) return echo(identifier)
    // No address, no per-IP budget. The per-identifier cap above is the
    // half that stops one host walking a list, and it still applies; keying
    // an unreadable address under a placeholder would instead put every
    // caller in one 30-per-hour bucket and make the alias lookup answer
    // nobody.
    const callerIp = readClientIp(headers)
    const perIp = callerIp
      ? await consumeRateLimit(`resolve-identifier-ip:${callerIp}`, {
          limit: 30,
          windowMs: 60 * 60 * 1000,
        })
      : null
    if (perIp && !perIp.allowed) return echo(identifier)

    const alias = await findAccountByVerifiedAlias(identifier)
    if (alias === null) return echo(identifier)

    // The account's PRIMARY is the Firebase Auth record's email. Read across
    // pools: an SSO account lives in its org's GCIP tenant and a
    // project-level lookup cannot see it (AGL-1122).
    const pooled = await findUserByUidAcrossPools(alias.uid)
    const primary = pooled?.record?.email ?? null
    if (!primary) return echo(identifier)

    // An SSO-governed account is never handed a password identifier: its
    // sign-in belongs to the org's IdP, and answering here would offer a
    // route around it.
    if (pooled.tenantId) return echo(identifier)

    return Response.json({ email: primary }, { status: 200 })
  } catch (error) {
    console.error('[auth/resolve-identifier] failed', error)
    // Fail closed to the address the user typed — never block a sign-in on
    // this lookup.
    return echo(identifier)
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
