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
  emailUnverifiedResponse,
  findUserByUidAcrossPools,
  firebaseAdmin,
  getContactSuppression,
  isImpersonationSession,
  type ContactChannel,
} from '@aglyn/tenant-data-admin'

/**
 * Staff user detail (AGL-244): everything the console needs to answer
 * "who is this account" — identity + auth state, staff claims, every org
 * membership with its role/host access (via the reverse index), and the
 * account's recent admin-audit trail.
 */

/**
 * What the caller is told about the account's phone (AGL-1569).
 *
 * `phoneContact` is null when there is no number on file — there is then
 * nothing to dial and nothing to check.
 */
interface PhoneDisclosure {
  /** E.164 as stored on the profile, or null. */
  phoneNumber: string | null
  /** Set when the person asked us to stop holding it (AGL-1592). */
  phoneNumberErasedAt: string | null
  phoneContact: {
    /** True = do not call/text. Fail-closed; see below. */
    suppressed: boolean
    /** Which channels the opt-out covers; empty when not suppressed. */
    channels: ContactChannel[]
    /** How the opt-out arrived (`sms-keyword`, `email`, `verbal`, …). */
    source: string | null
    /** They also asked us to stop holding the number. */
    erasePhoneOnFile: boolean
    /** Non-null once they opted back in; a revoked record does not suppress. */
    revokedAt: string | null
    /** The list could not be read. `suppressed` is then a refusal, not a fact. */
    lookupFailed: boolean
  } | null
}

/**
 * Read the phone the profile actually holds, plus the do-not-contact answer
 * that has to travel with it.
 *
 * WHICH FIELD. `users/{uid}.phoneNumber`, not `record.phoneNumber` from the
 * Firebase Auth record. They are different fields: `seedUserProfile` writes
 * the profile one on every SSO sign-in and at signup, while the Auth record's
 * phone is populated only by phone-number authentication, which this codebase
 * wires nowhere (no `PhoneAuthProvider` / `signInWithPhoneNumber` anywhere).
 * Projecting the Auth field would render "—" for every account that has a
 * number on file — the exact gap AGL-1569 exists to close, reintroduced while
 * looking fixed.
 *
 * WHY THE SUPPRESSION COMES WITH IT AND NOT SEPARATELY. The only stated reason
 * this number is collected is Privacy Policy v4 §11 — calling and texting
 * about upsells and overdue bills. So the read that hands a staff member a
 * dialable number is precisely the read that must also answer "may we?".
 * Shipping the number alone would put an opt-out one unrelated page away from
 * the person about to ignore it, and §11 promises the opposite.
 *
 * FAILS CLOSED, in step with `isPhoneContactSuppressed`. A lookup that throws
 * answers `suppressed: true` with `lookupFailed: true`, because a list we
 * could not read is not a list that said "go ahead". The flag is there so the
 * surface can say "could not check" rather than assert an opt-out that may not
 * exist.
 */
