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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  listUsersAcrossPools,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'
import {
  deviceLocationCountry,
  memberStateExposure,
  type ExposureSubject,
} from '../../../../utils/server/member-state-exposure'

/**
 * AGL-2008 — which Member States are the affected data subjects in?
 *
 * `GET /api/admin/member-state-exposure`. Staff-gated exactly like
 * `/api/admin/tax-return` and `/api/admin/overview`: the `staff` custom claim,
 * the same trust anchor as the Firestore rules.
 *
 * ## Why this is a route and not a page someone writes during the incident
 *
 * A per-authority filing has no one-stop-shop to absorb a wrong answer (no EU
 * establishment — EDPB Guidelines 9/2022 §73) and the clock is 72 hours. The
 * filing URLs in `BREACH_NOTIFICATION.md` §4 all open with this question, so
 * discovering the query during the incident spends the clock on SQL. Run it
 * cold, before you need it, and know the shape of the answer.
 *
 * ## It collects nothing
 *
 * Three reads, all of data already held for a stated purpose:
 *
 * - `orgs` → `contact.address.country`, the org's own declaration.
 * - `platformRevenue` → `customerAddress.country`, the Stripe billing country,
 *   retained permanently under Art. 17(3)(b).
 * - `users/{uid}/devices` → the trailing token of `location`, the IP-derived
 *   country the sign-in alerting already writes.
 *
 * The third is a SECONDARY USE of a security record and the weakest signal in
 * the report; `member-state-exposure.ts` marks any bucket resting only on it
 * `inferredOnly` so a filing decision made on that basis is made knowingly.
 *
 * ## What it will not do
 *
 * It reports account holders, where Aglyn is CONTROLLER. It says nothing
 * about a customer's site visitors or site members — for those we are
 * processor, the customer notifies, and their consent record's country never
 * leaves the visitor's own browser (AGL-1498). A count here must never be
 * offered as a count of those.
 */

/**
 * Bounded like every other staff aggregate. `truncated: true` means the report
 * is a LOWER BOUND and the buckets must not be filed from as if complete —
 * raise the cap rather than reading past it.
 */
const USER_CAP = 5000
const ORG_CAP = 2000
const REVENUE_CAP = 5000
/** One `listUsers` page, and how many of them before the sweep reports a cut. */
const AUTH_PAGE_SIZE = 1000
const AUTH_PAGE_CAP = 20

