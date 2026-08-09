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
  createAuthenticationOptions,
  PasskeyError,
} from '../../../../_lib/passkeys'

export const dynamic = 'force-dynamic'

/**
 * Sign-in ceremony, step 1 (AGL-662): unauthenticated by nature (the caller
 * is trying to BECOME signed in), so rate-limited per IP. Returns
 * discoverable-credential request options plus a single-use challenge id.
 */
export async function POST(request: Request): Promise<Response> {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const limited = await consumeRateLimit(`passkey-signin-ip:${ip}`, {
    limit: 30,
    windowMs: 10 * 60 * 1000,
  })
  if (!limited.allowed) {
    return Response.json({ error: 'rate-limited' }, { status: 429 })
  }
  try {
    const result = await createAuthenticationOptions({
      firestore: firebaseAdmin.app().firestore(),
      originHeader: request.headers.get('origin'),
    })
    return Response.json(result, { status: 200 })
  } catch (error) {
    if (error instanceof PasskeyError) {
      return Response.json({ error: error.reason }, { status: 400 })
    }
    console.error('[passkeys/signin/options] failed', error)
    return Response.json({ error: 'internal' }, { status: 500 })
  }
}
