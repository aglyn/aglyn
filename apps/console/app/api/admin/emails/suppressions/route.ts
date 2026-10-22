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
  EMAIL_SUPPRESSIONS_COLLECTION,
  emailUnverifiedResponse,
  firebaseAdmin,
  isAccountBanSuppression,
  isImpersonationSession,
  releaseEmail,
} from '@aglyn/tenant-data-admin'
import {
  maskEmailAddresses,
  recordAdminAudit,
  subjectAddressKeyForRecipients,
} from '@aglyn/tenant-data-admin/server/admin-audit'
import { SUPPRESSION_LIST_QUERY } from '../../../../../utils/email-suppression-filters'
import {
  readStaffListQuery,
  runStaffListQuery,
} from '../../../../../utils/server/staff-list-query'
import { invalidIdTokenResponse } from '../../../_lib/invalid-id-token-response'

/**
 * THE PLATFORM-WIDE SUPPRESSION LIST, on the staff console.
 *
 * ## What was missing
 *
 * `emailSuppressions` is written by the Resend webhook on every permanent
 * bounce and every complaint, for every sender in the product — including the
 * transactional mail that carries no site tag and could therefore never reach
 * a merchant's own list. `listEmailSuppressions` and `releaseEmail` were
 * written to read and lift one, and had **zero callers anywhere in the repo**.
 *
 * So a platform suppression could be created by a machine and never seen or
 * lifted by anybody, and the shape of that failure is the worst one in this
 * area: a customer whose address landed here — a typo at signup, a mailbox
 * that was full at exactly the wrong moment and reported permanent, a bounce
 * from a since-fixed corporate filter — stops receiving mail from the whole
 * platform, and no screen anywhere says why. Support cannot answer it and the
 * customer cannot fix it, because the entry is invisible to both.
 *
 * ## Why staff and not the merchant
 *
 * A per-site suppression is a preference about one sender's mail, and the
 * merchant owns it — they add and remove entries on their own card. This list
 * is evidence about an ADDRESS, learned anywhere in the product and applying
 * everywhere in it. A merchant lifting one would be deciding, for every other
 * tenant on the shared sending domain, that a hard bounce or a spam report
 * should be mailed again.
 *
 * ## Why a release is audited and a read is not
 *
 * Releasing puts a known-bad address back in circulation on the domain every
 * customer's mail leaves by, which is exactly the class of act `adminAudit`
 * exists to make reviewable. The address is MASKED in the record, matching the
 * message-preview route beside it: this collection is readable by any staff
 * role, and a row echoing addresses in full would make the audit trail the
 * leakier of the two artifacts.
 *
 * Listing is not audited, for the reason the delivery log is not: it is the
 * ordinary act of looking at an operational queue, and auditing every glance
 * produces a record nobody reads and hides the acts that matter.
 */

/** Bound on one page. */
const PAGE_MAX = 200

interface StaffContext {
  ok: true
  uid: string
}

async function authorize(
  headers: Partial<Record<string, string>>,
): Promise<StaffContext | Response> {
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
  if (!decoded.email_verified && !isImpersonationSession(decoded)) {
    return emailUnverifiedResponse()
  }
  if (!decoded['staff']) {
    return Response.json({ error: 'Staff only' }, { status: 403 })
  }
  return { ok: true, uid: decoded.uid }
}

async function listHandler(request: Request): Promise<Response> {
  const { query, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  try {
    const staff = await authorize(headers)
    if (staff instanceof Response) return staff
    /*
     * THE FILTERS AND THE SEARCH, on the query (AGL-3321).
     *
     * Every clause and the search word are planned onto ONE query in the
     * list's `suppressedAt` DESC order, and paged by a cursor in that order,
     * so each page is a page of the narrowed list rather than a narrowed page
     * — on this list, "not suppressed" for an address past the page on screen
     * is the wrong answer in the reassuring direction. What one query cannot
     * hold comes back in `refused` and is not applied, and the card says so.
     * An unreadable ask is refused outright rather than answered unfiltered.
     * See `utils/email-suppression-filters.ts`.
     */
    const asked = readStaffListQuery(query as Record<string, unknown>, {
      maxPageSize: PAGE_MAX,
    })
    if (!asked) {
      return Response.json({ error: 'Unreadable filters' }, { status: 400 })
    }
    const firestore = firebaseAdmin.app().firestore()
    const page = await runStaffListQuery({
      firestore,
      collection: firestore.collection(EMAIL_SUPPRESSIONS_COLLECTION),
      declaration: SUPPRESSION_LIST_QUERY,
      request: asked,
      row: (doc) => {
        // The search tokens are the query's, not the reader's.
        const shown: Record<string, unknown> = { ...doc.data() }
        delete shown['emailTokens']
        return { $id: doc.id, ...shown }
      },
    })
    return Response.json(page, { status: 200 })
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[admin/emails/suppressions] list failed', error)
    return Response.json({ error: 'Lookup failed' }, { status: 502 })
  }
}

async function releaseHandler(request: Request): Promise<Response> {
  const { body: rawBody, headers: rawHeaders } =
    await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  try {
    const staff = await authorize(headers)
    if (staff instanceof Response) return staff
    const body = (rawBody ?? {}) as Record<string, unknown>
    const email = String(body.email ?? '').trim()
    const note = String(body.note ?? '')
      .trim()
      .slice(0, 200)
    if (!email) {
      return Response.json({ error: 'Missing email' }, { status: 400 })
    }
    /*
     * A REASON IS REQUIRED, and the refusal is here rather than in the UI.
     *
     * This puts an address that hard-bounced or reported spam back onto the
     * shared sending domain. The audit row is what makes that reviewable, and
     * a row saying only "somebody released it" answers half the question it is
     * kept for — the same instrument the org override actions already use.
     */
    if (note.length < 8) {
      return Response.json(
        {
          error:
            'Say why this address is being put back. It hard-bounced or ' +
            'reported spam, and releasing it re-mails it on the domain every ' +
            'customer’s mail leaves by.',
        },
        { status: 400 },
      )
    }

    // A ban's row is the account's, lifted with the ban on Lockdown and
    // never from this list (AGL-3420).
    if (await isAccountBanSuppression(email)) {
      return Response.json(
        {
          error:
            'This address belongs to a banned account. Lift the ban on the ' +
            'account from Lockdown; that releases it.',
        },
        { status: 409 },
      )
    }
    const released = await releaseEmail({
      email,
      releasedByUid: staff.uid,
      note,
    })
    if (!released) {
      // Not an error: nothing to release means the address was never on the
      // list, or was released already. Saying so is the answer.
      return Response.json({ released: false }, { status: 200 })
    }

    await recordAdminAudit({
      action: 'email.suppression.release',
      actorUid: staff.uid,
      target: 'emailSuppressions',
      /*
       * The hashed address, so the act appears on the page of every account
       * holding it. `subjectUid` is deliberately absent: a suppressed address
       * may belong to a prospect, to two accounts, or to nobody, and naming
       * one of two would put this act on an innocent person's page.
       */
      subjectAddressKey: subjectAddressKeyForRecipients([email]),
      // MASKED, matching the message-preview route: `adminAudit` is readable
      // by any staff role, and a row echoing the address in full would make
      // the audit trail leakier than the list it describes.
      note: `${maskEmailAddresses([email])} — ${note}`,
    }).catch(() => undefined)

    return Response.json({ released: true }, { status: 200 })
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[admin/emails/suppressions] release failed', error)
    return Response.json({ error: 'The release failed' }, { status: 502 })
  }
}

export const dynamic = 'force-dynamic'
export { listHandler as GET, releaseHandler as POST }
