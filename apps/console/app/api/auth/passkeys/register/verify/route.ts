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
import { after } from 'next/server'
import {
  formatAlertTime,
  sendPasskeyAddedAlert,
} from '../../../../_lib/security-alerts'
import {
  PasskeyError,
  verifyAndStoreRegistration,
} from '../../../../_lib/passkeys'
import { requirePasskeyEligibleUser } from '../../_lib/passkey-auth'

// lockdown-423: exempt — sign-in machinery, pre-session; the session mint (AGL-1501) is the
// lockdown chokepoint for every authentication flow.

export const dynamic = 'force-dynamic'

/**
 * Registration ceremony, step 2 (AGL-662): verify the attestation against
 * the single-use challenge and persist the credential (server-write-only
 * store). On success the "passkey added" security alert (AGL-665) goes out
 * via `after()` — the email owes the user a heads-up, not latency.
 */
export async function POST(request: Request): Promise<Response> {
  const gate = await requirePasskeyEligibleUser(request)
  if (gate instanceof Response) return gate
  const limited = await consumeRateLimit(`passkey-register:${gate.uid}`, {
    limit: 10,
    windowMs: 60 * 60 * 1000,
  })
  if (!limited.allowed) {
    return Response.json({ error: 'rate-limited' }, { status: 429 })
  }
  let body: {
    challengeId?: string
    response?: unknown
    label?: string
  }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'bad-request' }, { status: 400 })
  }
  if (!body?.challengeId || !body?.response) {
    return Response.json({ error: 'bad-request' }, { status: 400 })
  }
  try {
    const stored = await verifyAndStoreRegistration({
      firestore: firebaseAdmin.app().firestore(),
      uid: gate.uid,
      originHeader: request.headers.get('origin'),
      challengeId: String(body.challengeId),
      response: body.response as never,
      label: body.label,
    })
    const email = gate.email
    if (email) {
      after(async () => {
        try {
          await sendPasskeyAddedAlert({
            to: email,
            label: stored.label,
            time: formatAlertTime(Date.now()),
          })
        } catch (error) {
          console.error('[passkeys/register/verify] alert failed', error)
        }
      })
    }
    return Response.json(
      { ok: true, credentialId: stored.credentialId, label: stored.label },
      { status: 200 },
    )
  } catch (error) {
    if (error instanceof PasskeyError) {
      return Response.json({ error: error.reason }, { status: 400 })
    }
    console.error('[passkeys/register/verify] failed', error)
    return Response.json({ error: 'internal' }, { status: 500 })
  }
}
