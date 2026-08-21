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
} from '@aglyn/tenant-data-admin'
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
    const orgOfUser = new Map<string, string>()
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
      if (ownerUid) orgOfUser.set(ownerUid, doc.id)
    }
    // Members carry no country of their own, so a member is attributed to
    // their org's country when they have no device of their own to speak for
    // them. Reading the subcollection per org rather than a collection group,
    // because `members` is also a name other trees use.
    await Promise.all(
      orgSnap.docs.map(async (orgDoc) => {
        const members = await orgDoc.ref.collection('members').get()
        for (const member of members.docs) {
          if (!orgOfUser.has(member.id)) orgOfUser.set(member.id, orgDoc.id)
        }
      }),
    )

    // 3. Sign-in countries per user, from the security-alert device records.
    const userSnap = await firestore.collection('users').limit(USER_CAP).get()
    const subjects: ExposureSubject[] = []
    await Promise.all(
      userSnap.docs.map(async (userDoc) => {
        const devices = await userDoc.ref.collection('devices').get()
        const signInCountries = devices.docs
          .map((device) =>
            deviceLocationCountry(
              (device.data() as { location?: unknown }).location as string,
            ),
          )
          .filter(Boolean) as string[]
        const orgId = orgOfUser.get(userDoc.id) ?? ''
        subjects.push({
          id: userDoc.id,
          declaredCountry: orgId ? declaredByOrg.get(orgId) : null,
          billingCountry: orgId ? billingByOrg.get(orgId) : null,
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
        revenueSnap.size >= REVENUE_CAP,
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
    console.error('[admin/member-state-exposure]', error)
    return Response.json(
      { error: 'Member state exposure report failed' },
      { status: 500 },
    )
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
