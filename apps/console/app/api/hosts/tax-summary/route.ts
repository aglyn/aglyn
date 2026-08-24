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
  firebaseAdmin,
  getOrgForHost,
  isImpersonationSession,
  lockdownRefusal,
  resolveOrgIdForHost,
} from '@aglyn/tenant-data-admin'
import {
  storefrontTaxSummary,
  type StorefrontTaxReturnRowInput,
} from '../../../../utils/server/tx-return'

/** Rows read per request. Past this the answer is reported as PARTIAL. */
const ROW_CAP = 2000

/**
 * The sales tax a merchant's OWN storefront collected (AGL-2440).
 *
 * `storefrontTaxCollected` has recorded every taxed storefront sale since
 * AGL-1904, and every reader of it was Aglyn's: the staff tax-return route
 * sums it for Aglyn's own Texas return, and the DSAR export includes it. The
 * merchant — whose sales these are — had no report at all. Their only tax
 * visibility was one order's `totals.taxCents` at a time. This is that
 * absence closed, and closing it is the whole of what this route does.
 *
 * ## WHAT THIS ROUTE DOES NOT DO, and must never be extended to do
 *
 * It emits NO per-merchant, per-jurisdiction verdict on who must remit — and
 * that is still true now that the facilitator question itself is answered.
 * Zach decided on 2026-08-24 that Aglyn IS a marketplace facilitator for
 * storefront sales, and Terms §10.7 publishes it (AGL-1956). But §10.7 is
 * narrow by design: Aglyn calculates, collects and remits **where applicable
 * law gives it an obligation for that transaction**, and asserts nothing
 * anywhere else. A field answering "is Aglyn the facilitator for you" would
 * flatten a per-transaction, per-jurisdiction test into one boolean about a
 * merchant, which the Terms deliberately decline to state.
 *
 * So the response still carries the three buckets SEPARATELY and never a merged
 * total. There is deliberately no field called `yoursToRemit`. Getting that
 * wrong in either direction is worse than the absence it would fill:
 * understate it and a merchant under-remits on our say-so;
 * overstate it and they pay tax twice on money Aglyn already holds. A single
 * "tax collected" figure is the same error wearing a neutral name — it would
 * sum tax Aglyn holds and remits with tax the merchant owes, which is exactly
 * the conflation `storefront-tax.ts` warns about in bold: *the two store modes
 * are DIFFERENT FACTS and must never be summed.*
 *
 * `storefrontTaxSummary` is reused rather than reimplemented, so the merchant
 * and the staff return read the same rows through the same classifier. It
 * buckets off the STORED `taxMode`/`taxLiability` and drops an unrecognised
 * one into `attention.rowsUnclassified` rather than defaulting it into a
 * bucket — the property that makes a separated answer trustworthy.
 *
 * ## Why an Admin-SDK route and not a client read
 *
 * `cloud/firebase-firestore.rules` denies `storefrontTaxCollected` to every
 * client (`allow read, write: if false`) and that stays exactly as it is: the
 * collection spans every merchant, and a row carries a shopper's address
 * beside the amounts. Rules do not apply to the Admin SDK, so this route needs
 * NO rules change — the deny is what makes a server route the only correct
 * shape, not an obstacle to it. The `hostId` filter below is therefore the
 * whole of the tenant boundary and is not optional.
 *
 * ## Reach
 *
 * Host membership, with an org-membership fallback — the same bar as
 * `/api/hosts/usage`. The workspace admins who own billing are frequently not
 * members of the site itself, and they are the people who file. A 404 rather
 * than a 403 on refusal, so the route never confirms a site exists to someone
 * who cannot see it.
 *
 * ## The query needs a composite index
 *
 * `hostId ==` plus a `paidAt` range is a composite query;
 * `cloud/firebase-firestore.indexes.json` gains
 * `storefrontTaxCollected (hostId ASC, paidAt ASC)` for it. Indexes deploy
 * MANUALLY, outside the git→Vercel pipeline, so a merged commit is not
 * evidence the index shipped — the card renders an error until it has.
 *
 * The alternative was a single-field `hostId ==` read filtered in memory,
 * which needs no index. It was rejected: without an index there is no
 * `orderBy`, so hitting the row cap would truncate an ARBITRARY subset, and a
 * tax total computed from an arbitrary subset is not a partial answer — it is
 * a wrong one that looks right. With the index, truncation is the oldest rows
 * of a known period and is reported as `truncated`.
 */
