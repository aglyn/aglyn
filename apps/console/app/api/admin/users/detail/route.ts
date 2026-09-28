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
import { invalidIdTokenResponse } from '../../../_lib/invalid-id-token-response'
import { LEGAL_DOCUMENT_VERSION } from '../../../../../constants/legal-documents'
import { type DeviceRow, readDeviceRows } from '../../../_lib/device-registry'
// From the LEAF: the barrel above reaches the admin SDK and is mocked wholesale
// by route specs, and a mocked-away reader renders an empty email history that
// looks exactly like "we never mailed this person".
import { readEmailDeliveryHistoryForAddresses } from '@aglyn/tenant-data-admin/server/email-delivery-log'
import { resolveAccountAddresses } from '@aglyn/tenant-data-admin/server/account-addresses'
// From the leaf for the same reason as the delivery log above: a mocked-away
// reader would render "no consent on file", which is a claim about a person.
import { readPlatformMarketingReach } from '@aglyn/tenant-data-admin/server/platform-marketing-consent'
import { readPlatformMarketingConsent } from '@aglyn/aglyn/app-utils/platform-marketing-consent'

/**
 * Staff user detail (AGL-244): everything the console needs to answer
 * "who is this account" — identity + auth state, staff claims, every org
 * membership with its role/host access (via the reverse index). The
 * account's audit trail is read by `/api/admin/users/audit`.
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
    /*
     * EVERY ADDRESS THIS ACCOUNT HOLDS — primary, provider-supplied, and the
     * ones it has been moved off.
     *
     * The delivery log is keyed on `sha256(address)` because that is what a
     * mail provider reports against. Passing only `record.email` meant an
     * account whose address had changed read an EMPTY document while its real
     * history sat under the old hash, unreachable — and this card's own copy
     * warns that reading a blank table as "we never emailed them" is how
     * staff mislead a customer.
     *
     * `detectShared` so the card can say when an address is one another
     * account also holds. The log describes an address, not a uid, and
     * attributing shared mail to whichever account is on screen would be a
     * guess presented as a fact.
     */
    const addressSet = await resolveAccountAddresses({
      uid,
      record,
      detectShared: true,
      firestore,
    })

    const [phone, legal, devices, emails, marketingReach] = await Promise.all([
      readPhoneDisclosure(profile),
      readLegalDisclosure(uid, firestore),
      readDeviceDisclosure(uid, firestore),
      /*
       * WHAT WE SENT THIS PERSON, and what they did with it.
       *
       * Reads our own store, never the sending provider: see
       * `email-delivery-log.ts` for why a staff screen must not depend on a
       * vendor's list endpoint.
       */
      //
      // The card pages the messages themselves through
      // `/api/admin/users/email-history`, every filter on the query
      // (AGL-3321); this read is for the erasure records and the failure
      // flag, so it reads the newest message only.
      readEmailDeliveryHistoryForAddresses(
        addressSet.addresses.map((entry) => entry.address),
        { firestore, limit: 1 },
      ),
      // What the operator's own product email would decide (AGL-3292). Never
      // throws — a failed read comes back `unreadable`.
      readPlatformMarketingReach({ email: record.email }),
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
     * The account's audit trail is not part of this read: its two tables
     * page and filter it themselves through `/api/admin/users/audit`, every
     * clause on the query (AGL-3321).
     */
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
        /*
         * The provider AND the address it carries.
         *
         * This mapped to `providerId` alone, so staff could see that an
         * account had a Google provider and not which mailbox it was for —
         * while that address is a real recipient of real mail and, because
         * a provider-supplied address never enters `emailIdentityIndex`, the
         * one most likely to be quietly shared with another account.
         *
         * Kept as objects rather than flattened to strings: a provider with
         * no address (phone, anonymous) is a real case and must render as
         * itself rather than as a blank half of a joined label.
         */
        providers: record.providerData.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email ?? null,
        })),
        createdAt: record.metadata.creationTime ?? null,
        lastSignInAt: record.metadata.lastSignInTime ?? null,
        /** GCIP tenant id, or null for a project-pool account (AGL-1122). */
        tenantId,
      },
      memberships,
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
       * Delivery history across EVERY address the account holds — what was
       * sent, whether it arrived, and whether it was opened or clicked. Same
       * `lookupFailed` split as `devices`, for the same reason: "no mail
       * recorded" and "the log is unreachable" send a staffer in opposite
       * directions.
       *
       * `erasures` is a third state the same reasoning demands: an address
       * whose records were destroyed under an erasure request also reads as
       * an empty table, and letting it would recreate the bug this card was
       * built to fix.
       */
      emails,
      /**
       * The addresses the history was read under, and which of them another
       * account also holds.
       *
       * Rendered rather than kept internal: a staffer looking at mail sent to
       * an address that is no longer this account's primary has to be able to
       * see that that is what they are looking at, and a shared address has
       * to be visibly shared — the delivery log records that mail went to a
       * MAILBOX, and it cannot say which of two accounts it was "for".
       */
      addresses: addressSet.addresses,
      /** A source was unreadable, so the list above may be short. */
      addressesIncomplete: addressSet.incomplete,
      /**
       * Product email from the operator (AGL-3292), in two halves that
       * nothing keeps in step. `answer` is what the person said, from their
       * own document — what the console shows them. `reach` is what a
       * campaign from the configured marketing site would decide, read from
       * the operator's CRM contact and both suppression lists, which is what
       * every send actually consults.
       */
      marketing: {
        answer: readPlatformMarketingConsent(
          (profile.data() as Record<string, unknown> | undefined) ?? null,
        ),
        reach: marketingReach,
      },
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
