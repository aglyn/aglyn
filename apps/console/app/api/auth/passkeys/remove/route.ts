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

import { consumeRateLimit, firebaseAdmin } from '@aglyn/tenant-data-admin'
import { PasskeyError, deletePasskey } from '../../../_lib/passkeys'
import { requirePasskeyEligibleUser } from '../_lib/passkey-auth'

// lockdown-423: exempt — sign-in machinery, pre-session; the session mint (AGL-1501) is the
// lockdown chokepoint for every authentication flow.

export const dynamic = 'force-dynamic'

/**
 * Remove one of the caller's own passkeys (AGL-1881).
 *
 * The credential store is server-write-only, so without this endpoint there
 * was no delete path of any kind: a user whose device was stolen could not
 * take the credential off their account, and a credential the clone check
 * had flagged was a permanent dead entry the console labelled "Blocked".
 * Three strings in the product already promised this existed.
 *
 * POST rather than DELETE: every other passkey endpoint is POST + Bearer,
 * the body carries the credential id, and a DELETE with a body is the shape
 * that has bitten this repo before.
 *
 * Same gate as registration ({@link requirePasskeyEligibleUser}): a verified
 * Bearer ID token for a project-pool user. Deliberately NOT stricter than
 * the gate that created the credential — a user who can add a sign-in method
 * must be able to take one away, or a compromised-device recovery ends at a
 * support ticket.
 *
 * Rate limited on the same shape as registration, at the same budget. The
 * transaction is cheap and the ownership check makes enumeration useless,
 * but an unbounded authenticated write loop is still a write loop.
 */
export async function POST(request: Request): Promise<Response> {
  const gate = await requirePasskeyEligibleUser(request)
  if (gate instanceof Response) return gate
  const limited = await consumeRateLimit(`passkey-remove:${gate.uid}`, {
    limit: 10,
    windowMs: 60 * 60 * 1000,
  })
  if (!limited.allowed) {
    return Response.json({ error: 'rate-limited' }, { status: 429 })
  }
  let body: { credentialId?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'bad-request' }, { status: 400 })
  }
  const credentialId = String(body?.credentialId ?? '')
  if (!credentialId) {
    return Response.json({ error: 'bad-request' }, { status: 400 })
  }
  try {
    const result = await deletePasskey({
      firestore: firebaseAdmin.app().firestore(),
      uid: gate.uid,
      credentialId,
    })
    return Response.json({ ok: true, ...result }, { status: 200 })
  } catch (error) {
    if (error instanceof PasskeyError) {
      return Response.json({ error: error.reason }, { status: 400 })
    }
    console.error('[passkeys/remove] failed', error)
    return Response.json({ error: 'internal' }, { status: 500 })
  }
}