async function handler(request: Request): Promise<Response> {
  const { method, headers: rawHeaders, query } = await pluginRequestFromWeb(request)
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

  // Query params, not a body: a GET that carries one is dropped before it
  // leaves the browser, with no request and no status to debug.
  const hostId = String(query?.['hostId'] ?? '')
  if (!hostId) {
    return Response.json({ error: 'Missing hostId' }, { status: 400 })
  }
  const range = resolveRange(query?.['from'], query?.['to'])
  if (!range) {
    return Response.json({ error: 'Invalid period' }, { status: 400 })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    // Whoever may read the site may read what its storefront collected. Host
    // membership covers editors and collaborators; the org fallback covers the
    // workspace admins who own billing but were never added to the site — the
    // people this report is actually for.
    const isHostMember = Boolean(
      (hostSnapshot.get('memberRoles') ?? {})[decoded.uid],
    )
    let allowed = isHostMember
    if (!allowed) {
      const orgId = await resolveOrgIdForHost(hostId)
      if (orgId) {
        const orgMember = await firestore
          .collection('orgs')
          .doc(orgId)
          .collection('members')
          .doc(decoded.uid)
          .get()
        allowed = orgMember.exists
      }
    }
    if (!allowed) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    const locked = await lockdownRefusal({
      request,
      staff: decoded['staff'] === true,
      uid: decoded.uid,
      org: (await getOrgForHost(hostId))?.org,
      host: hostSnapshot.data(),
    })
    if (locked) return locked

    // THE TENANT BOUNDARY. `hostId ==` is the only thing standing between one
    // merchant and every other merchant's sales, because rules do not run
    // here. It is applied in the query rather than after the read so a
    // mistake downstream cannot widen it.
    const [inPeriod, undated] = await Promise.all([
      firestore
        .collection('storefrontTaxCollected')
        .where('hostId', '==', hostId)
        .where('paidAt', '>=', range.start)
        .where('paidAt', '<', range.end)
        .limit(ROW_CAP + 1)
        .get(),
      // A null `paidAt` is INVISIBLE to a range query, so a row that failed to
      // date itself would silently vanish from the total rather than be
      // reported missing. Counted out loud, exactly as the staff return does.
      firestore
        .collection('storefrontTaxCollected')
        .where('hostId', '==', hostId)
        .where('paidAt', '==', null)
        .limit(50)
        .get(),
    ])

    const truncated = inPeriod.size > ROW_CAP
    const rows: StorefrontTaxReturnRowInput[] = inPeriod.docs
      .slice(0, ROW_CAP)
      .map((doc) => ({ id: doc.id, ...(doc.data() as object) }) as StorefrontTaxReturnRowInput)

    return Response.json(
      {
        hostId,
        period: { from: range.start.toISOString(), to: range.end.toISOString() },
        summary: storefrontTaxSummary(rows, range),
        truncated,
        undatedRows: undated.size,
        /**
         * NOT A REMITTANCE DETERMINATION. Every one of these is a fact about
         * the DATA — what it does not yet reflect, and what it could not read
         * — so a merchant can tell how complete the number is before they use
         * it. None of them says whose tax it is.
         */
        caveats: {
          // The writer keeps a refunded sale's full tax on its record. The
          // direction is deliberate — over-stating what is held for a state is
          // correctable at filing, under-stating it is a shortfall an auditor
          // finds — but a merchant reading their own figure has to be told.
          refundsNotReflected: true,
        },
      },
      { status: 200 },
    )
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Tax summary failed' }, { status: 500 })
  }
}

/**
 * The reporting window. Defaults to the current calendar month in UTC, which
 * is what a monthly filing period means when no timezone has been declared.
 *
 * A malformed date answers `null` and the route 400s rather than silently
 * substituting the default: a merchant who asked for Q1 and received the
 * current month would file the wrong number and have no way to notice.
 */
function resolveRange(
  from: unknown,
  to: unknown,
): { start: Date; end: Date } | null {
  const now = new Date()
  const parse = (value: unknown): Date | null | undefined => {
    if (value === undefined || value === null || value === '') return undefined
    const parsed = new Date(String(value))
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  const parsedFrom = parse(from)
  const parsedTo = parse(to)
  if (parsedFrom === null || parsedTo === null) return null
  const start =
    parsedFrom ??
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end =
    parsedTo ??
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  if (end <= start) return null
  return { start, end }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
