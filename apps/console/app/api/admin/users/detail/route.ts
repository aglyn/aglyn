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
  getLegalAcceptanceStatus,
  isImpersonationSession,
  type ContactChannel,
  type LegalAcceptanceStatus,
} from '@aglyn/tenant-data-admin'
import { adminAuditKind } from '../../../_lib/admin-audit'
import { invalidIdTokenResponse } from '../../../_lib/invalid-id-token-response'
import { LEGAL_DOCUMENT_VERSION } from '../../../../../constants/legal-documents'
import { type DeviceRow, readDeviceRows } from '../../../_lib/device-registry'
// From the LEAF: the barrel above reaches the admin SDK and is mocked wholesale
// by route specs, and a mocked-away reader renders an empty email history that
// looks exactly like "we never mailed this person".
import { readEmailDeliveryHistory } from '@aglyn/tenant-data-admin/server/email-delivery-log'

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
/**
 * What this account agreed to, and whether §18.5's clock is still running
 * (AGL-2316).
 *
 * The clickwrap records were written from the day sign-up started recording
 * them and read by nothing, so the two questions the record exists to answer
 * — "did this person accept, and which version" and "is the 30-day
 * arbitration opt-out window still open" — had no surface at all. This is
 * that surface: the disputes it settles are staff-answered, and this page
 * already assembles everything else staff need about one human.
 *
 * FAILS LOUD, NOT SILENT — the opposite direction from the phone lookup above
 * and for the opposite reason. A suppression list we cannot read must be
 * treated as "do not contact", because acting is the harm. Here the harm is
 * ASSERTING: rendering "no acceptance on file" when the truth is "we could
 * not look" would tell a staff member the company holds no evidence, in the
 * exact conversation where that claim is most expensive. So a failure returns
 * `lookupFailed: true` and every verdict null, and the page says so.
 */
type LegalDisclosure =
  | (LegalAcceptanceStatus & { lookupFailed: false })
  | {
      lookupFailed: true
      currentVersion: string
      accepted: null
      acceptedVersions: []
      latestAcceptedVersion: null
      currentVersionAcceptedAt: null
      latestAcceptedAt: null
      changedDocumentKeys: null
      reacceptanceRequired: null
      reacceptanceReason: null
      arbitration: null
      acceptances: []
    }

async function readLegalDisclosure(
  uid: string,
  firestore: unknown,
): Promise<LegalDisclosure> {
  try {
    const status = await getLegalAcceptanceStatus(uid, {
      currentVersion: LEGAL_DOCUMENT_VERSION,
      firestore,
    })
    return { ...status, lookupFailed: false }
  } catch (error) {
    console.error('[admin/users/detail] legal acceptance read failed', error)
    return {
      lookupFailed: true,
      currentVersion: LEGAL_DOCUMENT_VERSION,
      accepted: null,
      acceptedVersions: [],
      latestAcceptedVersion: null,
      currentVersionAcceptedAt: null,
      latestAcceptedAt: null,
      changedDocumentKeys: null,
      reacceptanceRequired: null,
      reacceptanceReason: null,
      arbitration: null,
      acceptances: [],
    }
  }
}

/**
 * The account's sign-in history, so staff can answer "my laptop was stolen"
 * (AGL-1513 part 2).
 *
 * The registry has been written on every sign-in since AGL-665 and, until
 * AGL-2318, read by nothing; that card gave the OWNER a list, and a support
 * call still had none. Staff could disable the whole account and nothing
 * narrower.
 *
 * FAILS LOUD, like the legal disclosure above and for the same reason: an
 * empty list rendered from a failed read says "this person has only ever
 * signed in from one place", which is the single most misleading answer this
 * surface can give in the conversation it exists for.
 */
