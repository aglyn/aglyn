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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'

export interface PasskeyEligibleUser {
  uid: string
  email: string | null
}

/**
 * Verifies the Bearer ID token on a passkey REGISTRATION request and applies
 * the eligibility gates (AGL-662):
 *
 * - GCIP tenant users (enterprise SSO, AGL-1101) are refused: passkeys are
 *   project-pool only for now. A tenant user's identity lives in their
 *   tenant, and the sign-in bridge mints project-pool custom tokens — half
 *   supporting them would fork the account.
 * - Unverified emails are refused, matching the session-mint gate (AGL-479):
 *   a passkey must not become a way to hold a session the mint would refuse.
 */
export async function requirePasskeyEligibleUser(
  request: Request,
): Promise<PasskeyEligibleUser | Response> {
  const authorization = request.headers.get('authorization') ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (decoded.firebase?.tenant) {
      return Response.json({ error: 'sso-tenant-unsupported' }, { status: 403 })
    }
    if (!decoded.email_verified) {
      return Response.json({ error: 'email-unverified' }, { status: 403 })
    }
    return {
      uid: decoded.uid,
      email: decoded.email ? String(decoded.email) : null,
    }
  } catch {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
}
