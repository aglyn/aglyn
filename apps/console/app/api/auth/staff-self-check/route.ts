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
 * "Why am I seeing a 404?" — self-diagnosis for the staff console (AGL-1993).
 *
 * `StaffGuard` returns a bare 404 to a session with no staff claim, by design
 * (AGL-847): a stranger must not learn the staff console exists. The cost is
 * that the ONLY signal is absence, which is indistinguishable from a broken
 * guard, a missing route, or a claim that failed to propagate. That ambiguity
 * misdirected two investigations on 2026-08-18 before anyone checked the
 * actual pools.
 *
 * This route resolves it WITHOUT weakening the guard. Two rules make it safe:
 *
 *  1. **It reports only on the caller's own identity.** Everything returned is
 *     derived from the verified token's uid and email address. Nothing about
 *     anyone else is readable, so it cannot be used to enumerate staff.
 *  2. **It never says "you are almost staff".** A non-staff caller learns that
 *     they hold no staff claim — which they already knew from the 404 — plus
 *     which pool their identity lives in. Saying "your OTHER identity has
 *     staff" is limited to identities sharing THEIR OWN verified address, so
 *     it reveals nothing they could not establish by signing in.
 *
 * The cross-pool half is the actually useful part: a person whose address
 * exists in both the project pool and a GCIP tenant (the AGL-1962 phantom
 * shape, and the ordinary SSO-migration shape) is told which record carries
 * the grant, instead of guessing.
 */

// lockdown-423: exempt — account-scoped read of the caller's OWN identity across the
// auth pools (AGL-1993/AGL-2005). It takes no orgId, touches no org or host doc, and
// writes nothing; the same shape as auth/activity. It must also stay reachable under a
// lock: this is how a staff user establishes which pool they are signed in as while
// diagnosing the lockdown, and refusing it would hide the answer during the one
// incident it exists for.
import {
  authForPool,
  firebaseAdmin,
  listAuthTenantIds,
} from '@aglyn/tenant-data-admin'

interface IdentityRow {
  /** Pool the record lives in; null = the project pool. */
  tenantId: string | null
  staff: boolean
  staffRole: string | null
  /** True for the record the caller is currently signed in as. */
  current: boolean
}

async function handler(request: Request): Promise<Response> {
  const authorization = request.headers.get('authorization') ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : ''
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  let decoded
  try {
    // Project-level verify accepts a GCIP-tenant token too — the tenant is
    // then readable at `firebase.tenant`. Only `TenantAwareAuth.verifyIdToken`
    // additionally ASSERTS a matching tenant, which is not wanted here: this
    // route must answer for callers from every pool.
    decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
  } catch {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  const currentTenantId = decoded.firebase?.tenant ?? null
  const email = typeof decoded.email === 'string' ? decoded.email : null

  const identities: IdentityRow[] = []
  if (email) {
    // Every pool holding THIS address. Deliberately not `findUserByEmail-
    // AcrossPools`, which stops at the first hit — the whole point here is to
    // see the records it would have skipped.
    const pools: (string | null)[] = [null, ...(await listAuthTenantIds())]
    for (const tenantId of pools) {
      try {
        const record = await authForPool(tenantId).getUserByEmail(email)
        const claims = record.customClaims ?? {}
        identities.push({
          tenantId,
          staff: claims['staff'] === true,
          // Mirrors the routes: a missing role means `support` (AGL-495).
          staffRole: claims['staff'] === true
            ? String(claims['staffRole'] ?? 'support')
            : null,
          current: record.uid === decoded.uid && tenantId === currentTenantId,
        })
      } catch {
        // This pool does not hold the address. Expected for most pools.
      }
    }
  }

  const staff = decoded['staff'] === true
  const elsewhere = identities.filter((row) => !row.current && row.staff)

  return Response.json(
    {
      uid: decoded.uid,
      email,
      /** Pool of the CURRENT session. null = project pool. */
      tenantId: currentTenantId,
      /** The claim as this session's token actually carries it. */
      staff,
      staffRole: staff ? String(decoded['staffRole'] ?? 'support') : null,
      /** Every pool holding the caller's own address. */
      identities,
      /**
       * The actionable sentence. Present only when ANOTHER record for the
       * caller's own address carries staff — i.e. they are signed in as the
       * wrong one of their own identities.
       */
      hint: staff
        ? null
        : elsewhere.length
          ? 'Your staff access is on a different sign-in for this address. ' +
            'Sign out and sign in through ' +
            (elsewhere[0].tenantId
              ? 'your organization (single sign-on).'
              : 'email and password instead of single sign-on.')
          : null,
    },
    { status: 200 },
  )
}

export const dynamic = 'force-dynamic'
export { handler as GET }