async function readDeviceDisclosure(
  uid: string,
  firestore: unknown,
): Promise<{ lookupFailed: boolean; rows: DeviceRow[] }> {
  try {
    return { lookupFailed: false, rows: await readDeviceRows(firestore as any, uid) }
  } catch (error) {
    console.error('[admin/users/detail] device registry read failed', error)
    return { lookupFailed: true, rows: [] }
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
    const [phone, legal, devices, emails] = await Promise.all([
      readPhoneDisclosure(profile),
      readLegalDisclosure(uid, firestore),
      readDeviceDisclosure(uid, firestore),
      /*
       * WHAT WE SENT THIS PERSON, and what they did with it.
       *
       * Keyed on the ADDRESS rather than the uid, because that is what a
       * mail provider reports against and what the delivery log is filed
       * under — an account whose address was changed since a send will not
       * show the older mail, which is the honest answer rather than a
       * confident wrong one.
       *
       * Reads our own store, never the sending provider: see
       * `email-delivery-log.ts` for why a staff screen must not depend on a
       * vendor's list endpoint.
       */
      readEmailDeliveryHistory(record.email),
    ])
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

    /*
     * Recent audit trail: actions BY this account, ON this account, and
     * ABOUT this account.
     *
     * Both halves are ORDERED (AGL-693). They were `limit(10)` with no
     * `orderBy`, which Firestore answers in document-id order over generated
     * ids — so "recent" was ten arbitrary entries per half, and the sort
     * below arranged that sample newest-first, which is what made it look
     * right. An account with a long history showed ten entries from anywhere
     * in it, on the card a staff member reads to find out what just happened.
     *
     * `at` is safe to order on, which is the question `orderBy` always
     * raises: it matches only documents that HAVE the field. Every one of the
     * twenty-four writers of `adminAudit` in this app sets `at` on the same
     * `add()` that creates the entry, and there is no client write path — the
     * collection is server-only — so an entry without it cannot be produced.
     *
     * ⚠️ Each half needs a composite index (`actorUid ASC, at DESC`,
     * `target ASC, at DESC` and `subjectUid ASC, at DESC`), declared in
     * `cloud/firebase-firestore.indexes.json`. All three are live. A half
     * whose index is missing fails its own `catch` and renders EMPTY rather
     * than erroring — so an empty card is not by itself evidence of an index
     * problem, and the card keeps saying the full record lives on the Audit
     * log page.
     *
     * ## Why a THIRD half, on `subjectUid`
     *
     * `target` names the thing acted on, which for most staff actions is the
     * account itself — but not for all of them. Reading somebody's mail
     * targets `emailDeliveries/{messageId}`, which can never equal
     * `users/{uid}`, so the access was invisible on the page of the person
     * whose mail it was. The log could answer "what did this staff member
     * do" and could not answer "who accessed my data", which is the question
     * the collection exists for.
     *
     * `subjectUid` is that second fact, kept separate from `target` on
     * purpose: overloading the target to mean the subject would lose which
     * record was actually touched. Entries written before the field existed
     * do not have one and cannot be given one by inference, so this history
     * stays incomplete — the `target` half remains the only way to reach
     * them, and dropping it would lose them entirely.
     */
    const [byActor, onTarget, onSubject] = await Promise.all([
      firestore
        .collection('adminAudit')
        .where('actorUid', '==', uid)
        .orderBy('at', 'desc')
        .limit(10)
        .get()
        .catch(() => null),
      firestore
        .collection('adminAudit')
        .where('target', '==', `users/${uid}`)
        .orderBy('at', 'desc')
        .limit(10)
        .get()
        .catch(() => null),
      firestore
        .collection('adminAudit')
        .where('subjectUid', '==', uid)
        .orderBy('at', 'desc')
        .limit(10)
        .get()
        .catch(() => null),
    ])
    const seenAuditIds = new Set<string>()
    const auditEntries = [
      ...(byActor?.docs ?? []),
      ...(onTarget?.docs ?? []),
      ...(onSubject?.docs ?? []),
    ]
      // The halves OVERLAP: an action targeting `users/{uid}` that also
      // names the same person as its subject is one act answered by two
      // queries, and rendering it twice would read as two.
      .filter((doc) => {
        if (seenAuditIds.has(doc.id)) return false
        seenAuditIds.add(doc.id)
        return true
      })
      .map((doc) => ({
        id: doc.id,
        actorUid: doc.get('actorUid') ?? null,
        action: doc.get('action') ?? null,
        target: doc.get('target') ?? null,
        subjectUid: doc.get('subjectUid') ?? null,
        // WHY (AGL-1652). An `org.override` performed BY this account is in
        // the `byActor` half above, so dropping the reason here would hide
        // it on one of the three surfaces the act is read from.
        reason: doc.get('reason') ?? null,
        note: doc.get('note') ?? null,
        at: doc.get('at')?.toDate?.()?.toISOString() ?? null,
        /*
         * How many times one act was recorded, and when it last happened.
         * A repeat COLLAPSES onto its row rather than adding one, so without
         * these two fields the card would under-report the access it just
         * merged. Absent on rows written before the writer carried them,
         * which read as a single occurrence — which is what they are.
         */
        repeatCount: Number(doc.get('repeatCount')) || 1,
        lastAt: doc.get('lastAt')?.toDate?.()?.toISOString() ?? null,
        kind: adminAuditKind(doc.get('action')),
      }))
      .sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')))
    /*
     * A BURST OF READS MUST NOT PUSH OUT AN IMPERSONATION.
     *
     * One flat window sorted by time let four `email.message-viewed` rows
     * crowd `user.impersonate` and `org.override` off a ten-row card — the
     * entries somebody opens that card to find. The window is taken PER KIND
     * instead, so the two categories cannot compete for the same slots and a
     * change is displaced only by another change.
     *
     * Both kinds are returned in full; the console renders them as two
     * tables. Reads are never dropped — an unrecorded look is the failure
     * this collection exists to prevent, and hiding one from the page is a
     * quieter version of the same thing.
     */
    const audit = [
      ...auditEntries.filter((entry) => entry.kind === 'change').slice(0, 15),
      ...auditEntries.filter((entry) => entry.kind === 'access').slice(0, 15),
    ].sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')))

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
      /**
       * Clickwrap acceptance history + the §18.5 verdicts (AGL-2316). Beside
       * the phone disclosure because both are compliance answers about the
       * same human, and both were written long before anything read them.
       */
      legal,
      /**
       * Sign-in history, and what the staff sign-out control acts on
       * (AGL-1513 part 2). `lookupFailed` is kept separate from an empty list
       * on purpose — see `readDeviceDisclosure`.
       */
      devices,
      /**
       * Delivery history for the account's address — what was sent, whether
       * it arrived, and whether it was opened or clicked. Same
       * `lookupFailed` split as `devices`, for the same reason: "no mail
       * recorded" and "the log is unreachable" send a staffer in opposite
       * directions.
       */
      emails,
    }, { status: 200 })
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours
    // (AGL-1993). Null for anything else, so a real failure keeps its 500.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'User detail failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
