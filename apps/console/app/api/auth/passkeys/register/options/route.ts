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
import {
  createRegistrationOptions,
  PasskeyError,
} from '../../../../_lib/passkeys'
import { requirePasskeyEligibleUser } from '../../_lib/passkey-auth'

// lockdown-423: exempt — sign-in machinery, pre-session; the session mint (AGL-1501) is the
// lockdown chokepoint for every authentication flow.

export const dynamic = 'force-dynamic'

/**
 * Registration ceremony, step 1 (AGL-662): Bearer ID token in, WebAuthn
 * creation options + a single-use server-stored challenge out. Console
 * posture: Bearer-only auth, no CSRF token — a cross-site caller cannot
 * read or forge the Authorization header.
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
  try {
    const result = await createRegistrationOptions({
      firestore: firebaseAdmin.app().firestore(),
      uid: gate.uid,
      email: gate.email,
      originHeader: request.headers.get('origin'),
    })
    return Response.json(result, { status: 200 })
  } catch (error) {
    if (error instanceof PasskeyError) {
      return Response.json({ error: error.reason }, { status: 400 })
    }
    console.error('[passkeys/register/options] failed', error)
    return Response.json({ error: 'internal' }, { status: 500 })
  }
}