async function handler(request: Request): Promise<Response> {
  const { method, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }

    const firestore = firebaseAdmin.app().firestore()

    // 1. Billing country per org, from the permanently retained revenue rows.
    //    Last row wins, which is the most recent billing address on file.
    const billingByOrg = new Map<string, string>()
    const revenueSnap = await firestore
      .collection('platformRevenue')
      .limit(REVENUE_CAP)
      .get()
    for (const doc of revenueSnap.docs) {
      const row = doc.data() as Record<string, unknown>
      const orgId = typeof row.orgId === 'string' ? row.orgId : ''
      const address = row.customerAddress as { country?: unknown } | undefined
      const country =
        typeof address?.country === 'string' ? address.country : ''
      if (orgId && country) billingByOrg.set(orgId, country)
    }

    // 2. Declared country per org, and each org's member uids.
    const orgSnap = await firestore.collection('orgs').limit(ORG_CAP).get()
    const declaredByOrg = new Map<string, string>()
    // EVERY org a uid belongs to, not one of them (AGL-2008). A uid in more
    // than one org is a designed case, not an edge one — an agency sits in
    // 50+ workspaces (AGL-2336), and `free-workspace-cap.ts` says outright
    // that "a contractor added to ten client workspaces owns none of them".
    // This was a `Map<uid, orgId>` filled first-wins from inside the
    // `Promise.all` below, so the org that won was decided by whichever
    // subcollection read returned first: the same population could produce a
    // different filing list on a second run, and a client org's billing
    // address silently outranked the person's own sign-in history. Collect
    // them all and let `resolveSubjectCountry` refuse when they disagree.
    const orgsOfUser = new Map<string, Set<string>>()
    const attribute = (uid: string, orgId: string) => {
      const existing = orgsOfUser.get(uid)
      if (existing) existing.add(orgId)
      else orgsOfUser.set(uid, new Set([orgId]))
    }
    for (const doc of orgSnap.docs) {
      const org = doc.data() as Record<string, unknown>
      const contact = org.contact as
        | { address?: { country?: unknown } }
        | undefined
      const country =
        typeof contact?.address?.country === 'string'
          ? contact.address.country
          : ''
      if (country) declaredByOrg.set(doc.id, country)
      const ownerUid = typeof org.ownerUid === 'string' ? org.ownerUid : ''
      if (ownerUid) attribute(ownerUid, doc.id)
    }
    // Members carry no country of their own, so a member is attributed to
    // their orgs' countries when they have no device of their own to speak
    // for them. Reading the subcollection per org rather than a collection
    // group, because `members` is also a name other trees use.
    await Promise.all(
      orgSnap.docs.map(async (orgDoc) => {
        const members = await orgDoc.ref.collection('members').get()
        for (const member of members.docs) attribute(member.id, orgDoc.id)
      }),
    )

    // 3. THE POPULATION — every account holder, not only the ones who have a
    //    `users/{uid}` profile DOCUMENT.
    //
    // This read used to BE the population, and that quietly lost people.
    // Adding a member writes `orgs/{orgId}/members/{uid}` and the reverse
    // index `users/{uid}/orgs/{orgId}` (`organizations.ts:1124,1325`), and
    // writes `users/{uid}` ITSELF nowhere. That document is created only by
    // `seedUserProfile`, on sign-in — and even then "best-effort by contract:
    // the profile self-heals on the next sign-in", so a rejected seed leaves
    // the same hole behind a user who has signed in and has devices.
    //
    // Firestore EXCLUDES such a phantom parent from a collection query: a
    // document that exists only as the ancestor of subcollection documents is
    // not returned by `collection('users').get()`. So a person invited to an
    // org who has not signed in yet — whose email we hold on the member row,
    // and who is squarely a data subject in a breach of it — was not reported
    // as `unknown`. They were ABSENT: outside `totalSubjects`, and therefore
    // outside the denominator, so `coverage` read BETTER the more people we
    // could not place. That is the exact failure this whole issue exists to
    // prevent — an omission wearing the shape of completeness — and it is the
    // one an authority probes first.
    //
    // So the population is a UNION of three registers, and each is here
    // because the other two miss somebody real:
    //
    //  a. **Firebase Auth, across every pool** — the account register itself,
    //     and the only exhaustive one. `erase.ts:1367` already treats it as
    //     the truth for exactly this reason ("an absent profile doc is not an
    //     absent account"), falling back to `findUserByUidAcrossPools` when
    //     Firestore holds nothing. It catches the account that signed up,
    //     never verified its email — the session route refuses BEFORE the
    //     seed runs — and never joined an org, which neither register below
    //     can see at all.
    //  b. **`users/{uid}` profile documents** — a subset of (a) in principle,
    //     kept because it is the register the devices hang off.
    //  c. **Org rosters** — every member uid and `ownerUid` from step 2. Not
    //     redundant with (a): erasure deletes the auth record and can leave
    //     the membership row behind (`resolve-people.ts:28` names the state,
    //     "a deleted account whose membership lingers"), and we still hold
    //     that person's email on the roster row.
    //
    // (c) is free — `orgsOfUser` is already in hand. (a) costs one paginated
    // sweep. Both are worth it: the register this route used to call the
    // population was (b) alone, and (b) is measured at **1 account in 3**
    // (`user-profiles.ts:30`, production, 2026-07-30).
    const userSnap = await firestore.collection('users').limit(USER_CAP).get()
    const populationUids = new Set<string>(
      userSnap.docs.map((userDoc: { id: string }) => userDoc.id),
    )
    for (const uid of orgsOfUser.keys()) populationUids.add(uid)

    // The auth sweep. A failure here must not be swallowed into a smaller
    // population that still looks like a complete one, so it is recorded and
    // surfaced rather than caught and ignored.
    let authTruncated = false
    let authSweepFailed = false
    try {
      let pageToken: string | undefined = undefined
      let pages = 0
      do {
        const page = await listUsersAcrossPools(AUTH_PAGE_SIZE, pageToken)
        for (const pooled of page.users) populationUids.add(pooled.record.uid)
        if (page.tenantTruncated?.length) authTruncated = true
        pageToken = page.nextPageToken ?? undefined
        pages += 1
      } while (pageToken && pages < AUTH_PAGE_CAP)
      if (pageToken) authTruncated = true
    } catch (error) {
      console.error('[admin/member-state-exposure] auth sweep failed', error)
      authSweepFailed = true
    }

    const subjects: ExposureSubject[] = []
    await Promise.all(
      [...populationUids].map(async (uid) => {
        // By ref rather than through a snapshot, because for a recovered uid
        // there IS no snapshot — and a subcollection under a document that
        // does not exist reads perfectly well.
        const devices = await firestore
          .collection('users')
          .doc(uid)
          .collection('devices')
          .get()
        const signInCountries = devices.docs
          .map((device: { data: () => unknown }) =>
            deviceLocationCountry(
              (device.data() as { location?: unknown }).location as string,
            ),
          )
          .filter(Boolean) as string[]
        const orgIds = [...(orgsOfUser.get(uid) ?? [])]
        subjects.push({
          id: uid,
          declaredCountries: orgIds
            .map((orgId) => declaredByOrg.get(orgId))
            .filter(Boolean) as string[],
          billingCountries: orgIds
            .map((orgId) => billingByOrg.get(orgId))
            .filter(Boolean) as string[],
          signInCountries,
        })
      }),
    )

    const report = memberStateExposure(subjects)
    return Response.json({
      ...report,
      truncated:
        userSnap.size >= USER_CAP ||
        orgSnap.size >= ORG_CAP ||
        revenueSnap.size >= REVENUE_CAP ||
        authTruncated ||
        authSweepFailed,
      /**
       * The population is a lower bound because the ACCOUNT REGISTER could
       * not be swept, not because a Firestore page filled up. Reported
       * separately from `truncated` because the remedy differs: a filled page
       * is a cap to raise, a failed sweep is a report to re-run. Either way a
       * reader must not treat the buckets as the whole population.
       */
      authSweepFailed,
      generatedAt: new Date().toISOString(),
      // Stated in the payload, not only in the docs: a reader who gets this
      // as JSON during an incident must not have to go and find the caveat.
      scope:
        `Account holders only — ${PLATFORM_BRAND_NAME} as CONTROLLER. Says ` +
        'nothing about a customer\'s site visitors or site members, for whom ' +
        `${PLATFORM_BRAND_NAME} is processor and the customer notifies.`,
      caveat:
        'Billing country is the payer address, not residence. A sign-in ' +
        'country is where somebody WAS, once. Buckets marked inferredOnly ' +
        'rest on sign-in IP alone.',
    })
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours
    // (AGL-1993). Null for anything else, so a real failure keeps its 500.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[admin/member-state-exposure]', error)
    return Response.json(
      { error: 'Member state exposure report failed' },
      { status: 500 },
    )
  }
}

export const dynamic = 'force-dynamic'
/**
 * The fan-out is real, so ask for the same window every other bulk staff route
 * asks for (`run-erasures`, `backfill-scope`, `audit-archive`, all 60).
 *
 * Worst case at the caps above is ~7,000 Firestore round trips: one `orgs`
 * page, one `users` page, one `platformRevenue` page, then a `members` get per
 * org (≤2,000) and a `devices` get per subject. That last count is the UNION
 * of the `users` page and the org rosters rather than the page alone, so it is
 * bounded by ≤5,000 profiles plus the members recovered from step 2. This
 * route shipped with
 * no `maxDuration` at all, so it inherited the platform default — and a report
 * that 504s is a report that fails at exactly the moment §3.3 of
 * `BREACH_NOTIFICATION.md` sends someone to it, with the 72-hour clock running.
 * A timeout here is indistinguishable from "we cannot say".
 */
export const maxDuration = 60
export { handler as GET }