async function readPhoneDisclosure(profile: {
  get: (field: string) => unknown
}): Promise<PhoneDisclosure> {
  const stored = profile.get('phoneNumber')
  const phoneNumber = typeof stored === 'string' && stored.trim() ? stored : null
  const erased = profile.get('phoneNumberErasedAt') as
    | { toDate?: () => Date }
    | undefined
  const phoneNumberErasedAt = erased?.toDate?.()?.toISOString() ?? null

  if (!phoneNumber) {
    return { phoneNumber: null, phoneNumberErasedAt, phoneContact: null }
  }
  try {
    const suppression = await getContactSuppression(phoneNumber)
    const revoked = suppression?.revokedAt as { toDate?: () => Date } | null
    const revokedAt = revoked?.toDate?.()?.toISOString() ?? null
    return {
      phoneNumber,
      phoneNumberErasedAt,
      phoneContact: {
        suppressed: Boolean(suppression) && !revokedAt,
        channels: suppression && !revokedAt ? (suppression.channels ?? []) : [],
        source: suppression?.source ?? null,
        erasePhoneOnFile: suppression?.erasePhoneOnFile === true,
        revokedAt,
        lookupFailed: false,
      },
    }
  } catch (error) {
    console.error(
      '[admin/users/detail] suppression lookup failed; reporting as suppressed',
      error,
    )
    return {
      phoneNumber,
      phoneNumberErasedAt,
      phoneContact: {
        suppressed: true,
        channels: [],
        source: null,
        erasePhoneOnFile: false,
        revokedAt: null,
        lookupFailed: true,
      },
    }
  }
}
async function handler(request: Request): Promise<Response> {
  const { method, query, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  const uid = String(query.uid ?? '')
  if (!uid) return Response.json({ error: 'Missing uid' }, { status: 400 })

  try {
    const auth = firebaseAdmin.app().auth()
    const decoded = await auth.verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    const firestore = firebaseAdmin.app().firestore()

    // Across ALL auth pools (AGL-1122). A uid is only unique within a pool,
    // so a project-level `getUser` throws for an SSO account and this page
    // rendered "User detail failed" — which is exactly what surfaced the
    // moment the listing started including tenant users, since the rows
    // became clickable and led straight here.
    const found = await findUserByUidAcrossPools(uid)
    if (!found) {
      return Response.json({ error: 'No such account' }, { status: 404 })
    }
    const record = found.record
    const tenantId = found.tenantId

    // Org memberships from the reverse index + the authoritative member
    // docs (role, custom role, host access). The profile document rides
    // along in the same round trip — it is the only place the phone lives
    // (AGL-1569), and it was already one `get()` away.
    const [reverse, profile] = await Promise.all([
      firestore.collection('users').doc(uid).collection('orgs').limit(50).get(),
      firestore.collection('users').doc(uid).get(),
    ])
    const phone = await readPhoneDisclosure(profile)
    const memberships = await Promise.all(
      reverse.docs.map(async (entry) => {
        const orgId = entry.id
        const member = await firestore
          .collection('orgs')
          .doc(orgId)
          .collection('members')
          .doc(uid)
          .get()
        return {
          orgId,
          orgName: entry.get('orgName') ?? null,
          slug: entry.get('slug') ?? null,
          role: member.get('role') ?? entry.get('role') ?? null,
          roleId: member.get('roleId') ?? null,
          allHosts: member.get('allHosts') === true,
          hostAccess: member.get('hostAccess') ?? {},
          joinedAt: member.get('joinedAt')?.toDate?.()?.toISOString() ?? null,
        }
      }),
    )

    // Recent audit trail: actions BY this account and ON this account.
    const [byActor, onTarget] = await Promise.all([
      firestore
        .collection('adminAudit')
        .where('actorUid', '==', uid)
        .limit(10)
        .get()
        .catch(() => null),
      firestore
        .collection('adminAudit')
        .where('target', '==', `users/${uid}`)
        .limit(10)
        .get()
        .catch(() => null),
    ])
    const audit = [...(byActor?.docs ?? []), ...(onTarget?.docs ?? [])]
      .map((doc) => ({
        id: doc.id,
        actorUid: doc.get('actorUid') ?? null,
        action: doc.get('action') ?? null,
        target: doc.get('target') ?? null,
        at: doc.get('at')?.toDate?.()?.toISOString() ?? null,
      }))
      .sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')))
      .slice(0, 15)

    return Response.json({
      user: {
        uid: record.uid,
        email: record.email ?? null,
        displayName: record.displayName ?? null,
        // The auth record's photo, falling back to a provider photo (e.g.
        // Google's avatar, which lives on providerData when the top-level
        // photoURL was never mirrored) so the identity editor shows it
        // (AGL-877). The page reads `photoUrl`.
        photoUrl:
          record.photoURL ??
          record.providerData.find((provider) => provider.photoURL)
            ?.photoURL ??
          null,
        disabled: record.disabled,
        // Phone + do-not-contact state (AGL-1569). See `readPhoneDisclosure`
        // for why this is the profile's field and not the Auth record's, and
        // why the opt-out answer is inseparable from the number.
        ...phone,
        staff: record.customClaims?.['staff'] === true,
        staffRole: record.customClaims?.['staffRole'] ?? null,
        providers: record.providerData.map((provider) => provider.providerId),
        createdAt: record.metadata.creationTime ?? null,
        lastSignInAt: record.metadata.lastSignInTime ?? null,
        /** GCIP tenant id, or null for a project-pool account (AGL-1122). */
        tenantId,
      },
      memberships,
      audit,
    }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'User detail failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
